/**
 * Fixed-window rate limits for unauthenticated endpoints (public forms,
 * published pages). Counted in Redis when it is configured, so every API
 * instance shares the window; otherwise in this process, bounded in size.
 * A Redis failure lets the request through: a limiter must not take the
 * endpoint down with it.
 */
import type { NextFunction, Request, Response } from 'express';
import { log } from './logger.js';
import { getRedisClient } from './redis.js';

const local = new Map<string, { count: number; resetAt: number }>();
const LOCAL_MAX_KEYS = 10_000;

async function hit(key: string, windowMs: number): Promise<number> {
  const redis = getRedisClient();
  if (redis) {
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.pexpire(key, windowMs);
      return count;
    } catch (err: unknown) {
      log.general.warn({ err }, 'Rate limit check failed; letting the request through');
      return 0;
    }
  }
  const now = Date.now();
  const entry = local.get(key);
  if (!entry || entry.resetAt <= now) {
    if (local.size >= LOCAL_MAX_KEYS) {
      for (const [k, v] of local) if (v.resetAt <= now) local.delete(k);
      if (local.size >= LOCAL_MAX_KEYS) local.clear();
    }
    local.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

/**
 * At most `limit` requests per `windowMs` per client address (and per the
 * key `scope` derives from the request, e.g. one form). Answers 429 with
 * `Retry-After` beyond it.
 */
export function rateLimit(options: {
  name: string;
  limit: number;
  windowMs: number;
  scope?: (req: Request) => string;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const window = Math.floor(Date.now() / options.windowMs);
    const key = `nilo:rl:${options.name}:${options.scope?.(req) ?? ''}:${req.ip ?? 'unknown'}:${window}`;
    const count = await hit(key, options.windowMs);
    if (count > options.limit) {
      res.setHeader('Retry-After', String(Math.ceil(options.windowMs / 1000)));
      res.status(429).json({ error: 'Too many requests, try again shortly' });
      return;
    }
    next();
  };
}

/** For tests: forget the in-process windows. */
export function resetLocalRateLimits(): void {
  local.clear();
}
