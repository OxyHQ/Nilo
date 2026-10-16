import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';
import { blocks, pageFiles } from '../db/schema/pages.js';

export type PageFileRow = typeof pageFiles.$inferSelect;

/**
 * Record an attachment. A file belongs to one workspace: recording it again
 * there changes nothing, and the existing row is returned either way so the
 * caller can tell a retry from a file another workspace already holds.
 */
export async function recordPageFile(
  db: PgHandle,
  row: typeof pageFiles.$inferInsert,
): Promise<PageFileRow> {
  await db.insert(pageFiles).values(row).onConflictDoNothing();
  const [stored] = await db.select().from(pageFiles).where(eq(pageFiles.fileId, row.fileId));
  if (!stored) throw new Error('page_files row vanished after insert');
  return stored;
}

/**
 * Of `fileIds`, the ones `page` may show: files of its workspace that were
 * uploaded to it, or that one of its blocks holds (a copied or duplicated
 * block keeps its file).
 */
export async function servableFileIds(
  db: PgHandle,
  page: { id: string; workspaceId: string },
  fileIds: readonly string[],
): Promise<string[]> {
  if (fileIds.length === 0) return [];
  const rows = await db
    .select({ fileId: pageFiles.fileId, pageId: pageFiles.pageId })
    .from(pageFiles)
    .where(
      and(eq(pageFiles.workspaceId, page.workspaceId), inArray(pageFiles.fileId, [...fileIds])),
    );
  const servable = new Set(rows.filter((r) => r.pageId === page.id).map((r) => r.fileId));
  const elsewhere = rows.filter((r) => r.pageId !== page.id).map((r) => r.fileId);
  if (elsewhere.length > 0) {
    const held = await db
      .selectDistinct({ fileId: sql<string>`${blocks.content} ->> 'fileId'` })
      .from(blocks)
      .where(
        and(eq(blocks.pageId, page.id), inArray(sql`${blocks.content} ->> 'fileId'`, elsewhere)),
      );
    for (const { fileId } of held) servable.add(fileId);
  }
  return fileIds.filter((id) => servable.has(id));
}
