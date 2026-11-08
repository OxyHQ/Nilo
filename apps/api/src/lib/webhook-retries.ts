/**
 * Automation webhooks that did not get through. After its quick tries a failed
 * delivery is queued here and tried again after `RETRY_AFTER_MS[attempt]`; a
 * sweep claims what is due (`FOR UPDATE SKIP LOCKED`, so API instances never
 * take the same one) and leases it for `LEASE_MS`, so an instance that dies in
 * the middle leaves it to the next sweep. Every try carries the first one's
 * delivery id. A delivered, refused or exhausted webhook leaves the queue.
 */
import { and, asc, eq, lte } from 'drizzle-orm';
import { getDb, type PgHandle } from '../db/client.js';
import { automationWebhookRetries, databaseAutomations } from '../db/schema/automations.js';
import { attemptWebhook } from './databases/automations.js';
import { log } from './logger.js';

/** The wait before each queued try: a minute, ten minutes, an hour. */
export const retryAfter = { delaysMs: [60_000, 10 * 60_000, 60 * 60_000] };
const LEASE_MS = 5 * 60_000;
const SWEEP_BATCH = 50;
export const WEBHOOK_RETRY_SWEEP_INTERVAL_MS = 60 * 1000;

export async function queueWebhookRetry(
  db: PgHandle,
  w: { automationId: string; url: string; body: string; deliveryId: string },
  now: Date = new Date(),
): Promise<void> {
  await db
    .insert(automationWebhookRetries)
    .values({ ...w, nextAttemptAt: new Date(now.getTime() + (retryAfter.delaysMs[0] ?? 0)) });
}

/** Try what is due by `now`; returns how many deliveries were attempted. */
export async function runDueWebhookRetries(db: PgHandle, now: Date = new Date()): Promise<number> {
  const claimed = await db.transaction(async (tx) => {
    const due = await tx
      .select({ retry: automationWebhookRetries, secret: databaseAutomations.secret })
      .from(automationWebhookRetries)
      .innerJoin(
        databaseAutomations,
        eq(databaseAutomations.id, automationWebhookRetries.automationId),
      )
      .where(lte(automationWebhookRetries.nextAttemptAt, now))
      .orderBy(asc(automationWebhookRetries.nextAttemptAt))
      .limit(SWEEP_BATCH)
      .for('update', { of: automationWebhookRetries, skipLocked: true });
    for (const { retry } of due) {
      await tx
        .update(automationWebhookRetries)
        .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
        .where(eq(automationWebhookRetries.id, retry.id));
    }
    return due;
  });
  for (const { retry, secret } of claimed) {
    const done = () =>
      db.delete(automationWebhookRetries).where(eq(automationWebhookRetries.id, retry.id));
    try {
      const result = await attemptWebhook(retry.url, secret, retry.body, retry.deliveryId);
      const next = retryAfter.delaysMs[retry.attempt + 1];
      if (result.kind === 'again' && next !== undefined) {
        await db
          .update(automationWebhookRetries)
          .set({ attempt: retry.attempt + 1, nextAttemptAt: new Date(Date.now() + next) })
          .where(
            and(
              eq(automationWebhookRetries.id, retry.id),
              eq(automationWebhookRetries.attempt, retry.attempt),
            ),
          );
        continue;
      }
      if (result.kind !== 'ok') {
        log.general.warn(
          { automationId: retry.automationId, error: result.error },
          'A webhook was given up on',
        );
      }
      await done();
    } catch (err: unknown) {
      // Refused address: it will not change. Drop it.
      log.general.warn({ err, automationId: retry.automationId }, 'A webhook was refused');
      await done();
    }
  }
  return claimed.length;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start sweeping in this process; idempotent. */
export function startWebhookRetries(): void {
  if (timer) return;
  timer = setInterval(() => {
    runDueWebhookRetries(getDb()).catch((err: unknown) =>
      log.general.error({ err }, 'Webhook retry sweep failed'),
    );
  }, WEBHOOK_RETRY_SWEEP_INTERVAL_MS);
  timer.unref?.();
}

export function stopWebhookRetries(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
