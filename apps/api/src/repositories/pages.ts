/**
 * Every query the routes run against `pages`.
 *
 * `routes/pages.ts`, `routes/databases.ts` and `routes/workspaces.ts` call this
 * repository. Each function below names its route-level use so a function
 * nobody calls remains visible as one.
 *
 * Where a query has a non-obvious storage behaviour, it is stated at the
 * function that carries it. The schema-level decisions (the `parentId`
 * referential action above all) live in `../db/schema/pages.ts`.
 */

import { and, asc, eq, getTableColumns, inArray, isNull, lt, sql } from 'drizzle-orm';
import { sqlColumnName } from '@oxy.so/db';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { PgHandle } from '../db/client.js';
import {
  PAGE_TOMBSTONE_RETENTION_MS,
  type PageFont,
  type PageMode,
  pageFavorites,
  pages,
  type PageProperties,
  pageTombstones,
} from '../db/schema/pages.js';

export type PageRow = typeof pages.$inferSelect;

/**
 * Ancestors are read with a narrow projection because the breadcrumb response
 * is `{id, title, icon}` and nothing else (`routes/pages.ts:612`).
 */
export interface PageCrumb {
  id: string;
  title: string;
  icon: string | null;
}

/**
 * Depth bound of the breadcrumb walk, matching `routes/pages.ts:616`
 * (`while (cursor && depth < 32)`), which appends at depths 0..31 and so
 * returns at most 32 entries.
 */
export const BREADCRUMB_MAX_DEPTH = 32;

export interface ListPagesFilter {
  workspaceId: string;
  /**
   * `undefined` — every depth (the query parameter was absent).
   * `null` — root pages only.
   * A string — children of that page.
   *
   * The three-way split is load-bearing: `?parentId=root` and `?parentId=null`
   * both mean root (`routes/pages.ts:216-221`), and a root filter must compile
   * to `parent_id IS NULL`. `eq(pages.parentId, null)` would render `= NULL`,
   * which matches nothing and returns an empty list with no error.
   */
  parentId?: string | null;
  /** `true` — templates only; `false` — no templates; absent — both. */
  template?: boolean;
  /**
   * `undefined` — archived and active together (`?includeArchived=true`).
   * `true` — the trash view (`?archivedOnly=true`).
   * `false` — the default listing.
   */
  archived?: boolean;
  /**
   * `?favoritedOnly=true`: only the pages this person starred, in the order
   * of their Favorites. Never the pages they did not.
   */
  favoritedBy?: string;
}

/**
 * `GET /api/pages` — `routes/pages.ts:233`.
 *
 * Sorted by `order`, then `createdAt`, with `id` appended as a final tiebreak:
 * `created_at` is stored at millisecond precision, so two pages created in the
 * same millisecond at the same order would tie, and the resulting sequence
 * would be whatever the storage engine returned. The client renders this list
 * in order, so it must be total.
 */
export async function listPages(db: PgHandle, filter: ListPagesFilter): Promise<PageRow[]> {
  const predicates = [eq(pages.workspaceId, filter.workspaceId)];
  if (filter.parentId !== undefined) {
    predicates.push(
      filter.parentId === null ? isNull(pages.parentId) : eq(pages.parentId, filter.parentId),
    );
  }
  if (filter.archived !== undefined) predicates.push(eq(pages.archived, filter.archived));
  // The trash lists what was trashed; a subpage that went with its page is
  // in it through that page.
  if (filter.archived === true) predicates.push(isNull(pages.archivedWith));
  if (filter.template !== undefined) predicates.push(eq(pages.template, filter.template));

  if (filter.favoritedBy !== undefined) {
    return db
      .select(getTableColumns(pages))
      .from(pages)
      .innerJoin(
        pageFavorites,
        and(eq(pageFavorites.pageId, pages.id), eq(pageFavorites.userId, filter.favoritedBy)),
      )
      .where(and(...predicates))
      .orderBy(asc(pageFavorites.order), asc(pageFavorites.createdAt), asc(pages.id));
  }
  return db
    .select()
    .from(pages)
    .where(and(...predicates))
    .orderBy(asc(pages.order), asc(pages.createdAt), asc(pages.id));
}

