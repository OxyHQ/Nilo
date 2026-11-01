import cors from 'cors';
import type { RequestHandler } from 'express';

/** Preserve the API CORS policy for production and its HTTP preflight tests. */
export function createApiCors(corsOrigins: readonly string[]): RequestHandler {
  return (req, res, next) => {
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
        'X-Notes-Generation',
      ],
      // Downloads name their file, and rate-limited answers say when to retry.
      exposedHeaders: ['Content-Disposition', 'Retry-After'],
      optionsSuccessStatus: 200,
    })(req, res, next);
  };
}
