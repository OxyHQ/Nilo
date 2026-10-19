/**
 * Rate limits, as every Oxy backend does them: the SDK's `createOxyRateLimit`
 * (per signed-in user, else per hashed client address — never a raw IP), with
 * a Redis store on the shared Valkey when `REDIS_URL` is set, so every task
 * counts the same window. Without Redis each task counts on its own.
 *
 * Each limiter has its own `rl:<scope>:` prefix: limiters sharing one prefix
 * would increment the same keys and halve each other's budget.
 */
import { createOxyRateLimit } from '@oxy.so/core/server';
import type { RequestHandler } from 'express';
import { MemoryStore, type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { oxyClient } from '../middleware/auth.js';
import { getRedisClient } from './redis.js';

export type RateLimitScope =
  | 'general'
  | 'public-page'
  | 'form-read'
  | 'form-submit'
  | 'share-read'
  | 'share-join'
  | 'invite-link-read'
  | 'invite-link-join'
  | 'page-export-pdf'
  | 'button-webhook'
  | 'export-zip';

/** In-process stores, for tests to clear between cases. */
const memoryStores = new Set<MemoryStore>();

function storeFor(scope: RateLimitScope): Store {
  const redis = getRedisClient();
  if (redis) {
    return new RedisStore({
      prefix: `rl:${scope}:`,
      sendCommand: (command: string, ...args: string[]) =>
        redis.call(command, ...args) as Promise<number | string>,
    });
  }
  const memory = new MemoryStore();
  memoryStores.add(memory);
  return memory;
}

/**
 * At most `max` requests per `windowMs` for each caller of a scope. Signed-in
 * members and anonymous callers get the same budget unless `anonymousMax`
 * says otherwise. Answers 429 with the standard `RateLimit` headers.
 */
export function rateLimit(
  scope: RateLimitScope,
  options: { max?: number; anonymousMax?: number; windowMs?: number } = {},
): RequestHandler {
  return createOxyRateLimit(oxyClient, {
    ...(options.windowMs !== undefined && { windowMs: options.windowMs }),
    ...(options.max !== undefined && {
      authenticatedMax: options.max,
      anonymousMax: options.anonymousMax ?? options.max,
    }),
    store: storeFor(scope),
  });
}

/** For tests: forget the in-process windows. */
export async function resetLocalRateLimits(): Promise<void> {
  await Promise.all([...memoryStores].map((store) => store.resetAll()));
}
