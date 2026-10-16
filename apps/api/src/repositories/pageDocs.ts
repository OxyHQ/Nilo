import { and, asc, count, eq, gt, lte, max } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';
import { pageDocs, pageUpdates } from '../db/schema/pages.js';

/** The bytes as the `bytea` column takes them, without copying. */
const asBuffer = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** A page's compacted snapshot, or undefined before the first one. */
export async function findPageDoc(
  db: PgHandle,
  pageId: string,
): Promise<{ state: Uint8Array; throughId: number } | undefined> {
  const [row] = await db
    .select({ state: pageDocs.state, throughId: pageDocs.throughId })
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
  return row.id;
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
