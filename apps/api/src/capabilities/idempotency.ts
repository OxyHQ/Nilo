/**
 * Apply one effectful tool call once per account, tool and idempotency key.
 *
 * A transaction-scoped advisory lock closes the race between finding no
 * receipt and writing; the receipt commits in the transaction of the write,
 * so a crash cannot keep one without the other.
 */
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, type PgHandle } from '../db/client.js';
import { capabilityExecutions } from '../db/schema/capabilities.js';

export class IdempotencyConflictError extends Error {
  constructor() {
    super('The idempotency key was already used with different input');
    this.name = 'IdempotencyConflictError';
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function digestCapabilityInput(input: Readonly<Record<string, unknown>>): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(input)))
    .digest('hex');
}

export async function executeIdempotently<Result extends Record<string, unknown>>(input: {
  accountId: string;
  tool: string;
  idempotencyKey: string;
  request: Readonly<Record<string, unknown>>;
  execute: (tx: PgHandle) => Promise<Result>;
}): Promise<{ result: Result; replayed: boolean }> {
  const requestDigest = digestCapabilityInput(input.request);
  const lockIdentity = JSON.stringify([input.accountId, input.tool, input.idempotencyKey]);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))`);
    const [existing] = await tx
      .select({
        requestDigest: capabilityExecutions.requestDigest,
        result: capabilityExecutions.result,
      })
      .from(capabilityExecutions)
      .where(
        and(
          eq(capabilityExecutions.accountId, input.accountId),
          eq(capabilityExecutions.tool, input.tool),
          eq(capabilityExecutions.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (existing) {
      if (existing.requestDigest !== requestDigest) throw new IdempotencyConflictError();
      return { result: existing.result as Result, replayed: true };
    }
    const result = await input.execute(tx);
    await tx.insert(capabilityExecutions).values({
      accountId: input.accountId,
      tool: input.tool,
      idempotencyKey: input.idempotencyKey,
      requestDigest,
      result,
    });
    return { result, replayed: false };
  });
}
