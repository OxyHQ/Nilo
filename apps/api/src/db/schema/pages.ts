import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { BLOCK_TYPES, type BlockContent, type BlockType } from '@nilo/contracts';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxy.so/db';
import { databases } from './databases.js';
import { teamspaces } from './teamspaces.js';
import { workspaces } from './workspaces.js';

/** A page's typeface (`pages.font`). */
export const PAGE_FONTS = ['default', 'serif', 'mono'] as const;
export type PageFont = (typeof PAGE_FONTS)[number];
export const PAGE_MODES = ['document', 'canvas'] as const;
export type PageMode = (typeof PAGE_MODES)[number];

/** Every block type the editor persists, and each one's content: the contract shared with the app. */
export { BLOCK_TYPES, type BlockContent, type BlockType } from '@nilo/contracts';

/**
 * Pages and blocks — the document primitive and its content units.
 *
 * The conventions
 * (uuidv7 text ids, `text` + CHECK instead of `pgEnum`, `inList` rendering the
 * literal side without parentheses, column names derived by `DATABASE_CASING`)
 * are stated once in `workspaces.ts` and are not repeated here. What IS stated
 * here is every non-obvious storage decision, because each one is a decision
 * somebody has to be able to check.
 */

/**
 * Per-property value on a database row. The shape depends on the property's
 * declared type and is validated at the route boundary by
 * `lib/databases/property-values.ts`, never by the storage layer.
 */
export type PageProperties = Record<string, unknown>;

/** Bounds of `pages.coverPosition`, as a percentage offset. */
export const COVER_POSITION_MIN = 0;
export const COVER_POSITION_MAX = 100;

