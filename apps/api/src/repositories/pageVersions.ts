import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';
import { pages, pageVersions, type VersionBlock } from '../db/schema/pages.js';
import type { BlockRow } from './blocks.js';

/** How long edits may go on before the state before them is kept again. */
export const VERSION_INTERVAL_MS = 10 * 60 * 1000;
/** Versions kept per page; older ones are dropped. */
export const PAGE_VERSIONS_KEPT = 200;

export type PageVersionRow = typeof pageVersions.$inferSelect;

export interface VersionSummary {
  id: string;
  createdAt: Date;
  createdBy: string;
  blockCount: number;
}

const asVersionBlocks = (rows: readonly BlockRow[]): VersionBlock[] =>
  rows.map((b) => ({
    id: b.id,
    parentBlockId: b.parentBlockId,
    type: b.type,
    content: b.content,
    order: b.order,
  }));

/**
 * Keep the page's blocks as they are now — before a change by `actorId` —
 * when the last version is older than `VERSION_INTERVAL_MS` (or `force`), and
 * drop versions beyond `PAGE_VERSIONS_KEPT`. Called inside the transaction
 * that makes the change, with the page locked. An empty page with no history
 * is not worth a version.
 */
export async function snapshotPage(
  db: PgHandle,
  input: { pageId: string; rows: readonly BlockRow[]; actorId: string; force?: boolean },
): Promise<boolean> {
  const [latest] = await db
    .select({ createdAt: pageVersions.createdAt })
    .from(pageVersions)
    .where(eq(pageVersions.pageId, input.pageId))
    .orderBy(desc(pageVersions.createdAt))
    .limit(1);
  if (!input.force) {
    if (latest && Date.now() - latest.createdAt.getTime() < VERSION_INTERVAL_MS) return false;
    if (!latest && input.rows.length === 0) return false;
  }
  const [page] = await db
    .select({ version: pages.blocksVersion })
    .from(pages)
    .where(eq(pages.id, input.pageId));
  await db.insert(pageVersions).values({
    pageId: input.pageId,
    blocksVersion: page?.version ?? 0,
    blocks: asVersionBlocks(input.rows),
    createdBy: input.actorId,
  });
  const kept = db
    .select({ id: pageVersions.id })
    .from(pageVersions)
    .where(eq(pageVersions.pageId, input.pageId))
    .orderBy(desc(pageVersions.createdAt), desc(pageVersions.id))
    .limit(PAGE_VERSIONS_KEPT);
  await db
    .delete(pageVersions)
    .where(and(eq(pageVersions.pageId, input.pageId), notInArray(pageVersions.id, kept)));
  return true;
}

/** The page's versions, newest first. */
export async function listPageVersions(db: PgHandle, pageId: string): Promise<VersionSummary[]> {
  const rows = await db
    .select({
      id: pageVersions.id,
      createdAt: pageVersions.createdAt,
      createdBy: pageVersions.createdBy,
      blockCount: sql<number>`jsonb_array_length(${pageVersions.blocks})::int`,
    })
    .from(pageVersions)
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(desc(pageVersions.createdAt), desc(pageVersions.id));
  return rows;
}

export async function findPageVersion(
  db: PgHandle,
  pageId: string,
  versionId: string,
): Promise<PageVersionRow | undefined> {
  const [row] = await db
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.id, versionId)));
  return row;
}
