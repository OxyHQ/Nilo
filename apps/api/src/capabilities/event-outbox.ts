/**
 * Delivering `app_event_outbox` to Alia, at least once.
 *
 * Every API instance runs the worker. A batch claims rows for a lease
 * (`FOR UPDATE SKIP LOCKED`, so instances never take the same row), posts
 * each to Alia as Nilo's Oxy service, and acknowledges it once Alia took it.
 * A failure leaves the row for the next lease; after
 * `EVENT_OUTBOX_MAX_ATTEMPTS` it is set aside (`failedAt`) with its last
 * error. Alia dedupes on the event id (`idempotency-key`).
 *
 * The worker runs where Nilo has an Oxy identity (the deployed task role),
 * unless `APP_EVENT_OUTBOX_WORKER_ENABLED=false`; elsewhere events stay queued.
 */
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { type NormalizedAppEvent, normalizedAppEventSchema } from '@oxy.so/contracts';
import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb, type NiloDatabase } from '../db/client.js';
import { appEventOutbox } from '../db/schema/capabilities.js';
import { log } from '../lib/logger.js';
import { oxyServiceClient } from './oxy-service.js';

export const EVENT_OUTBOX_MAX_ATTEMPTS = 12;
export const EVENT_OUTBOX_LEASE_MS = 60_000;
const BATCH_SIZE = 50;
const POLL_INTERVAL_MS = 5_000;
const MAX_RECORDED_ERROR_LENGTH = 500;

export type EventDelivery = (event: NormalizedAppEvent) => Promise<void>;

function aliaApiUrl(): string {
  return (process.env.ALIA_API_URL ?? 'https://api.alia.onl').replace(/\/$/, '');
}

async function postEvent(event: NormalizedAppEvent, token: string): Promise<Response> {
  return fetch(`${aliaApiUrl()}/webhooks/oxy`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': event.eventId,
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(10_000),
  });
}

/** Post one event to Alia as Nilo; a stale token is renewed once. */
export async function deliverToAlia(event: NormalizedAppEvent): Promise<void> {
  const client = oxyServiceClient();
  if (!client) throw new Error('Nilo has no Oxy identity to deliver events with');
  let response = await postEvent(event, await client.serviceToken());
  if (response.status === 401) {
    client.invalidateServiceToken();
    response = await postEvent(event, await client.serviceToken());
  }
  if (!response.ok) throw new Error(`Alia refused the event (${response.status})`);
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_RECORDED_ERROR_LENGTH
    ? `${message.slice(0, MAX_RECORDED_ERROR_LENGTH)}…`
    : message;
}

export interface EventOutboxBatchResult {
  claimed: number;
  processed: number;
  failed: number;
  deadLettered: number;
}

/** Claim, deliver and settle one batch. */
export async function runEventOutboxBatch(options: {
  ownerId: string;
  db?: NiloDatabase;
  deliver?: EventDelivery;
  batchSize?: number;
  leaseMs?: number;
}): Promise<EventOutboxBatchResult> {
  const db = options.db ?? getDb();
  const deliver = options.deliver ?? deliverToAlia;
  const leaseExpired = new Date(Date.now() - (options.leaseMs ?? EVENT_OUTBOX_LEASE_MS));
  const claimable = db
    .select({ id: appEventOutbox.id })
    .from(appEventOutbox)
    .where(
      and(
        isNull(appEventOutbox.processedAt),
        isNull(appEventOutbox.failedAt),
        or(isNull(appEventOutbox.claimedAt), lt(appEventOutbox.claimedAt, leaseExpired)),
      ),
    )
    .orderBy(asc(appEventOutbox.createdAt))
    .limit(options.batchSize ?? BATCH_SIZE)
    .for('update', { skipLocked: true });
  const claimed = await db
    .update(appEventOutbox)
    .set({
      claimedAt: new Date(),
      claimedBy: options.ownerId,
      attempts: sql`${appEventOutbox.attempts} + 1`,
    })
    .where(inArray(appEventOutbox.id, claimable))
    .returning({
      id: appEventOutbox.id,
      eventId: appEventOutbox.eventId,
      event: appEventOutbox.event,
      attempts: appEventOutbox.attempts,
    });

  const result: EventOutboxBatchResult = {
    claimed: claimed.length,
    processed: 0,
    failed: 0,
    deadLettered: 0,
  };
  const ours = (id: string) =>
    and(
      eq(appEventOutbox.id, id),
      eq(appEventOutbox.claimedBy, options.ownerId),
      isNull(appEventOutbox.processedAt),
    );

  for (const row of claimed) {
    if (row.attempts > EVENT_OUTBOX_MAX_ATTEMPTS) {
      await db
        .update(appEventOutbox)
        .set({
          failedAt: new Date(),
          lastError: sql`coalesce(${appEventOutbox.lastError}, 'Attempt limit reached')`,
        })
        .where(ours(row.id));
      result.deadLettered += 1;
      continue;
    }
    try {
      await deliver(normalizedAppEventSchema.parse(row.event));
      const acknowledged = await db
        .update(appEventOutbox)
        .set({ processedAt: new Date(), lastError: null })
        .where(ours(row.id))
        .returning({ id: appEventOutbox.id });
      if (acknowledged.length === 1) result.processed += 1;
    } catch (error) {
      const deadLetter = row.attempts >= EVENT_OUTBOX_MAX_ATTEMPTS;
      await db
        .update(appEventOutbox)
        .set({ lastError: describeError(error), ...(deadLetter && { failedAt: new Date() }) })
        .where(ours(row.id));
      result.failed += 1;
      if (deadLetter) result.deadLettered += 1;
      log.general.warn(
        { eventId: row.eventId, attempts: row.attempts, deadLetter, err: error },
        'App event delivery failed',
      );
    }
  }
  return result;
}

const OWNER_ID = `${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    await runEventOutboxBatch({ ownerId: OWNER_ID });
  } catch (error) {
    log.general.error({ err: error }, 'App event outbox batch failed');
  } finally {
    inFlight = false;
  }
}

/** Start delivering in this process; idempotent. False where it does not run. */
export function startEventOutboxWorker(): boolean {
  if (process.env.APP_EVENT_OUTBOX_WORKER_ENABLED?.trim().toLowerCase() === 'false') return false;
  if (!oxyServiceClient()) {
    log.general.info('No Oxy identity: app events stay queued');
    return false;
  }
  if (timer) return true;
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  timer.unref?.();
  void tick();
  return true;
}

export function stopEventOutboxWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