export const pages = pgTable(
  'pages',
  {
    id: generatedId(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /**
     * Self-reference: pages form a tree per workspace, `null` = root.
     *
     * `ON DELETE SET NULL`, and the choice matters more than it looks.
     *
     * CASCADE is the obvious reading of `DELETE /api/pages/:id?hard=true`,
     * which BFS-collects descendants and deletes them — but it is WRONG here,
     * because a second delete path exists. `POST
     * /api/workspaces/:id/trash/empty` (`routes/workspaces.ts:604-618`) deletes
     * every ARCHIVED page in the workspace, and archiving a page
     * (`routes/pages.ts:485`) stamps only that page — its children stay
     * `archived: false`. Under CASCADE, emptying the trash would destroy live
     * descendants of an archived parent. That is data loss introduced by the
     * FK alone, and it would be reachable.
     *
     * NO ACTION was the other candidate and is worse still: the same
     * trash-empty would abort with 23503, breaking a route that works.
     *
     * SET NULL keeps the row and surfaces it — the orphan becomes a root page
     * of its workspace instead of a child of a page that no longer exists,
     * which is what a client tree-builder can actually render — visibility
     * rather than loss. `pagesRepository.deletePageTree` is unaffected because it
     * deletes the whole recursive set in ONE statement, so the referential
     * action finds no surviving child to null out (asserted, not assumed —
     * `pages.pgdb.test.ts`).
     */
    parentId: text().references((): AnyPgColumn => pages.id, { onDelete: 'set null' }),
    /**
     * Where a top-level page lives (`docs/access.md`): its teamspace, or null
     * — private to `ownerId`. Read only at the top of a tree; subpages live
     * where their tree starts. A deleted teamspace leaves its pages private
     * to their owners, never more open.
     */
    teamspaceId: text().references(() => teamspaces.id, { onDelete: 'set null' }),
    title: text().notNull().default(''),
    icon: text(),
    cover: text(),
    /** Vertical offset (percent) for cropped cover rendering; 50 = centered. */
    coverPosition: doublePrecision().notNull().default(50),
    /** Oxy user id — text, not a foreign key. See `workspaces.ownerId`. */
    ownerId: text().notNull(),
    /** Soft delete. The trash view lists these; emptying the trash removes them. */
    archived: boolean().notNull().default(false),
    /** Starred in the sidebar Favorites section. */
    favorited: boolean().notNull().default(false),
    /**
     * Open only to the people granted access to it or to a page above it
     * (`page_permissions`), and to the workspace's owners and admins, instead
     * of to every member. Inherited: a restricted page restricts its subtree.
     * See `lib/page-access.ts`.
     */
    restricted: boolean().notNull().default(false),
    /**
     * A template: kept out of the page tree and offered when creating a page,
     * which copies it with its subpages (`POST /pages/:id/duplicate` with
     * `fromTemplate`).
     */
    template: boolean().notNull().default(false),
    /** Layout, as in Notion's page menu: the page's content spans the window. */
    fullWidth: boolean().notNull().default(false),
    /** Layout: text one size down (the editor's `textScale`). */
    smallText: boolean().notNull().default(false),
    /** The page's typeface: `default`, `serif` or `mono`. */
    font: text().$type<PageFont>().notNull().default('default'),
    /**
     * How its blocks are laid out: `document`, top to bottom, or `canvas`,
     * as notes (`canvas_note` blocks) placed on an infinite surface.
     */
    mode: text().$type<PageMode>().notNull().default('document'),
    /**
     * Locked against edits — a guard, not a permission: nobody changes its
     * blocks, title, icon, cover or properties until an editor unlocks it.
     * Comments still work. Enforced in `applyBlockTransaction` and the page
     * route.
     */
    locked: boolean().notNull().default(false),
    /**
     * Published to the web: readable by anyone at `/public/pages/<publishSlug>`,
     * with its subpages (restricted ones excepted). Null when not published.
     */
    publishedAt: timestamptz(),
    /**
     * The page's public address. Kept when the page is unpublished, so
     * publishing it again restores the same link.
     */
    publishSlug: text(),
    /** Whether search engines may index the published page. */
    publishIndexing: boolean().notNull().default(false),
    /**
     * Oxy user id of whoever last changed the page (its blocks or its fields);
     * null until someone does. `updatedAt` is when.
     */
    lastEditedBy: text(),
    /**
     * Sibling ordering. `double precision`, not an integer: `PATCH
     * /api/pages/:id` accepts `z.number().finite()`, so a client may write a
     * fractional order to insert between two neighbours without renumbering.
     *
     * No `isfinite` CHECK: the route's zod schema is the only validator on
     * this field — the opposite call from `coverPosition` below, whose bounds
     * are a storage constraint.
     */
    order: doublePrecision().notNull().default(0),
    /**
     * Incremented by every applied block transaction. Collaborators compare it
     * with the version they hold to know whether they missed a change, and
     * the transactions endpoint returns the version it produced.
     */
    blocksVersion: integer().notNull().default(0),
    /**
     * Non-null when this page is a row of a database.
     *
     * CASCADE: a database's rows go with it. This is one half of a pair with
     * `databases.parentPageId` (SET NULL); why only that pair is safe is on
     * that column.
     */
    databaseId: text().references((): AnyPgColumn => databases.id, { onDelete: 'cascade' }),
    /**
     * Typed property values for a database row, keyed by propertyId.
     *
     * Defaults to an empty object — `not null default '{}'`, never nullable.
     * Writers must merge rather than replace: `PATCH /api/pages/:id` sets
     * individual keys on the existing map (`routes/pages.ts:413-424`), which is
     * `properties || $1::jsonb` here, and `DELETE
     * /api/databases/:id/properties/:propertyId` unsets one key
     * (`routes/databases.ts:906`), which is `properties - $1`.
     */
    properties: jsonb().$type<PageProperties>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    /**
     * Serves the tree listing, and its `workspaceId` prefix subsumes a
     * standalone `workspaceId` index — a leading-column prefix is a usable
     * access path in Postgres, so a single-column index would only cost
     * writes.
     */
    index('pages_workspace_parent_order_idx').on(t.workspaceId, t.parentId, t.order),
    /** Ported from `PageSchema.index({ workspaceId: 1, archived: 1 })`. */
    index('pages_workspace_archived_idx').on(t.workspaceId, t.archived),
    /**
     * Ported from `PageSchema.index({ databaseId: 1, archived: 1, createdAt: 1 })`.
     * Its prefix subsumes the standalone `databaseId` index, as above.
     */
    index('pages_database_archived_created_idx').on(t.databaseId, t.archived, t.createdAt),
    /**
     * A database's rows changed since a point (`GET /notes/sync`): the cursor
     * is `(updatedAt, id)`, so both are in the index after the database.
     */
    index('pages_database_updated_idx').on(t.databaseId, t.updatedAt, t.id),
    /**
     * `parentId` is both a foreign key and the recursion column of every
     * tree walk (`deletePageTree`, `findPageAncestry`). An unindexed FK
     * referencing column makes each parent DELETE a sequential scan to run the
     * SET NULL action, and each level of a recursive CTE another one.
     */
    index('pages_parent_idx').on(t.parentId),
    // The public address resolves to exactly one page.
    uniqueIndex('pages_publish_slug_key').on(t.publishSlug),
    /**
     * Ported from `PageSchema` field `favorited: { index: true }`, deliberately
     * reshaped. A standalone btree on a boolean is not a usable access path,
     * and the only query that filters on it (`?favoritedOnly=true`) is always
     * workspace-scoped, so the port is a PARTIAL index keyed on `workspaceId`.
     * Reshaped, not dropped: dropping it is the change that no functional test
     * could ever detect.
     */
    index('pages_workspace_favorited_idx').on(t.workspaceId).where(sql`${t.favorited}`),
    /**
     * No query performs jsonb containment today — `GET /api/databases/:id/rows`
     * loads a database's rows and filters them in JS
     * (`routes/databases.ts:955-980`). This index exists for the property
     * filtering that replaces that scan, and is the one entry here that is
     * ahead of its reader.
     */
    index('pages_properties_gin_idx').using('gin', t.properties),
    index('pages_teamspace_idx').on(t.teamspaceId),
    /**
     * Full-text search over titles (`GET /search`). `nilo_search` is `simple`
     * (no stemming or stop words, so it behaves the same for every language a
     * workspace writes in) with accents removed (`unaccent`): "cancion" finds
     * "canción". The query side matches word prefixes. The expression must be
     * written exactly as `repositories/search.ts` queries it, or the planner
     * cannot use the index.
     */
    index('pages_title_fts_idx').using(
      'gin',
      sql`to_tsvector('nilo_search'::regconfig, ${t.title})`,
    ),
    /**
     * `coverPosition` is bounded to 0..100 as a live constraint. `between`
     * also rejects `'NaN'::double precision`.
     */
    check('pages_font', sql`${t.font} in ('default', 'serif', 'mono')`),
    check('pages_mode', sql`${t.mode} in ('document', 'canvas')`),
    check(
      'pages_cover_position_range',
      sql`${t.coverPosition} between ${sql.raw(String(COVER_POSITION_MIN))} and ${sql.raw(String(COVER_POSITION_MAX))}`,
    ),
  ],
);

export const blocks = pgTable(
  'blocks',
  {
    id: generatedId(),
    /**
     * CASCADE, unlike the pages self-reference above, and for a reason that
     * does not apply there: every path that deletes a page already deletes its
     * blocks in the same request (`routes/pages.ts:478`,
     * `routes/workspaces.ts:617`, `routes/databases.ts:770`). There is no path
     * that deletes a page and keeps its blocks, so the cascade reproduces the
     * existing behaviour rather than adding to it.
     */
    pageId: text()
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    /**
     * Nesting inside a page (list children, toggle bodies, table rows/cells).
     *
     * CASCADE for the same reason: `DELETE /api/blocks/:id` BFS-collects
     * descendants and deletes them (`routes/blocks.ts:596-598`), and no route
     * deletes a block while keeping its children. `deleteBlockTree` still
     * deletes the recursive set explicitly, because the route reports the
     * COUNT and a cascade does not report one.
     *
     * The route also enforces that a parent block belongs to the same page as
     * its child (`routes/blocks.ts:461,539`). That could be made structural
     * with a composite `(parentBlockId, pageId) -> (id, pageId)` self-reference
     * plus a redundant unique, and deliberately is not: nothing ever moves a
     * block between pages, so there is no concurrent-write race for the
     * constraint to close, and a self-referential COMPOSITE foreign key is
     * exactly the construct drizzle-kit has been observed to drop silently from
     * both the migration and the snapshot.
     */
    parentBlockId: text().references((): AnyPgColumn => blocks.id, { onDelete: 'cascade' }),
    /**
     * `$type` so a SELECT is typed as narrowly as the CHECK below constrains
     * it, the same way `content` and `pages.properties` are. Without it a read
     * comes back as bare `string` while an insert is already narrowed by
     * `blocksRepository.CreateBlockInput`, and `routes/blocks.ts` — which
     * re-normalises content against the block's CURRENT type when only the type
     * changed — would need a cast or a guard for a state the CHECK makes
     * unreachable. It is a TypeScript annotation only: the rendered DDL is
     * byte-identical with and without it.
     */
    type: text().$type<BlockType>().notNull(),
    content: jsonb().$type<BlockContent>().notNull().default({}),
    /**
     * The page's `blocksVersion` that last wrote `content` (0: before this
     * was kept). An editor's update says which version of the content it was
     * made on (`baseVersion`); one made on an older version is refused as
     * stale rather than written over someone else's newer text — the editor
     * merges it into that text and sends it again.
     */
    contentVersion: integer().notNull().default(0),
    /** Sibling ordering within `(pageId, parentBlockId)`. See `pages.order`. */
    order: doublePrecision().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    /**
     * Its `pageId` prefix subsumes a standalone `pageId` index.
     */
    index('blocks_page_parent_order_idx').on(t.pageId, t.parentBlockId, t.order),
    /**
     * Same argument as `pages_parent_idx`:
     * `parentBlockId` is a foreign key with a referential action and the
     * recursion column of `deleteBlockTree`.
     */
    index('blocks_parent_block_idx').on(t.parentBlockId),
    /**
     * Backlinks (`GET /pages/:id/backlinks`): page mentions are found by
     * containment in the segments, link-to-page blocks by their target. The
     * expressions must stay exactly as `routes/backlinks.ts` writes them.
     */
    index('blocks_segments_path_idx').using(
      'gin',
      sql`(${t.content} -> 'segments') jsonb_path_ops`,
    ),
    index('blocks_link_to_page_idx')
      .on(sql`(${t.content} ->> 'pageId')`)
      .where(sql`${t.type} = 'link_to_page'`),
    /** Full-text search over block text; see `pages_title_fts_idx`. */
    index('blocks_text_fts_idx').using(
      'gin',
      sql`to_tsvector('nilo_search'::regconfig, coalesce(${t.content} ->> 'text', ''))`,
    ),
    /**
     * Every block's `type` is one of `BLOCK_TYPES`; the transactions that
     * write blocks validate it first, and this holds the storage to it.
     */
    check('blocks_type', sql`${t.type} in (${sql.raw(inList(BLOCK_TYPES))})`),
  ],
);

/**
 * Block transactions already applied, by the key the editor gave them, so a
 * retry of one whose response was lost gets the original answer instead of
 * being applied twice or refused (a re-sent insert would collide with the
 * block it already created, and the editor would undo a change the page
 * has). Rows only need to outlive a client's retries; the endpoint prunes
 * rows older than a day for the page it writes.
 */
export const pageTransactions = pgTable(
  'page_transactions',
  {
    pageId: text()
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    /** The editor's key for the transaction, stable across its retries. */
    key: text().notNull(),
    /** The page's blocks version the transaction produced. */
    version: integer().notNull(),
    /** The operations as applied, returned again to a retry. */
    ops: jsonb().$type<unknown[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.pageId, t.key] }),
    index('page_transactions_page_created_idx').on(t.pageId, t.createdAt),
  ],
);

