/**
 * Keeping Oxy's record of the files Nilo uses equal to `page_files` (Oxy ADR
 * 0043, `docs/files.md`).
 *
 * The reference itself is the owner's: their app links the file to the page
 * it was uploaded to, with their session, and that is also what lets Oxy mint
 * URLs for it to Nilo (ADR 0021). Nilo's part is to let go:
 *
 * - **Removal.** Deleting a `page_files` row queues its reference in
 *   `file_reference_removals` (a trigger, in the same statement). A drain on
 *   every API task sends the queue with Nilo's service token
 *   (`assets.references.remove`, scope `files:references:write`), backing off
 *   while Oxy cannot be told and never dropping a removal.
 * - **Once a day** (one task, by lease): the attachments nothing holds any
 *   more are let go (`releaseOrphanedPageFiles`); attachments marked removed
 *   that may have come back are asked about again; applied file events Oxy can
 *   no longer redeliver are forgotten; and the `'page'` references are
 *   reconciled with `page_files` (`assets.references.reconcile`) and
 *   committed — as a dry run only while an attachment names no page, whose
 *   reference the inventory cannot list.
 */
import { NILO_FILE_ENTITY_TYPE } from '@oxy.so/nilo-contracts';
import { getDb, type PgHandle } from '../db/client.js';
import { oxyClient } from '../middleware/auth.js';
import {
  claimReferenceRemovals,
  countUnnamedPageFiles,
  deferReferenceRemovals,
  failFileReferenceJob,
  finishFileReferenceJob,
  finishReferenceRemovals,
  type InventoryCursor,
  leaseFileReferenceJob,
  listRecoverableFileIds,
  pageFileInventoryPage,
  pruneActiveFileStatuses,
  pruneOxyFileEvents,
  releaseOrphanedPageFiles,
  setOxyFileStatus,
} from '../repositories/fileReferences.js';
import { mintFileUrls } from './files.js';
import { log } from './logger.js';

/** How often each task looks for removals to send. */
export const DRAIN_INTERVAL_MS = 30_000;
/** Removals sent per request: Oxy's batch limit. */
const DRAIN_BATCH = 100;
/** How often each task asks whether the daily run is due. */
const DAILY_TICK_MS = 10 * 60_000;
const DAILY_EVERY_MS = 24 * 60 * 60_000;
/** Longer than any run takes; a task that dies mid-run frees it when it runs out. */
const DAILY_LEASE_MS = 2 * 60 * 60_000;
/** A failed run is tried again after this. */
const DAILY_RETRY_MS = 60 * 60_000;
const ORPHAN_BATCH = 200;
const ORPHAN_BATCHES_PER_RUN = 50;
const RECOVERY_BATCH = 500;
const INVENTORY_PAGE = 1000;
/** Oxy stops redelivering an event 30 days after it was made. */
const EVENT_MEMORY_MS = 31 * 24 * 60 * 60_000;
/**
 * How long the inventory waits after the reconciliation opens. Oxy removes
 * only references made BEFORE it opened that the inventory leaves out, and an
 * upload is linked by the member's app a moment before it is recorded here:
 * a file linked just before the opening and recorded just after the
 * inventory was read would lose its reference — and with it, irrecoverably,
 * the owner's grant that lets Oxy serve it to Nilo. Every upload in flight at
 * the opening has been recorded (or abandoned) well within this.
 */
export const RECONCILE_GRACE_MS = 5 * 60_000;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Send one batch of due removals to Oxy; returns how many were settled and how many deferred. */
export async function drainReferenceRemovals(
  db: PgHandle,
  now: Date = new Date(),
): Promise<{ sent: number; deferred: number }> {
  const claimed = await claimReferenceRemovals(db, DRAIN_BATCH, now);
  if (claimed.length === 0) return { sent: 0, deferred: 0 };
  try {
    // `removed` and `not_found` (already gone — a deleted file, an earlier
    // attempt whose answer was lost) both settle a removal.
    await oxyClient.assets.references.remove(
      claimed.map(({ fileId, entityType, entityId }) => ({ fileId, entityType, entityId })),
    );
  } catch (err: unknown) {
    log.general.warn(
      { err, count: claimed.length },
      'Oxy file references could not be removed; retrying later',
    );
    await deferReferenceRemovals(db, claimed, errorMessage(err), now);
    return { sent: 0, deferred: claimed.length };
  }
  await finishReferenceRemovals(
    db,
    claimed.map((row) => row.id),
  );
  return { sent: claimed.length, deferred: 0 };
}

/** The `'page'` inventory: every (file, page) reference Nilo holds. */
async function* pageInventory(
  db: PgHandle,
  graceMs: number,
): AsyncGenerator<{ fileId: string; entityId: string }> {
  if (graceMs > 0) await new Promise((resolve) => setTimeout(resolve, graceMs));
  let after: InventoryCursor | null = null;
  for (;;) {
    const page = await pageFileInventoryPage(db, after, INVENTORY_PAGE);
    yield* page;
    if (page.length < INVENTORY_PAGE) return;
    after = page[page.length - 1] ?? null;
  }
}

