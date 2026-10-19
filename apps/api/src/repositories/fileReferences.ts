/**
 * The bookkeeping that keeps Oxy's record of Nilo's file uses equal to
 * `page_files` (Oxy ADR 0043, `docs/files.md`): the removal queue the
 * `page_files` trigger fills, the sweep that lets go of attachments nothing
 * holds any more, the inventory reconciliation sends, and the file events Oxy
 * sends back.
 */
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { PAGE_FILE_PREFIX } from '@oxy.so/nilo-contracts';
import type { PgHandle } from '../db/client.js';
import {
  type FileReferenceJob,
  fileReferenceRemovals,
  fileReferenceRuns,
  type OxyFileStatus,
  oxyFileEvents,
  oxyFileStatuses,
} from '../db/schema/files.js';
import { pageFiles } from '../db/schema/pages.js';

export type ReferenceRemovalRow = typeof fileReferenceRemovals.$inferSelect;

/** How long a claimed removal is left to the drain that claimed it before another may retry it. */
export const REMOVAL_LEASE_MS = 5 * 60_000;
/** The first retry waits this long, doubling each time … */
const REMOVAL_BACKOFF_BASE_MS = 60_000;
/** … up to this. A removal is never dropped: Oxy must hear of it. */
const REMOVAL_BACKOFF_MAX_MS = 6 * 60 * 60_000;

/** The wait before the attempt after `attempts` failed ones. */
export function removalBackoffMs(attempts: number): number {
  return Math.min(REMOVAL_BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), REMOVAL_BACKOFF_MAX_MS);
}

/**
 * Take up to `limit` due removals for this drain: each is leased (its next
 * attempt pushed {@link REMOVAL_LEASE_MS} ahead, its attempt counted) in the
 * transaction that selects it, `SKIP LOCKED`, so two API tasks never send the
 * same one, and one that dies mid-send is retried when the lease runs out.
 *
 * Due: never attempted (`attempts = 0`), or past its backoff or lease by
 * `now`. A removal no drain has claimed yet is due at once, whatever its
 * `nextAttemptAt` says: that column defaults to the DATABASE clock, in
 * microseconds — the `page_files` trigger writes the row — and `now` is the
 * task's, in milliseconds. A drain in the same millisecond as the delete, or
 * on a task whose clock is a little behind the database's, would otherwise
 * find the removal not yet due. Only a lease and a backoff, both written from
 * the task's clock, are read against it.
 */
export async function claimReferenceRemovals(
  db: PgHandle,
  limit: number,
  now: Date = new Date(),
): Promise<ReferenceRemovalRow[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: fileReferenceRemovals.id })
      .from(fileReferenceRemovals)
      .where(
        or(eq(fileReferenceRemovals.attempts, 0), lte(fileReferenceRemovals.nextAttemptAt, now)),
      )
      .orderBy(asc(fileReferenceRemovals.nextAttemptAt), asc(fileReferenceRemovals.id))
      .limit(limit)
      .for('update', { skipLocked: true });
    if (due.length === 0) return [];
    const leased = await tx
      .update(fileReferenceRemovals)
      .set({
        attempts: sql`${fileReferenceRemovals.attempts} + 1`,
        nextAttemptAt: new Date(now.getTime() + REMOVAL_LEASE_MS),
      })
      .where(
        inArray(
          fileReferenceRemovals.id,
          due.map((row) => row.id),
        ),
      )
      .returning();
    const byId = new Map(leased.map((row) => [row.id, row]));
    return due.flatMap((row) => byId.get(row.id) ?? []);
  });
}

/** Oxy has answered for these: they are done. */
export async function finishReferenceRemovals(db: PgHandle, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(fileReferenceRemovals).where(inArray(fileReferenceRemovals.id, [...ids]));
}

/**
 * Oxy could not be told: try each again after its backoff. `rows` are as
 * {@link claimReferenceRemovals} returned them, the failed attempt counted.
 */
export async function deferReferenceRemovals(
  db: PgHandle,
  rows: readonly Pick<ReferenceRemovalRow, 'id' | 'attempts'>[],
  error: string,
  now: Date = new Date(),
): Promise<void> {
  for (const row of rows) {
    await db
      .update(fileReferenceRemovals)
      .set({
        nextAttemptAt: new Date(now.getTime() + removalBackoffMs(row.attempts)),
        lastError: error.slice(0, 500),
      })
      .where(eq(fileReferenceRemovals.id, row.id));
  }
}

/** The SQL test for "this file's id occurs in `bytes`" — a conservative scan of a Yjs document. */
const bytesHold = (bytes: unknown) =>
  sql`position(convert_to(${pageFiles.fileId}, 'UTF8') in ${bytes}) > 0`;