/** A block as a version keeps it. */
export interface VersionBlock {
  id: string;
  parentBlockId: string | null;
  type: BlockType;
  content: BlockContent;
  order: number;
}

/**
 * Page history: the page's blocks as they were, kept before the first change
 * after a quiet spell and before every restore, so any of them can be looked
 * at and restored. Pruned to the newest `PAGE_VERSIONS_KEPT` per page.
 */
export const pageVersions = pgTable(
  'page_versions',
  {
    id: generatedId(),
    pageId: text()
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    /** The page's blocks version the snapshot shows. */
    blocksVersion: integer().notNull(),
    blocks: jsonb().$type<VersionBlock[]>().notNull(),
    /** Who made the change that followed, i.e. whose edit this version precedes. */
    createdBy: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('page_versions_page_created_idx').on(t.pageId, t.createdAt)],
);

/** The apps that keep data of their own on Nilo pages (`page_app_data.app`). */
export const PAGE_DATA_APPS = ['noted'] as const;
export type PageDataApp = (typeof PAGE_DATA_APPS)[number];

/**
 * What an app built on Nilo keeps about a page that is not the page's content:
 * Noted's recording artifacts and the user's overrides of them. The app owns
 * the shape; Nilo stores it whole, goes with the page, and compares
 * `revision` so a write made on an older one is refused rather than lost.
 */
export const pageAppData = pgTable(
  'page_app_data',
  {
    pageId: text()
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    app: text().$type<PageDataApp>().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    revision: integer().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.pageId, t.app] }),
    check('page_app_data_app', sql`${t.app} in (${sql.raw(inList(PAGE_DATA_APPS))})`),
  ],
);

/** How long a deleted row is remembered for clients catching up (`page_tombstones`). */
export const PAGE_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Database rows deleted for good, so a client that syncs a database's rows
 * (`GET /notes/sync`) learns the row is gone rather than keeping it forever.
 * Written by every path that deletes rows on purpose, and kept for
 * `PAGE_TOMBSTONE_RETENTION_MS`; a client whose cursor is older starts over.
 * Not written when a whole database goes: its rows have nowhere to be synced
 * from, and a reset tells its clients so (`workspace:reset`).
 */
export const pageTombstones = pgTable(
  'page_tombstones',
  {
    /** The deleted page's id: no foreign key, the page is gone. */
    pageId: text().primaryKey(),
    databaseId: text()
      .notNull()
      .references(() => databases.id, { onDelete: 'cascade' }),
    deletedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [index('page_tombstones_database_deleted_idx').on(t.databaseId, t.deletedAt)],
);