/**
 * `GET /api/pages/:id` — `routes/pages.ts:253`, and the workspace-resolution
 * lookup every `:id` route performs before checking membership
 * (`routes/pages.ts:301,372,459,525,601,736`, `routes/blocks.ts:417,446,517,587,628`,
 * `routes/comments.ts:371,427,461`, `routes/share-links.ts:73,260,316`,
 * `routes/databases.ts:653`).
 *
 * Those call sites project (`.select('workspaceId')`, `.select('workspaceId title')`,
 * `.select('workspaceId parentId title icon')`). The projections are not
 * preserved: they are a transfer-size optimisation on a single-row primary-key
 * lookup of fourteen small columns, not a semantic difference, and one function
 * is fewer things to keep in step than four.
 */
export async function findPageById(db: PgHandle, id: string): Promise<PageRow | undefined> {
  const [row] = await db.select().from(pages).where(eq(pages.id, id)).limit(1);
  return row;
}

export interface FindPagesByIdsFilter {
  /** `routes/comments.ts:177` scopes the lookup to the mentioning workspace. */
  workspaceId?: string;
  /** `lib/databases/rollups.ts:45` reads only live rows. */
  archived?: boolean;
}

/**
 * `routes/comments.ts:177` (verifying mentioned pages belong to the workspace)
 * and `lib/databases/rollups.ts:45` (loading a relation's target rows).
 *
 * The empty-input early return is a saved round trip, not a guard:
 * `inArray(col, [])` renders as the literal `false`, so the query would
 * correctly return nothing anyway.
 */
export async function findPagesByIds(
  db: PgHandle,
  ids: readonly string[],
  filter: FindPagesByIdsFilter = {},
): Promise<PageRow[]> {
  if (ids.length === 0) return [];
  const predicates = [inArray(pages.id, [...ids])];
  if (filter.workspaceId !== undefined) predicates.push(eq(pages.workspaceId, filter.workspaceId));
  if (filter.archived !== undefined) predicates.push(eq(pages.archived, filter.archived));
  return db
    .select()
    .from(pages)
    .where(and(...predicates));
}

/**
 * The order a new sibling takes: `max(order) + 1`, or 0 when there is no
 * sibling — `routes/pages.ts:319-323` and `routes/pages.ts:545-549`, both of
 * which read the highest sibling and add one.
 *
 * `max()` over `double precision` comes back as a JavaScript `number` from
 * postgres.js (measured, not assumed — unlike `count(*)`, which is `bigint` and
 * arrives as a STRING, so every count in this file carries an explicit
 * `::int`). Over an empty set it is NULL, which is the "no sibling" case.
 */
export async function nextSiblingOrder(
  db: PgHandle,
  scope: { workspaceId: string; parentId: string | null },
): Promise<number> {
  const [row] = await db
    .select({ maxOrder: sql<number | null>`max(${pages.order})` })
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, scope.workspaceId),
        scope.parentId === null ? isNull(pages.parentId) : eq(pages.parentId, scope.parentId),
      ),
    );
  const maxOrder = row?.maxOrder;
  return maxOrder === null || maxOrder === undefined ? 0 : maxOrder + 1;
}

/** `routes/databases.ts:1051` — the same rule, scoped to a database's rows. */
export async function nextDatabaseRowOrder(db: PgHandle, databaseId: string): Promise<number> {
  const [row] = await db
    .select({ maxOrder: sql<number | null>`max(${pages.order})` })
    .from(pages)
    .where(eq(pages.databaseId, databaseId));
  const maxOrder = row?.maxOrder;
  return maxOrder === null || maxOrder === undefined ? 0 : maxOrder + 1;
}

export interface CreatePageInput {
  /** An id the client chose (a note made offline keeps its id); generated when absent. */
  id?: string;
  workspaceId: string;
  parentId?: string | null;
  title?: string;
  icon?: string | null;
  cover?: string | null;
  ownerId: string;
  archived?: boolean;
  order: number;
  /** Set only by `routes/databases.ts:1057`, which creates a database row. */
  databaseId?: string | null;
  /** Set only by `routes/databases.ts:1057`. Every other creator takes the `{}` default. */
  properties?: PageProperties;
  /** A database row created as a template (`POST /databases/:id/rows { template }`). */
  template?: boolean;
  /** Where a top-level page lives: its teamspace, or null — private to its owner. */
  teamspaceId?: string | null;
}

/**
 * `POST /api/pages` (`routes/pages.ts:325`), `POST /api/pages/:id/duplicate`
 * (`routes/pages.ts:551`) and `POST /api/databases/:id/rows`
 * (`routes/databases.ts:1057`).
 *
 * `coverPosition` is absent from the input on purpose: no creator sets it,
 * including the duplicate route, which does not copy the source page's cover
 * offset. That is the existing behaviour and is preserved
 * rather than quietly fixed here.
 */
