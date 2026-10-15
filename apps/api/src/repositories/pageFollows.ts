import { and, eq } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';
import { pageFollows } from '../db/schema/collab.js';

export async function follow(db: PgHandle, pageId: string, userId: string): Promise<void> {
  await db.insert(pageFollows).values({ pageId, userId }).onConflictDoNothing();
}

export async function unfollow(db: PgHandle, pageId: string, userId: string): Promise<void> {
  await db
    .delete(pageFollows)
    .where(and(eq(pageFollows.pageId, pageId), eq(pageFollows.userId, userId)));
}

export async function isFollowing(db: PgHandle, pageId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ pageId: pageFollows.pageId })
    .from(pageFollows)
    .where(and(eq(pageFollows.pageId, pageId), eq(pageFollows.userId, userId)));
  return Boolean(row);
}

export async function listFollowers(db: PgHandle, pageId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: pageFollows.userId })
    .from(pageFollows)
    .where(eq(pageFollows.pageId, pageId));
  return rows.map((r) => r.userId);
}