const isInProgress = (err: unknown) => {
  const e = err as { status?: number; response?: { status?: number }; code?: string } | null;
  return (
    e?.status === 409 || e?.response?.status === 409 || e?.code === 'RECONCILIATION_IN_PROGRESS'
  );
};

export interface DailyRunOptions {
  now?: Date;
  /** For tests; see {@link RECONCILE_GRACE_MS}. */
  graceMs?: number;
}

/** The once-a-day run; returns its report. */
export async function runDailyFileWork(
  db: PgHandle,
  options: DailyRunOptions = {},
): Promise<Record<string, unknown>> {
  const now = options.now ?? new Date();

  let released = 0;
  for (let batch = 0; batch < ORPHAN_BATCHES_PER_RUN; batch++) {
    const ids = await releaseOrphanedPageFiles(db, ORPHAN_BATCH);
    released += ids.length;
    if (ids.length < ORPHAN_BATCH) break;
  }

  const forgetBefore = new Date(now.getTime() - EVENT_MEMORY_MS);
  const prunedEvents = await pruneOxyFileEvents(db, forgetBefore);
  await pruneActiveFileStatuses(db, forgetBefore);

  // A restore or an unblock whose event never arrived: Oxy serves the file to
  // Nilo again exactly when it is active again.
  let recovered = 0;
  const recoverable = await listRecoverableFileIds(db, RECOVERY_BATCH);
  if (recoverable.length > 0) {
    const minted = await mintFileUrls(recoverable);
    for (const fileId of minted.keys()) {
      if (await setOxyFileStatus(db, fileId, 'active', now)) recovered += 1;
    }
  }

  let reconcile: Record<string, unknown>;
  const unnamed = await countUnnamedPageFiles(db);
  // An attachment whose reference cannot be named would be read as stale and
  // its owner's grant removed: no commit while there is one.
  const dryRun = unnamed > 0;
  try {
    const result = await oxyClient.assets.references.reconcile(
      NILO_FILE_ENTITY_TYPE,
      pageInventory(db, options.graceMs ?? RECONCILE_GRACE_MS),
      { dryRun },
    );
    reconcile = {
      dryRun,
      unnamed,
      added: result.added,
      removed: result.removed,
      unchanged: result.unchanged,
      refused: result.refused,
    };
    if (dryRun) {
      log.general.warn(
        { unnamed },
        'File references reconciled as a dry run: attachments without a page id (docs/files.md)',
      );
    }
  } catch (err: unknown) {
    if (!isInProgress(err)) throw err;
    reconcile = { dryRun, unnamed, skipped: 'in_progress' };
  }

  const report = { released, prunedEvents, recovered, reconcile };
  log.general.info(report, 'Daily file reference run finished');
  return report;
}

/** Take the daily run if it is due and this task gets the lease. */
export async function runDailyFileWorkIfDue(
  db: PgHandle,
  options: DailyRunOptions = {},
): Promise<Record<string, unknown> | null> {
  const now = options.now ?? new Date();
  if (!(await leaseFileReferenceJob(db, 'nightly', DAILY_EVERY_MS, DAILY_LEASE_MS, now))) {
    return null;
  }
  try {
    const report = await runDailyFileWork(db, options);
    await finishFileReferenceJob(db, 'nightly', report);
    return report;
  } catch (err: unknown) {
    log.general.error({ err }, 'Daily file reference run failed; retrying in an hour');
    await failFileReferenceJob(db, 'nightly', errorMessage(err), DAILY_RETRY_MS);
    return null;
  }
}

let drainTimer: ReturnType<typeof setInterval> | null = null;
let dailyTimer: ReturnType<typeof setInterval> | null = null;
let draining = false;

/** Start the drain and the daily tick in this process; idempotent. */
export function startFileReferenceWork(): void {
  if (drainTimer) return;
  drainTimer = setInterval(() => {
    if (draining) return;
    draining = true;
    drainReferenceRemovals(getDb())
      .catch((err: unknown) => log.general.error({ err }, 'File reference drain failed'))
      .finally(() => {
        draining = false;
      });
  }, DRAIN_INTERVAL_MS);
  drainTimer.unref?.();
  dailyTimer = setInterval(() => {
    runDailyFileWorkIfDue(getDb()).catch((err: unknown) =>
      log.general.error({ err }, 'Daily file reference tick failed'),
    );
  }, DAILY_TICK_MS);
  dailyTimer.unref?.();
}

export function stopFileReferenceWork(): void {
  if (drainTimer) clearInterval(drainTimer);
  if (dailyTimer) clearInterval(dailyTimer);
  drainTimer = null;
  dailyTimer = null;
}
