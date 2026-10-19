import { and, desc, eq, sql } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';
import { pages, pageVisits } from '../db/schema/pages.js';

/** Record that `userId` opened `pageId` now (their Recents, on every device). */
export async function recordVisit(db: PgHandle, userId: string, pageId: string): Promise<Date> {
  const [row] = await db
    .insert(pageVisits)
    .values({ userId, pageId })
    .onConflictDoUpdate({
      target: [pageVisits.userId, pageVisits.pageId],
      set: { visitedAt: sql`now()` },
    })
    .returning({ visitedAt: pageVisits.visitedAt });
  return (row as { visitedAt: Date }).visitedAt;
}

/**
 * The pages of `workspaceId` that `userId` opened, the latest first: live
 * pages, not templates. Access is the caller's to filter (`rolesForPages`),
 * since a page visited once may have been closed to them since.
 */
export async function listRecentVisits(
  db: PgHandle,
  userId: string,
  workspaceId: string,
  limit: number,
): Promise<{ pageId: string; visitedAt: Date }[]> {
  return db
    .select({ pageId: pageVisits.pageId, visitedAt: pageVisits.visitedAt })
    .from(pageVisits)
    .innerJoin(pages, eq(pages.id, pageVisits.pageId))
    .where(
      and(
        eq(pageVisits.userId, userId),
        eq(pages.workspaceId, workspaceId),
        eq(pages.archived, false),
        eq(pages.template, false),
      ),
    )
    .orderBy(desc(pageVisits.visitedAt))
    .limit(limit);
}