/**
 * Delete up to `limit` attachments nothing in their workspace can show any
 * more, and return their file ids; the `page_files` trigger queues each
 * one's Oxy reference for removal in the same statement.
 *
 * An attachment stays while the page it was uploaded to exists (archived
 * pages included — the trash can give it back). Once that page is gone it
 * stays while anything in the workspace still holds the file: a block, a
 * page's icon or cover (a duplicate keeps them), a kept version of a page (restoring it brings the block back), or the page's
 * Yjs document itself — a change not projected to `blocks` yet. The document
 * test looks for the id's bytes in the stored state and updates, so it can
 * only err on the side of keeping a row, never of letting one go.
 */
export async function releaseOrphanedPageFiles(db: PgHandle, limit: number): Promise<string[]> {
  const sameWorkspace = sql`p.workspace_id = ${pageFiles.workspaceId}`;
  const orphans = db
    .select({ fileId: pageFiles.fileId })
    .from(pageFiles)
    .where(
      and(
        or(
          isNull(pageFiles.pageId),
          sql`not exists (select 1 from pages p where p.id = ${pageFiles.pageId})`,
        ),
        sql`not exists (
          select 1 from blocks b join pages p on p.id = b.page_id
          where ${sameWorkspace} and b.content ->> 'fileId' = ${pageFiles.fileId})`,
        sql`not exists (
          select 1 from pages p
          where ${sameWorkspace}
            and (${PAGE_FILE_PREFIX} || ${pageFiles.fileId}) in (p.icon, p.cover))`,
        sql`not exists (
          select 1 from page_versions v join pages p on p.id = v.page_id
          cross join lateral jsonb_array_elements(v.blocks) as e(block)
          where ${sameWorkspace} and e.block -> 'content' ->> 'fileId' = ${pageFiles.fileId})`,
        sql`not exists (
          select 1 from page_docs d join pages p on p.id = d.page_id
          where ${sameWorkspace} and ${bytesHold(sql`d.state`)})`,
        sql`not exists (
          select 1 from page_updates u join pages p on p.id = u.page_id
          where ${sameWorkspace} and ${bytesHold(sql`u.update`)})`,
      ),
    )
    .orderBy(asc(pageFiles.fileId))
    .limit(limit)
    .for('update', { skipLocked: true });
  const deleted = await db
    .delete(pageFiles)
    .where(inArray(pageFiles.fileId, orphans))
    .returning({ fileId: pageFiles.fileId });
  return deleted.map((row) => row.fileId);
}

/** A position in the `'page'` inventory: the last pair of the previous page. */
export interface InventoryCursor {
  fileId: string;
  entityId: string;
}

/**
 * One page of the `'page'` inventory after `after`, in (file, page) order:
 * every reference Nilo holds (`db/triggers.ts`) — each attachment and the page
 * it was uploaded to, and each file a live page's properties list (Noted's
 * attachments). Pages in the trash count: restoring one must find its files.
 */
export async function pageFileInventoryPage(
  db: PgHandle,
  after: InventoryCursor | null,
  limit: number,
): Promise<InventoryCursor[]> {
  const rows = await db.execute<{ file_id: string; entity_id: string }>(sql`
    select file_id, entity_id from (
      select pf.file_id, pf.page_id as entity_id from page_files pf where pf.page_id is not null
      union
      select f.file_id, p.id as entity_id
      from pages p cross join lateral nilo_property_file_ids(p.properties) as f(file_id)
    ) inventory
    where ${after === null ? sql`true` : sql`(file_id, entity_id) > (${after.fileId}, ${after.entityId})`}
    order by file_id, entity_id
    limit ${limit}
  `);
  return [...rows].map((row) => ({ fileId: row.file_id, entityId: row.entity_id }));
}

/**
 * Attachments whose Oxy reference cannot be named: recorded before 0039, on a
 * page since deleted, and still held by something. Reconciliation will not
 * commit while there are any (`lib/file-references.ts`, `docs/files.md`).
 */
export async function countUnnamedPageFiles(db: PgHandle): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pageFiles)
    .where(isNull(pageFiles.pageId));
  return row?.count ?? 0;
}

/** Of `fileIds`, the ones Oxy has said it no longer serves. */
export async function removedFileIds(
  db: PgHandle,
  fileIds: readonly string[],
): Promise<Set<string>> {
  if (fileIds.length === 0) return new Set();
  const rows = await db
    .select({ fileId: oxyFileStatuses.fileId })
    .from(oxyFileStatuses)
    .where(
      and(inArray(oxyFileStatuses.fileId, [...fileIds]), ne(oxyFileStatuses.status, 'active')),
    );
  return new Set(rows.map((row) => row.fileId));
}

/**
 * Record what Oxy says about a file as of `at`, unless something later is
 * already recorded: events can arrive out of order and more than once.
 * Returns whether the record changed.
 */