export async function createPage(db: PgHandle, input: CreatePageInput): Promise<PageRow> {
  const [row] = await db
    .insert(pages)
    .values({
      ...(input.id !== undefined && { id: input.id }),
      workspaceId: input.workspaceId,
      parentId: input.parentId ?? null,
      title: input.title ?? '',
      icon: input.icon ?? null,
      cover: input.cover ?? null,
      ownerId: input.ownerId,
      archived: input.archived ?? false,
      order: input.order,
      databaseId: input.databaseId ?? null,
      properties: input.properties ?? {},
      template: input.template ?? false,
      // Read only at the top of a tree: a subpage lives where its tree starts.
      teamspaceId: input.parentId ? null : (input.teamspaceId ?? null),
    })
    .returning();
  if (!row) throw new Error('createPage inserted no row');
  return row;
}

export interface UpdatePageInput {
  parentId?: string | null;
  title?: string;
  icon?: string | null;
  cover?: string | null;
  coverPosition?: number;
  order?: number;
  archived?: boolean;
  /** See `pages.archivedWith`; `setTreeArchived` writes the subtree's. */
  archivedWith?: string | null;
  restricted?: boolean;
  template?: boolean;
  fullWidth?: boolean;
  smallText?: boolean;
  font?: PageFont;
  mode?: PageMode;
  locked?: boolean;
  /** Where a top-level page lives (null: private to its owner). */
  teamspaceId?: string | null;
  publishedAt?: Date | null;
  publishSlug?: string;
  publishIndexing?: boolean;
  lastEditedBy?: string;
  /**
   * Shallow top-level MERGE into the stored object, never a replacement.
   *
   * `PATCH /api/pages/:id` walks the submitted keys and calls `.set()` on the
   * page's existing property Map (`routes/pages.ts:413-424`), so keys it does
   * not mention survive. `properties || $1::jsonb` is that, exactly. Named
   * `mergeProperties` so a caller cannot read it as an assignment.
   */
  mergeProperties?: PageProperties;
}

/**
 * `PATCH /api/pages/:id` — `routes/pages.ts:364-439` — and the soft delete at
 * `routes/pages.ts:485`, which is `{ archived: true }`.
 *
 * The SET clause is built from DEFINED keys only, and the distinction between
 * `undefined` and `null` is the whole point: `icon`, `cover` and `parentId` are
 * nullable and the route accepts an explicit `null` for each, so `undefined`
 * has to mean "leave it alone" while `null` means "write NULL"; writing an
 * `undefined` key would be an erasure.
 *
 * Measured, so the comment does not overclaim: drizzle's own `.set()` ALREADY
 * drops `undefined` values, so removing these guards does not reintroduce the
 * erasure — the contract holds either way, and the behavioural assertion in
 * `pages.pgdb.test.ts` cannot tell the two apart. What the guards buy is that
 * the rule is stated in the file that depends on it rather than inherited from
 * a library detail, and that an all-undefined patch reaches the explicit error
 * below instead of drizzle's 'No values to set'. That last difference is the
 * one an assertion can see, and it is the one the suite pins.
 *
 * Returns `undefined` when no row has that id — the route already 404s on the
 * preceding `findById`, so this is the same answer arriving one query earlier.
 */
export async function updatePage(
  db: PgHandle,
  id: string,
  patch: UpdatePageInput,
): Promise<PageRow | undefined> {
  const values: Record<string, unknown> = {};
  if (patch.parentId !== undefined) values.parentId = patch.parentId;
  if (patch.title !== undefined) values.title = patch.title;
  if (patch.icon !== undefined) values.icon = patch.icon;
  if (patch.cover !== undefined) values.cover = patch.cover;
  if (patch.coverPosition !== undefined) values.coverPosition = patch.coverPosition;
  if (patch.order !== undefined) values.order = patch.order;
  if (patch.archived !== undefined) values.archived = patch.archived;
  if (patch.archivedWith !== undefined) values.archivedWith = patch.archivedWith;
  if (patch.restricted !== undefined) values.restricted = patch.restricted;
  if (patch.template !== undefined) values.template = patch.template;
  if (patch.fullWidth !== undefined) values.fullWidth = patch.fullWidth;
  if (patch.smallText !== undefined) values.smallText = patch.smallText;
  if (patch.font !== undefined) values.font = patch.font;
  if (patch.mode !== undefined) values.mode = patch.mode;
  if (patch.locked !== undefined) values.locked = patch.locked;
  if (patch.teamspaceId !== undefined) values.teamspaceId = patch.teamspaceId;
  if (patch.publishedAt !== undefined) values.publishedAt = patch.publishedAt;
  if (patch.publishSlug !== undefined) values.publishSlug = patch.publishSlug;
  if (patch.publishIndexing !== undefined) values.publishIndexing = patch.publishIndexing;
  if (patch.lastEditedBy !== undefined) values.lastEditedBy = patch.lastEditedBy;
  if (patch.mergeProperties !== undefined) {
    values.properties = sql`${pages.properties} || ${JSON.stringify(patch.mergeProperties)}::jsonb`;
  }

  if (Object.keys(values).length === 0) {
    throw new Error('updatePage was given no fields to write');
  }

  const [row] = await db.update(pages).set(values).where(eq(pages.id, id)).returning();
  return row;
}

