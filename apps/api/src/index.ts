import {
  ecosystemActivityMiddleware,
  startEcosystemActivity,
  stopEcosystemActivity,
} from './ecosystemActivity';
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import { allowedOrigins } from './lib/allowed-origins.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
import pagePermissionsRouter from './routes/page-permissions.js';
import searchRouter from './routes/search.js';
import publishRouter from './routes/publish.js';
import pageHistoryRouter from './routes/page-history.js';
import remindersRouter from './routes/reminders.js';
import importRouter from './routes/import.js';
import backlinksRouter from './routes/backlinks.js';
import formsRouter from './routes/forms.js';
import pageFollowsRouter from './routes/page-follows.js';
import { startReminderSweep, stopReminderSweep } from './lib/reminders.js';
import pagesRouter from './routes/pages.js';
import blocksRouter from './routes/blocks.js';
import databasesRouter from './routes/databases.js';
import commentsRouter from './routes/comments.js';
import uploadsRouter, { LOCAL_UPLOAD_ROOT } from './routes/uploads.js';
import embedRouter from './routes/embed.js';

// Socket.io
import { initSocket } from './socket.js';

// Fix for ES Modules __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from the api directory (not the monorepo root)
dotenv.config({ path: join(__dirname, '../.env') });

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

// Handle HTTP server errors (e.g. EADDRINUSE)
server.on('error', (error: NodeJS.ErrnoException) => {
  log.general.error({ err: error }, '[Server] HTTP server error');
  if (error.code === 'EADDRINUSE') {
    log.general.error({ port: PORT }, 'Port already in use');
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
const corsOrigins = allowedOrigins();

app.use((req, res, next) => {
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      if (corsOrigins.includes(origin)) {
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
    // Downloads name their file, and rate-limited answers say when to retry.
    exposedHeaders: ['Content-Disposition', 'Retry-After'],
    optionsSuccessStatus: 200,
  })(req, res, next);
});

// Allow cross-origin resource loading (fixes ERR_BLOCKED_BY_RESPONSE.NotSameOrigin)
app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

// The API runs behind one load balancer: the client's address is the last hop
// it adds to X-Forwarded-For. Rate limits key on it (`lib/rate-limit.ts`).
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

// Block payloads and database properties may contain structured document data.
// Imports parse their own, larger bodies (`routes/import.ts`).
const jsonBody = express.json({ limit: '10mb' });
app.use((req, res, next) => (req.path === '/pages/import' ? next() : jsonBody(req, res, next)));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/health', healthRouter);
app.use('/feedback', feedbackRouter);
app.use('/notifications', notificationsRouter);
app.use('/workspaces', workspacesRouter);
app.use(formsRouter);
app.use(pageFollowsRouter);
app.use(shareLinksRouter);
app.use(publishRouter);
app.use(pageHistoryRouter);
app.use(remindersRouter);
app.use(importRouter);
app.use(backlinksRouter);
app.use(pagePermissionsRouter);
app.use(blocksRouter);
app.use(commentsRouter);
app.use('/pages', pagesRouter);
app.use('/search', searchRouter);
app.use('/databases', databasesRouter);
app.use('/uploads', uploadsRouter);
app.use('/embed', embedRouter);
// Serve local-disk uploads (only used when Spaces creds are not configured)
// Local uploads (no object storage configured) come from this origin: they
// must never run as pages here. Nothing is sniffed, nothing scripts, and only
// media and PDFs display inline.
app.use(
  '/uploads',
  express.static(LOCAL_UPLOAD_ROOT, {
    fallthrough: true,
    setHeaders: (res, filePath) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      if (
        !/\.(png|jpe?g|gif|webp|avif|heic|heif|bmp|mp4|webm|mov|ogg|mp3|m4a|wav|aac|flac|pdf)$/i.test(
          filePath,
        )
      ) {
        res.setHeader('Content-Disposition', 'attachment');
      }
    },
  }),
);

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

// Process-level error handlers — prevent crashes from taking down all users
// Classifies errors to determine logging level (inspired by openclaw)
process.on('unhandledRejection', (reason) => {
  // AbortError: intentional cancellation (user stopped request) — suppress
  if (isAbortError(reason)) return;

  // Fatal: OOM, worker failures — must exit
  if (isFatalError(reason)) {
    log.general.error({ err: reason }, '[Process] FATAL unhandled rejection — shutting down');
    setTimeout(() => process.exit(1), 5000).unref();
    return;
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
  setTimeout(() => process.exit(1), 5000).unref();
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
      startReminderSweep();
      // Verify Redis connectivity (non-blocking)
      import('./lib/redis.js').then(({ getRedisClient }) => {
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
      });
    });

    // Graceful shutdown handler
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      log.general.info(`Received ${signal}. Starting graceful shutdown...`);

      stopReminderSweep();
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
