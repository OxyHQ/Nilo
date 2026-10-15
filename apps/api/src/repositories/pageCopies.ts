import { sql } from 'drizzle-orm';
import { sqlColumnName } from '@oxy.so/db';
import type { PgHandle } from '../db/client.js';
import { pages } from '../db/schema/pages.js';
import { duplicateBlocksToPage } from './blocks.js';
import { listGrantsOnPages, upsertGrant } from './pagePermissions.js';
import {
  BREADCRUMB_MAX_DEPTH,
  createPage,
  findPageById,
  type PageRow,
  updatePage,
} from './pages.js';

export interface CopyPageTreeInput {
  sourceId: string;
  /** Where the copy goes. */
  parentId: string | null;
  order: number;
  title: string;
  /** Whether the copy is itself a template. */
  template: boolean;
  /** Owner of every copied page, and grantor of every copied grant. */
  userId: string;
  /** Where the copy lives when it is a top-level page (`lib/placement.ts`). */
  teamspaceId: string | null;
  /**
   * Give `userId` full access to every restricted copy, so they are not shut
   * out of what they just copied.
   */
  keepAccess: boolean;
}

/**
 * Copy a page with its live subpages, their blocks, who may open them
 * (restriction and grants) and their order, under `parentId`. Database rows
 * are not subpages (they belong to their database) and are not copied.
 * Returns the copy of the source page. Run inside a transaction.
 */
export async function copyPageTree(db: PgHandle, input: CopyPageTreeInput): Promise<PageRow> {
  const col = (c: Parameters<typeof sqlColumnName>[0]) => sql.identifier(sqlColumnName(c));
  // The subtree, parents before children; bounded and cycle-safe like the breadcrumb.
  const rows = await db.execute(sql`
    with recursive tree as (
      select ${pages.id}, ${pages.parentId}, 0 as depth
      from ${pages}
      where ${pages.id} = ${input.sourceId}
      union all
      select child.${col(pages.id)}, child.${col(pages.parentId)}, tree.depth + 1
      from ${pages} child
      join tree on child.${col(pages.parentId)} = tree.${col(pages.id)}
      where not child.${col(pages.archived)}
        and child.${col(pages.databaseId)} is null
        and tree.depth < ${sql.raw(String(BREADCRUMB_MAX_DEPTH - 1))}
    ) cycle ${col(pages.id)} set is_cycle using cycle_path
    select ${col(pages.id)} as id from tree where not is_cycle order by depth asc
  `);
  const ids = rows.map((row) => String(row.id));

  const copied = new Map<string, string>();
  const keptFor = new Set<string>();
  let root: PageRow | undefined;
  for (const id of ids) {
    const source = await findPageById(db, id);
    if (!source) continue;
    const isRoot = id === input.sourceId;
    const parentId = isRoot
      ? input.parentId
      : source.parentId
        ? (copied.get(source.parentId) ?? null)
        : null;
    const copy = await createPage(db, {
      workspaceId: source.workspaceId,
      parentId,
      title: isRoot ? input.title : source.title,
      icon: source.icon,
      cover: source.cover,
      ownerId: input.userId,
      archived: false,
      order: isRoot ? input.order : source.order,
      teamspaceId: isRoot ? input.teamspaceId : null,
    });
    copied.set(id, copy.id);
    await duplicateBlocksToPage(db, source.id, copy.id);
    const flags = {
      ...(source.restricted && { restricted: true }),
      ...(isRoot && input.template && { template: true }),
    };
    const updated = Object.keys(flags).length > 0 ? await updatePage(db, copy.id, flags) : copy;
    if (source.restricted && input.keepAccess) {
      await upsertGrant(db, {
        pageId: copy.id,
        userId: input.userId,
        role: 'admin',
        grantedBy: input.userId,
      });
      keptFor.add(copy.id);
    }
    if (isRoot) root = updated ?? copy;
  }

  for (const grant of await listGrantsOnPages(db, ids)) {
    const pageId = copied.get(grant.pageId);
    if (!pageId) continue;
    // The copier's own grant stays the full access given above.
    if (grant.userId === input.userId && keptFor.has(pageId)) continue;
    await upsertGrant(db, {
      pageId,
      userId: grant.userId,
      role: grant.role,
      grantedBy: input.userId,
    });
  }

  if (!root) throw new Error(`copyPageTree found no page ${input.sourceId}`);
  return root;
}