/**
 * `DELETE /api/databases/:id/properties/:propertyId` — `routes/databases.ts:906`,
 * which drops one property from every row of a database.
 *
 * Returns the number of rows the statement matched (Postgres `rowCount`), not
 * the number changed; the route does not consume it, so nothing turns on the
 * difference here.
 */
export async function removePropertyFromDatabaseRows(
  db: PgHandle,
  databaseId: string,
  propertyId: string,
): Promise<number> {
  const updated = await db
    .update(pages)
    .set({ properties: sql`${pages.properties} - ${propertyId}::text` })
    .where(eq(pages.databaseId, databaseId))
    .returning({ id: pages.id });
  return updated.length;
}

export interface ListDatabaseRowsFilter {
  /** `routes/databases.ts:955` reads live rows only; the hard delete at :765 reads all. */
  archived?: boolean;
  /** `true` — the database's row templates only; `false` — rows proper; absent — both. */
  template?: boolean;
}

/**
 * A database's rows, oldest first (`id` breaks a tie): the order a view's
 * rows take before its sorts, and among rows its sorts do not tell apart, so
 * the same view pages the same way every time.
 */
export async function listDatabaseRows(
  db: PgHandle,
  databaseId: string,
  filter: ListDatabaseRowsFilter = {},
): Promise<PageRow[]> {
  const predicates = [eq(pages.databaseId, databaseId)];
  if (filter.archived !== undefined) predicates.push(eq(pages.archived, filter.archived));
  if (filter.template !== undefined) predicates.push(eq(pages.template, filter.template));
  return db
    .select()
    .from(pages)
    .where(and(...predicates))
    .orderBy(asc(pages.createdAt), asc(pages.id));
}

/**
 * `DELETE /api/databases/:id?hard=true` — `routes/databases.ts:765-771`.
 *
 * The route's explicit `Block.deleteMany({ pageId: { $in: rowIds } })` has no
 * counterpart here: `blocks.pageId` cascades. Returns the number of rows
 * deleted, which is what the route counted (it counted ids collected, the same
 * number absent a concurrent write).
 */
export async function deleteDatabaseRows(db: PgHandle, databaseId: string): Promise<number> {
  const deleted = await db
    .delete(pages)
    .where(eq(pages.databaseId, databaseId))
    .returning({ id: pages.id });
  return deleted.length;
}

/**
 * `POST /api/workspaces/:workspaceId/trash/empty` — `routes/workspaces.ts:604-618`.
 *
 * A page's subpages go to the trash with it (`setTreeArchived`), so they are in
 * the delete set too. A live child of an archived page should not exist; one
 * that does is NOT in the delete set, and under `ON DELETE SET NULL` it
 * survives with `parent_id = NULL` as a root page of the workspace rather than
 * being destroyed (CASCADE) — see the schema.
 */
export async function deleteArchivedPages(db: PgHandle, workspaceId: string): Promise<number> {
  // The rows and their tombstones commit together, or a syncing client could
  // keep a row that is gone.
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(pages)
      .where(and(eq(pages.workspaceId, workspaceId), eq(pages.archived, true)))
      .returning({ id: pages.id, databaseId: pages.databaseId });
    await recordTombstones(tx, deleted);
    return deleted.length;
  });
}

/**
 * Remember the database rows among `deleted` (`page_tombstones`), so clients
 * syncing those databases learn they are gone, and forget the ones older than
 * the retention for the same databases. Pruned here, where tombstones are
 * written, as `page_transactions` are: nothing else has to run for them to
 * stay bounded.
 */
