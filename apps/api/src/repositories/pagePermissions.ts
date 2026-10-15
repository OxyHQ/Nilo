import { and, eq, inArray, sql } from 'drizzle-orm';
import { sqlColumnName } from '@oxy.so/db';
import type { PgHandle } from '../db/client.js';
import { type PageGrantRole, pagePermissions } from '../db/schema/collab.js';
import { databases } from '../db/schema/databases.js';
import { pages } from '../db/schema/pages.js';
import { BREADCRUMB_MAX_DEPTH } from './pages.js';

export type PagePermissionRow = typeof pagePermissions.$inferSelect;

/** A page and the pages above it, nearest first, with what access needs from each. */
export interface ChainLink {
  id: string;
  parentId: string | null;
  workspaceId: string;
  restricted: boolean;
}

/**
 * `id` and its ancestors, the page first. Stops at a cycle and at the same
 * depth as the breadcrumb, so a corrupted ancestry cannot loop.
 *
 * A database row has no parent page of its own: above it is the page its
 * database sits in (`databases.parentPageId`), so a row of an inline
 * database inherits that page's access — a restricted page's rows are as
 * private as the page.
 */
export async function findPageChain(db: PgHandle, id: string): Promise<ChainLink[]> {
  const col = (c: Parameters<typeof sqlColumnName>[0]) => sql.identifier(sqlColumnName(c));
  const rows = await db.execute(sql`
    with recursive chain as (
      select ${pages.id}, ${pages.parentId}, ${pages.workspaceId}, ${pages.restricted}, ${pages.databaseId}, 0 as depth
      from ${pages}
      where ${pages.id} = ${id}
      union all
      select parent.${col(pages.id)}, parent.${col(pages.parentId)}, parent.${col(pages.workspaceId)},
             parent.${col(pages.restricted)}, parent.${col(pages.databaseId)}, chain.depth + 1
      from chain
      left join ${databases} host on host.${col(databases.id)} = chain.${col(pages.databaseId)}
      join ${pages} parent
        on parent.${col(pages.id)} = coalesce(chain.${col(pages.parentId)}, host.${col(databases.parentPageId)})
      where chain.depth < ${sql.raw(String(BREADCRUMB_MAX_DEPTH - 1))}
    ) cycle ${col(pages.id)} set is_cycle using cycle_path
    select ${col(pages.id)} as id, ${col(pages.parentId)} as parent_id,
           ${col(pages.workspaceId)} as workspace_id, ${col(pages.restricted)} as restricted
    from chain
    where not is_cycle
    order by depth asc
  `);
  return rows.map((row) => ({
    id: String(row.id),
    parentId: row.parent_id === null ? null : String(row.parent_id),
    workspaceId: String(row.workspace_id),
    restricted: row.restricted === true,
  }));
}

/** `userId`'s grants on any of `pageIds`. */
export async function findGrantsForUser(
  db: PgHandle,
  userId: string,
  pageIds: readonly string[],
): Promise<PagePermissionRow[]> {
  if (pageIds.length === 0) return [];
  return db
    .select()
    .from(pagePermissions)
    .where(and(eq(pagePermissions.userId, userId), inArray(pagePermissions.pageId, [...pageIds])));
}

/** Every grant on any of `pageIds` (the page's own and the inherited ones). */
export async function listGrantsOnPages(
  db: PgHandle,
  pageIds: readonly string[],
): Promise<PagePermissionRow[]> {
  if (pageIds.length === 0) return [];
  return db
    .select()
    .from(pagePermissions)
    .where(inArray(pagePermissions.pageId, [...pageIds]));
}

/** Every grant `userId` holds, in any workspace. */
export async function listGrantsOfUser(db: PgHandle, userId: string): Promise<PagePermissionRow[]> {
  return db.select().from(pagePermissions).where(eq(pagePermissions.userId, userId));
}

/** Grants in `workspaceId` for `userId`, for filtering that workspace's page list. */
export async function listGrantsOfUserInWorkspace(
  db: PgHandle,
  userId: string,
  workspaceId: string,
): Promise<PagePermissionRow[]> {
  const rows = await db
    .select({ grant: pagePermissions })
    .from(pagePermissions)
    .innerJoin(pages, eq(pages.id, pagePermissions.pageId))
    .where(and(eq(pagePermissions.userId, userId), eq(pages.workspaceId, workspaceId)));
  return rows.map((r) => r.grant);
}

/**
 * Give `userId` `role` on `pageId`, replacing a grant they already hold
 * there. A grant made by hand drops any share link it came from: it stays
 * when the link is revoked.
 */
export async function upsertGrant(
  db: PgHandle,
  input: {
    pageId: string;
    userId: string;
    role: PageGrantRole;
    grantedBy: string;
    shareLinkId?: string | null;
  },
): Promise<PagePermissionRow> {
  const [row] = await db
    .insert(pagePermissions)
    .values({ ...input, shareLinkId: input.shareLinkId ?? null })
    .onConflictDoUpdate({
      target: [pagePermissions.pageId, pagePermissions.userId],
      set: { role: input.role, grantedBy: input.grantedBy, shareLinkId: input.shareLinkId ?? null },
    })
    .returning();
  return row as PagePermissionRow;
}

export async function findGrant(
  db: PgHandle,
  pageId: string,
  userId: string,
): Promise<PagePermissionRow | undefined> {
  const [row] = await db
    .select()
    .from(pagePermissions)
    .where(and(eq(pagePermissions.pageId, pageId), eq(pagePermissions.userId, userId)));
  return row;
}

export async function deleteGrant(db: PgHandle, pageId: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(pagePermissions)
    .where(and(eq(pagePermissions.pageId, pageId), eq(pagePermissions.userId, userId)))
    .returning({ pageId: pagePermissions.pageId });
  return rows.length > 0;
}

/** Take away the access a share link handed out (it was revoked). */
export async function deleteGrantsFromShareLink(
  db: PgHandle,
  shareLinkId: string,
): Promise<number> {
  const rows = await db
    .delete(pagePermissions)
    .where(eq(pagePermissions.shareLinkId, shareLinkId))
    .returning({ pageId: pagePermissions.pageId });
  return rows.length;
}
