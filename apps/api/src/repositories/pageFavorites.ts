import { and, eq, sql } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';
import { pageFavorites, pages } from '../db/schema/pages.js';

/** Stars a page for one person, at the end of their Favorites. Starring it again changes nothing. */
export async function favorite(db: PgHandle, pageId: string, userId: string): Promise<void> {
  await db
    .insert(pageFavorites)
    .values({
      pageId,
      userId,
      order: sql`(select coalesce(max(${pageFavorites.order}), 0) + 1 from ${pageFavorites} where ${pageFavorites.userId} = ${userId})`,
    })
    .onConflictDoNothing();
}

export async function unfavorite(db: PgHandle, pageId: string, userId: string): Promise<void> {
  await db
    .delete(pageFavorites)
    .where(and(eq(pageFavorites.pageId, pageId), eq(pageFavorites.userId, userId)));
}

export async function isFavorited(db: PgHandle, pageId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ pageId: pageFavorites.pageId })
    .from(pageFavorites)
    .where(and(eq(pageFavorites.pageId, pageId), eq(pageFavorites.userId, userId)));
  return Boolean(row);
}

/** The pages of a workspace one person has starred: what `favorited` says for them. */
export async function listFavoritedIds(
  db: PgHandle,
  userId: string,
  workspaceId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ pageId: pageFavorites.pageId })
    .from(pageFavorites)
    .innerJoin(pages, eq(pages.id, pageFavorites.pageId))
    .where(and(eq(pageFavorites.userId, userId), eq(pages.workspaceId, workspaceId)));
  return new Set(rows.map((r) => r.pageId));
}