export async function recordTombstones(
  db: PgHandle,
  deleted: readonly { id: string; databaseId: string | null }[],
): Promise<void> {
  const rows = deleted.flatMap((page) =>
    page.databaseId ? [{ pageId: page.id, databaseId: page.databaseId }] : [],
  );
  if (rows.length === 0) return;
  // A row deleted again (its id reused) is deleted now, for cursors past the first time.
  await db
    .insert(pageTombstones)
    .values(rows)
    .onConflictDoUpdate({ target: pageTombstones.pageId, set: { deletedAt: sql`now()` } });
  await db
    .delete(pageTombstones)
    .where(
      and(
        inArray(pageTombstones.databaseId, [...new Set(rows.map((row) => row.databaseId))]),
        lt(pageTombstones.deletedAt, new Date(Date.now() - PAGE_TOMBSTONE_RETENTION_MS)),
      ),
    );
}

/**
 * The rest of `rootId`'s tree follows it to the trash (`archived`) or back
 * out. Going, every live page below it is archived with it (`archivedWith`);
 * a subpage already in the trash on its own stays its own entry, and so do
 * the pages below it. Coming back, exactly the pages that went with it return.
 * The root's own row is the caller's write. Returns how many pages moved.
 */
export async function setTreeArchived(
  db: PgHandle,
  rootId: string,
  archived: boolean,
): Promise<number> {
  const column = (c: AnyPgColumn) => sql.identifier(sqlColumnName(c));
  const id = column(pages.id);
  // Down the tree through `pages_parent_idx`, never a scan of the table:
  // going, through the live subpages; coming back, through those that went.
  const follows = archived
    ? sql`not child.${column(pages.archived)}`
    : sql`child.${column(pages.archivedWith)} = ${rootId}`;
  const rows = await db.execute(sql`
    with recursive tree as (
      select ${pages.id} from ${pages} where ${pages.id} = ${rootId}
      union all
      select child.${id}
      from ${pages} child
      join tree on child.${column(pages.parentId)} = tree.${id}
      where ${follows}
    ) cycle ${id} set is_cycle using cycle_path
    update ${pages}
    set ${column(pages.archived)} = ${archived},
        ${column(pages.archivedWith)} = ${archived ? rootId : null}
    where ${pages.id} in (select ${id} from tree where not is_cycle) and ${pages.id} <> ${rootId}
    returning ${pages.id}
  `);
  return rows.length;
}

/**
 * `DELETE /api/pages/:id?hard=true` — `routes/pages.ts:476-481`, which BFS-walks
 * `parentId` (`collectDescendantPageIds`, `routes/pages.ts:500-514`), deletes
 * every block of the collected pages, then the pages, and answers with the size
 * of the collected set.
 *
 * One statement, for two reasons beyond speed. The page and its descendants
 * leave together or not at all. And because every descendant is inside the
 * same statement, the `ON DELETE SET NULL` action finds no surviving child to
 * detach — the referential action covers only a child that appeared after this
 * statement's snapshot, where it is strictly better than the 23503 a NO ACTION
 * reference would raise. Blocks go by cascade.
 *
 * `CYCLE` is not decoration. `PATCH /api/pages/:id` rejects only a page made
 * its own parent (`routes/pages.ts:368`), so A→B followed by reparenting A
 * under B is reachable and produces a cycle; the breadcrumb route's `seen` set
 * (`routes/pages.ts:613`) is the existing acknowledgement of it. Without the
 * clause the recursion does not terminate.
 *
 * Database rows among the deleted pages leave a tombstone (`recordTombstones`).
 */
