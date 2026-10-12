import {
  ecosystemActivityMiddleware,
  startEcosystemActivity,
  stopEcosystemActivity,
} from './ecosystemActivity';
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from './db/client.js';
import { log } from './lib/logger.js';
import { isAbortError, isFatalError, isTransientNetworkError } from './lib/error-classification.js';

// Routes
import healthRouter from './routes/health.js';
import feedbackRouter from './routes/feedback.js';
import notificationsRouter from './routes/notifications.js';
import workspacesRouter from './routes/workspaces.js';
import shareLinksRouter from './routes/share-links.js';
import pagesRouter from './routes/pages.js';
import blocksRouter from './routes/blocks.js';
import databasesRouter from './routes/databases.js';
import commentsRouter from './routes/comments.js';
import uploadsRouter, { LOCAL_UPLOAD_ROOT } from './routes/uploads.js';
import embedRouter from './routes/embed.js';

// Socket.io
import { initSocket } from './socket.js';

// Bun loads `.env` from the working directory before any module runs, and every
// script that starts this server (`dev`, `start`) runs in apps/api, so it
// reads apps/api/.env. Variables already in the environment win.

const app = express();
app.use(ecosystemActivityMiddleware);
const PORT = parseInt(process.env.PORT || '4001', 10);

// Create the HTTP server.
const server = http.createServer(
  {
    maxHeaderSize: 16384,
    keepAlive: true,
    keepAliveTimeout: 65000,
  },
  app,
);

// An error before the server is listening means it never will be: EADDRINUSE,
// but equally EACCES or EADDRNOTAVAIL. Only EADDRINUSE used to exit; any other
// listen error left a process that was alive, held open by the Postgres pool,
// and listening on nothing — measured with PORT=80 as a non-root user.
server.on('error', (error: NodeJS.ErrnoException) => {
  log.general.error({ err: error, port: PORT }, '[Server] HTTP server error');
  if (!server.listening) {
    log.general.error({ port: PORT }, '[Server] Could not listen — shutting down');
    process.exit(1);
  }
});

server.on('connection', (socket) => {
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 60000);
});

startEcosystemActivity(() => server.listening);
initSocket(server);

// Internal routes - restricted to known origins
const PRODUCTION_ORIGINS = ['https://nilo.so'];

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8081',
  'exp://localhost:8081',
  'http://10.0.2.2:8081',
];

const allowedOrigins = [
  ...(process.env.WEB_URL ? [process.env.WEB_URL] : []),
  ...PRODUCTION_ORIGINS,
  ...DEV_ORIGINS,
];

app.use((req, res, next) => {
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'X-Device-Info',
      'X-Workspace-Id',
      'X-Oxy-Edge-Region',
      'X-Oxy-Activity-Id',
    ],
    optionsSuccessStatus: 200,
  })(req, res, next);
});

// Allow cross-origin resource loading (fixes ERR_BLOCKED_BY_RESPONSE.NotSameOrigin)
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

// Block payloads and database properties may contain structured document data.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/health', healthRouter);
app.use('/feedback', feedbackRouter);
app.use('/notifications', notificationsRouter);
app.use('/workspaces', workspacesRouter);
app.use(shareLinksRouter);
app.use(blocksRouter);
app.use(commentsRouter);
app.use('/pages', pagesRouter);
app.use('/databases', databasesRouter);
app.use('/uploads', uploadsRouter);
app.use('/embed', embedRouter);
// Serve local-disk uploads (only used when Spaces creds are not configured)
app.use('/uploads', express.static(LOCAL_UPLOAD_ROOT, { fallthrough: true }));

// Root route
app.get('/', (_req, res) => {
  res.json({
    message: 'Nilo API',
    version: '1.0.0',
    endpoints: [
      '/health',
      '/feedback',
      '/notifications',
      '/workspaces',
      '/pages',
      '/blocks',
      '/databases',
      '/comments',
      '/uploads',
      '/embed',
      '/share-links',
      '/share/:token',
    ],
  });
});

// Error handler
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.general.error({ err }, 'Unhandled Express error');
    if (!res.headersSent) {
      res.status(500).json({ error: 'Something went wrong!' });
    }
  },
);