export async function setOxyFileStatus(
  db: PgHandle,
  fileId: string,
  status: OxyFileStatus,
  at: Date,
): Promise<boolean> {
  const written = await db
    .insert(oxyFileStatuses)
    .values({ fileId, status, statusAt: at })
    .onConflictDoUpdate({
      target: oxyFileStatuses.fileId,
      set: { status, statusAt: at },
      setWhere: lte(oxyFileStatuses.statusAt, at),
    })
    .returning({ fileId: oxyFileStatuses.fileId });
  return written.length > 0;
}

/**
 * Apply one file event once: the event id is recorded in the same transaction
 * as its effect, so a redelivery finds it and changes nothing. Returns false
 * for an event already applied.
 */
export async function applyOxyFileEvent(
  db: PgHandle,
  event: { id: string; type: string; fileId: string; status: OxyFileStatus | null; at: Date },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const fresh = await tx
      .insert(oxyFileEvents)
      .values({ eventId: event.id, type: event.type, fileId: event.fileId })
      .onConflictDoNothing()
      .returning({ eventId: oxyFileEvents.eventId });
    if (fresh.length === 0) return false;
    if (event.status) await setOxyFileStatus(tx, event.fileId, event.status, event.at);
    return true;
  });
}

/** Forget applied events Oxy can no longer redeliver. */
export async function pruneOxyFileEvents(db: PgHandle, before: Date): Promise<number> {
  const deleted = await db
    .delete(oxyFileEvents)
    .where(lt(oxyFileEvents.receivedAt, before))
    .returning({ eventId: oxyFileEvents.eventId });
  return deleted.length;
}

/**
 * Files marked removed that may have come back (trash and takedowns can be
 * undone; a deletion cannot), oldest mark first: the daily run asks Oxy about
 * them in case the event saying so was never delivered.
 */
export async function listRecoverableFileIds(db: PgHandle, limit: number): Promise<string[]> {
  const rows = await db
    .select({ fileId: oxyFileStatuses.fileId })
    .from(oxyFileStatuses)
    .where(inArray(oxyFileStatuses.status, ['trash', 'blocked']))
    .orderBy(asc(oxyFileStatuses.statusAt), asc(oxyFileStatuses.fileId))
    .limit(limit);
  return rows.map((row) => row.fileId);
}

/**
 * Forget `active` records older than Oxy's redelivery window: no event older
 * than them can still arrive, and a file with no record is `active`.
 */
export async function pruneActiveFileStatuses(db: PgHandle, before: Date): Promise<number> {
  const deleted = await db
    .delete(oxyFileStatuses)
    .where(and(eq(oxyFileStatuses.status, 'active'), lt(oxyFileStatuses.statusAt, before)))
    .returning({ fileId: oxyFileStatuses.fileId });
  return deleted.length;
}

/**
 * Take the lease on `job` when it is due: not leased by a live run, and not
 * finished within `everyMs`. Returns false when another task has it or it is
 * not due.
 */
export async function leaseFileReferenceJob(
  db: PgHandle,
  job: FileReferenceJob,
  everyMs: number,
  leaseMs: number,
  now: Date = new Date(),
): Promise<boolean> {
  await db.insert(fileReferenceRuns).values({ job }).onConflictDoNothing();
  const leased = await db
    .update(fileReferenceRuns)
    .set({ leasedUntil: new Date(now.getTime() + leaseMs), startedAt: now })
    .where(
      and(
        eq(fileReferenceRuns.job, job),
        or(isNull(fileReferenceRuns.leasedUntil), lt(fileReferenceRuns.leasedUntil, now)),
        or(
          isNull(fileReferenceRuns.finishedAt),
          lt(fileReferenceRuns.finishedAt, new Date(now.getTime() - everyMs)),
        ),
      ),
    )
    .returning({ job: fileReferenceRuns.job });
  return leased.length > 0;
}

/**
 * The run failed: keep it from every task's next tick for `retryMs` (the
 * lease runs out then), with the error as its report; `finishedAt` stays,
 * so it is still due.
 */
export async function failFileReferenceJob(
  db: PgHandle,
  job: FileReferenceJob,
  error: string,
  retryMs: number,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(fileReferenceRuns)
    .set({
      leasedUntil: new Date(now.getTime() + retryMs),
      report: { failedAt: now.toISOString(), error: error.slice(0, 500) },
    })
    .where(eq(fileReferenceRuns.job, job));
}

/** The run is over: record its report and free the lease. */
export async function finishFileReferenceJob(
  db: PgHandle,
  job: FileReferenceJob,
  report: Record<string, unknown>,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(fileReferenceRuns)
    .set({ leasedUntil: null, finishedAt: now, report })
    .where(eq(fileReferenceRuns.job, job));
}
