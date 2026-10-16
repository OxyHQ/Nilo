import { and, asc, count, eq, gt, isNotNull, isNull, lte, max, sql } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';
import { pageDocs, pageUpdates } from '../db/schema/pages.js';

/** The bytes as the `bytea` column takes them, without copying. */
const asBuffer = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** A page's compacted snapshot, or undefined before the first one. */
export async function findPageDoc(
  db: PgHandle,
  pageId: string,
): Promise<{ state: Uint8Array; throughId: number; projectedThroughId: number } | undefined> {
  const [row] = await db
    .select({
      state: pageDocs.state,
      throughId: pageDocs.throughId,
      projectedThroughId: pageDocs.projectedThroughId,
    })
    .from(pageDocs)
    .where(eq(pageDocs.pageId, pageId));
  return row;
}

/** The updates after `afterId`, in the order they arrived. */
export async function listPageUpdates(
  db: PgHandle,
  pageId: string,
  afterId: number,
): Promise<{ id: number; update: Uint8Array }[]> {
  return db
    .select({ id: pageUpdates.id, update: pageUpdates.update })
    .from(pageUpdates)
    .where(and(eq(pageUpdates.pageId, pageId), gt(pageUpdates.id, afterId)))
    .orderBy(asc(pageUpdates.id));
}

export async function appendPageUpdate(
  db: PgHandle,
  input: { pageId: string; update: Uint8Array; actorId: string },
): Promise<number> {
  const [row] = await db
    .insert(pageUpdates)
    .values({ ...input, update: asBuffer(input.update) })
    .returning({ id: pageUpdates.id });
  if (!row) throw new Error('page_updates insert returned nothing');
  // The first update after a projection marks the page for the next one. Only
  // that first one writes: the row is left alone while it is already marked.
  await db
    .update(pageDocs)
    .set({ dirtySince: sql`now()` })
    .where(and(eq(pageDocs.pageId, input.pageId), isNull(pageDocs.dirtySince)));
  return row.id;
}

/** Who sent each update after `afterId` up to `throughId`, in arrival order. */
export async function listUpdateActors(
  db: PgHandle,
  pageId: string,
  afterId: number,
  throughId: number,
): Promise<string[]> {
  const rows = await db
    .select({ actorId: pageUpdates.actorId })
    .from(pageUpdates)
    .where(
      and(
        eq(pageUpdates.pageId, pageId),
        gt(pageUpdates.id, afterId),
        lte(pageUpdates.id, throughId),
      ),
    )
    .orderBy(asc(pageUpdates.id));
  return rows.map((row) => row.actorId);
}

/**
 * Record that the rows show every update through `throughId`. Called holding
 * the page's row lock, which keeps updates out until it commits: none can
 * arrive between the read and this.
 */
export async function markProjected(
  db: PgHandle,
  pageId: string,
  throughId: number,
): Promise<void> {
  await db
    .update(pageDocs)
    .set({ projectedThroughId: throughId, dirtySince: null })
    .where(eq(pageDocs.pageId, pageId));
}

/** Pages with updates their rows do not show yet, marked before `before`, oldest first. */
export async function listDirtyPages(db: PgHandle, before: Date, limit: number): Promise<string[]> {
  const rows = await db
    .select({ pageId: pageDocs.pageId })
    .from(pageDocs)
    .where(and(isNotNull(pageDocs.dirtySince), lte(pageDocs.dirtySince, before)))
    .orderBy(asc(pageDocs.dirtySince))
    .limit(limit);
  return rows.map((row) => row.pageId);
}

/**
 * Mark every page with an update its rows do not show, whatever wrote it
 * (an image from before the mark existed): one still waiting, or one already
 * folded into the snapshot past what was projected. Answers how many.
 */
export async function markUnprojectedPages(db: PgHandle): Promise<number> {
  const marked = await db
    .update(pageDocs)
    .set({ dirtySince: sql`now()` })
    .where(
      and(
        isNull(pageDocs.dirtySince),
        sql`(${pageDocs.throughId} > ${pageDocs.projectedThroughId} or exists (select 1 from ${pageUpdates} where ${pageUpdates.pageId} = ${pageDocs.pageId} and ${pageUpdates.id} > ${pageDocs.projectedThroughId}))`,
      ),
    )
    .returning({ pageId: pageDocs.pageId });
  return marked.length;
}

/** How many updates wait after the snapshot, and the newest one's id. */
export async function pendingPageUpdates(
  db: PgHandle,
  pageId: string,
  afterId: number,
): Promise<{ count: number; lastId: number | null }> {
  const [row] = await db
    .select({ count: count(), lastId: max(pageUpdates.id) })
    .from(pageUpdates)
    .where(and(eq(pageUpdates.pageId, pageId), gt(pageUpdates.id, afterId)));
  return { count: row?.count ?? 0, lastId: row?.lastId ?? null };
}

/** Store a snapshot covering every update up to `throughId`, and drop those updates. */
export async function savePageDoc(
  db: PgHandle,
  input: { pageId: string; state: Uint8Array; throughId: number },
): Promise<void> {
  const state = asBuffer(input.state);
  await db
    .insert(pageDocs)
    .values({ ...input, state })
    .onConflictDoUpdate({
      target: pageDocs.pageId,
      set: { state, throughId: input.throughId, updatedAt: new Date() },
    });
  await db
    .delete(pageUpdates)
    .where(and(eq(pageUpdates.pageId, input.pageId), lte(pageUpdates.id, input.throughId)));
}