export async function deletePageTree(db: PgHandle, rootId: string): Promise<number> {
  const id = sql.identifier(sqlColumnName(pages.id));
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
    with recursive tree as (
      select ${pages.id} from ${pages} where ${pages.id} = ${rootId}
      union all
      select child.${id}
      from ${pages} child
      join tree on child.${sql.identifier(sqlColumnName(pages.parentId))} = tree.${id}
    ) cycle ${id} set is_cycle using cycle_path
    delete from ${pages}
    where ${pages.id} in (select ${id} from tree)
    returning ${pages.id} as id, ${pages.databaseId} as database_id
  `);
    const deleted = rows.map((row) => ({
      id: String(row.id),
      databaseId: typeof row.database_id === 'string' ? row.database_id : null,
    }));
    // In the same transaction as the delete: a row gone without its tombstone
    // would stay on every syncing client.
    await recordTombstones(tx, deleted);
    return deleted.length;
  });
}

/**
 * `GET /api/pages/:id/breadcrumb` — `routes/pages.ts:612-630`, which walks
 * `parentId` upward one query per level, `unshift`s each crumb, and stops on a
 * repeat or at depth 32.
 *
 * Returns root-first, page last, matching the `unshift`. Empty when no page has
 * that id — the route 404s before it reaches the walk.
 *
 * The depth predicate is `< BREADCRUMB_MAX_DEPTH - 1` because the recursive arm
 * produces the NEXT crumb: the loop it replaces appends at depths 0..31.
 *
 * `where not is_cycle` is not tidying. Postgres's `CYCLE` clause emits the
 * repeating row ONCE, flagged, before it stops recursing — measured, against a
 * real cycle — so without the predicate a looped ancestry comes back one crumb
 * longer than the route's, with a duplicate at the head. The route's `seen` set
 * breaks BEFORE appending the repeat (`routes/pages.ts:618`); this is that.
 */
export async function findPageAncestry(db: PgHandle, id: string): Promise<PageCrumb[]> {
  const rows = await db.execute(sql`
    with recursive chain as (
      select ${pages.id}, ${pages.parentId}, ${pages.title}, ${pages.icon}, 0 as depth
      from ${pages}
      where ${pages.id} = ${id}
      union all
      select parent.${sql.identifier(sqlColumnName(pages.id))},
             parent.${sql.identifier(sqlColumnName(pages.parentId))},
             parent.${sql.identifier(sqlColumnName(pages.title))},
             parent.${sql.identifier(sqlColumnName(pages.icon))},
             chain.depth + 1
      from ${pages} parent
      join chain on parent.${sql.identifier(sqlColumnName(pages.id))} = chain.${sql.identifier(sqlColumnName(pages.parentId))}
      where chain.depth < ${sql.raw(String(BREADCRUMB_MAX_DEPTH - 1))}
    ) cycle ${sql.identifier(sqlColumnName(pages.id))} set is_cycle using cycle_path
    select ${sql.identifier(sqlColumnName(pages.id))} as id,
           ${sql.identifier(sqlColumnName(pages.title))} as title,
           ${sql.identifier(sqlColumnName(pages.icon))} as icon
    from chain
    where not is_cycle
    order by depth desc
  `);
  return rows.map((row) => ({
    id: String(row.id),
    title: typeof row.title === 'string' ? row.title : '',
    icon: typeof row.icon === 'string' ? row.icon : null,
  }));
}

/**
 * Advance a page's blocks version by one and return the new value. Called
 * inside the transaction that applies a block transaction, so the version
 * and the change commit together.
 */
export async function bumpBlocksVersion(
  db: PgHandle,
  pageId: string,
  editorId?: string,
): Promise<number> {
  const [row] = await db
    .update(pages)
    .set({
      blocksVersion: sql`${pages.blocksVersion} + 1`,
      ...(editorId && { lastEditedBy: editorId }),
    })
    .where(eq(pages.id, pageId))
    .returning({ version: pages.blocksVersion });
  if (!row) throw new Error(`bumpBlocksVersion found no page ${pageId}`);
  return row.version;
}

/**
 * Lock a page's row until the end of the transaction `db` is in: block
 * transactions on one page take it first, so they run one after another.
 * Answers whether the page is locked against edits (`pages.locked`), read
 * under that same row lock.
 */
/**
 * Share-lock a page's row until the end of the transaction: appending a Yjs
 * update takes it, so appends run side by side while compaction, which takes
 * `lockPage`, waits for them (and they for it). Answers the page's state.
 */
export async function lockPageShared(
  db: PgHandle,
  pageId: string,
): Promise<{ locked: boolean; archived: boolean } | null> {
  const [row] = await db
    .select({ locked: pages.locked, archived: pages.archived })
    .from(pages)
    .where(eq(pages.id, pageId))
    .for('share');
  return row ?? null;
}

export async function lockPage(db: PgHandle, pageId: string): Promise<{ locked: boolean } | null> {
  const [row] = await db
    .select({ locked: pages.locked })
    .from(pages)
    .where(eq(pages.id, pageId))
    .for('update');
  return row ?? null;
}

/** The page published (or once published) at `slug`. */
export async function findPageByPublishSlug(
  db: PgHandle,
  slug: string,
): Promise<PageRow | undefined> {
  const [row] = await db.select().from(pages).where(eq(pages.publishSlug, slug));
  return row;
}