/**
 * End the process as a FAILURE, now.
 *
 * Registering an `uncaughtException` listener takes the exit decision away
 * from Node: it no longer exits, and no longer sets exit code 1. These handlers
 * used to hand that decision to `setTimeout(() => process.exit(1), 5000).unref()`
 * — and an unref'd timer is exactly the one thing that does not keep the event
 * loop alive. At boot nothing else does either (no listening socket, no pool
 * yet), so the loop drained, the timer never fired, and the process exited
 * with code 0: a crashed boot that every orchestrator reads as a clean exit.
 * Measured on the built artefact under node 22 with `DATABASE_URL` unset.
 *
 * Node's documented contract is that a process is not safe to resume after an
 * uncaught exception, so there is no grace period to protect. The log line is
 * not lost: pino flushes its destination synchronously on `exit`.
 * `scripts/check-api-entrypoints.ts` executes the built artefact to hold this.
 */
function exitAsFailure(): never {
  process.exit(1);
}

// Process-level error handlers — prevent crashes from taking down all users
// Classifies errors to determine logging level (inspired by openclaw)
process.on('unhandledRejection', (reason) => {
  // AbortError: intentional cancellation (user stopped request) — suppress
  if (isAbortError(reason)) return;

  // Fatal: OOM, worker failures — must exit
  if (isFatalError(reason)) {
    log.general.error({ err: reason }, '[Process] FATAL unhandled rejection — shutting down');
    exitAsFailure();
  }

  // Transient network: ECONNRESET, ETIMEDOUT, etc. — expected with external services
  if (isTransientNetworkError(reason)) {
    log.general.warn({ err: reason }, '[Process] Transient network error (continuing)');
    return;
  }

  // Everything else: log as error but keep running
  log.general.error(
    { reason: reason instanceof Error ? reason : String(reason) },
    '[Process] Unhandled promise rejection',
  );
});

process.on('uncaughtException', (error) => {
  log.general.error({ err: error }, '[Process] Uncaught exception — shutting down');
  exitAsFailure();
});

/**
 * Prove the database the service actually reads is reachable before accepting
 * traffic. A handle that merely constructs proves nothing — `createDatabase`
 * is lazy — so this issues a real statement. "Connected" and "answers a query"
 * are different claims, and only the second is worth gating a listen on.
 */
getDb()
  .execute(sql`select 1`)
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      log.general.info({ port: PORT }, 'API server listening');
      // Verify Redis connectivity (non-blocking)
      import('./lib/redis.js')
        .then(({ getRedisClient }) => {
          const redis = getRedisClient();
          if (redis) {
            redis
              .ping()
              .then(() => log.general.info('Redis readiness check passed'))
              .catch((err) =>
                log.general.warn(
                  { err },
                  'Redis readiness check failed — rate limiting will fail-open',
                ),
              );
          } else {
            log.general.info('Redis not configured (REDIS_URL not set) — rate limiting disabled');
          }
        })
        // Redis is optional, so a failure here is a warning, not a boot failure —
        // but it is handled HERE, not left to the process-level rejection handler.
        .catch((err: unknown) =>
          log.general.warn(
            { err },
            'Redis readiness check could not run — rate limiting will fail-open',
          ),
        );
    });

    // Graceful shutdown handler
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      log.general.info(`Received ${signal}. Starting graceful shutdown...`);
      // Only the completed path below reports success. The force-exit timer is
      // unref'd, so a shutdown wedged on a promise nothing else keeps alive ends
      // by the event loop draining — which, without this, would be exit 0.
      process.exitCode = 1;

      // Stop accepting new connections
      server.close(() => {
        log.general.info('HTTP server closed (no new connections)');
      });

      // Give in-flight workspace requests 30 seconds to complete.
      const forceTimeout = setTimeout(() => {
        log.general.error('Force exit after 30s grace period');
        process.exit(1);
      }, 30_000);
      forceTimeout.unref();

      try {
        // Close Socket.IO connections
        const { getIO } = await import('./socket.js');
        const io = getIO();
        if (io) {
          await new Promise<void>((resolve) => io.close(() => resolve()));
          log.general.info('Socket.IO closed');
        }

        // Close Redis connections
        const { closeRedis } = await import('./lib/redis.js');
        await closeRedis();
        log.general.info('Redis connections closed');

        // Close the Postgres pool
        await closeDb();
        log.general.info('Postgres pool closed');

        clearTimeout(forceTimeout);
        await stopEcosystemActivity();
        log.general.info('Graceful shutdown complete');
        process.exit(0);
      } catch (error) {
        log.general.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((error: unknown) => {
    log.general.error({ err: error }, 'Failed to connect to PostgreSQL');
    process.exit(1);
  });
