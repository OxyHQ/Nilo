import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { createdAt, generatedId, inList, updatedAt } from '@oxy.so/db';
import { workspaces } from './workspaces.js';

/**
 * The Notion-style typed database feature: a `databases` row owns a schema of
 * typed properties, and `database_views` rows are saved presentations of its
 * rows. The ROWS themselves are pages (`pages.databaseId`) and belong to the
 * pages schema, not this one.
 *
 * ## The domain types live here
 *
 * `DatabaseProperty`, `Filter`, `DATABASE_PROPERTY_TYPES` and the rest are
 * imported — type-only — by `src/lib/databases/{filters,sorts,formula,rollups,
 * property-values,schema-defaults}.ts`, which are pure functions over parsed
 * values. They are declared HERE rather than duplicated or re-exported: the
 * jsonb columns need them for `$type<>()` anyway, so this file is where they
 * are structurally required, and each has one declaration with one owner.
 *
 * ## What became a CHECK and what did not
 *
 * Free-form fields (`filters`, `groupBy`, `config`, and a property's
 * `config`) are validated at the route boundary only, so they get no CHECK.
 * Fields with a typed structure (`propertiesSchema`, `sorts`) and the
 * top-level `type` enum are constrained here. `name`/`icon`/`cover` lengths
 * are capped by zod at the route boundary only, so unlike `workspaces.name`
 * they get no CHECK.
 */

// ---------------------------------------------------------------------------
// Property schema — the shape stored in `databases.propertiesSchema` (jsonb)
// ---------------------------------------------------------------------------

export const DATABASE_PROPERTY_TYPES = [
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'person',
  'files',
  'checkbox',
  'url',
  'email',
  'phone',
  'relation',
  'rollup',
  'created_time',
  'last_edited_time',
  'created_by',
  'last_edited_by',
  'formula',
] as const;
export type DatabasePropertyType = (typeof DATABASE_PROPERTY_TYPES)[number];

export const SELECT_COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export type SelectColor = (typeof SELECT_COLORS)[number];

export interface SelectOption {
  id: string;
  name: string;
  color: SelectColor;
}

export type NumberFormat =
  | 'number'
  | 'percent'
  | 'currency:USD'
  | 'currency:EUR'
  | 'currency:GBP'
  | 'currency:JPY';

export interface PropertyConfig {
  // select / multi_select / status
  options?: SelectOption[];
  // number
  format?: NumberFormat;
  precision?: number;
  // date
  includeTime?: boolean;
  // relation
  targetDatabaseId?: string;
  twoWay?: boolean;
  // rollup
  relationPropertyId?: string;
  targetPropertyId?: string;
  function?: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'earliest' | 'latest';
  // formula
  expression?: string;
}

export interface DatabaseProperty {
  id: string;
  name: string;
  type: DatabasePropertyType;
  config?: PropertyConfig;
}

/**
 * Stored as `properties_schema`, not `schema`: the field is named
 * `propertiesSchema` throughout so it cannot be confused with a database
 * schema. The wire format still exposes it as `schema`, which is
 * the route's serializer's business and not this table's.
 */
export interface DatabaseSchema {
  properties: DatabaseProperty[];
}

// ---------------------------------------------------------------------------
// View config — the shapes stored in `database_views`' jsonb columns
// ---------------------------------------------------------------------------

export const DATABASE_VIEW_TYPES = [
  'table',
  'board',
  'gallery',
  'list',
  'calendar',
  'timeline',
] as const;
export type DatabaseViewType = (typeof DATABASE_VIEW_TYPES)[number];

/**
 * Declared as a tuple so the CHECK below and the TypeScript type are derived
 * from one list and cannot drift.
 */
export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export interface ViewSort {
  propertyId: string;
  direction: SortDirection;
}

/**
 * Filter trees mix two node kinds:
 *  - `condition`: leaf — applies an `operator` to `propertyId` against `value`.
 *  - `group`: branch — combines child filters via AND/OR.
 *
 * Persisted as plain JSON; validation happens at the route boundary
 * (`src/lib/databases/filters.ts`). The column carries no CHECK.
 */
export interface FilterCondition {
  kind: 'condition';
  propertyId: string;
  operator: string;
  value?: unknown;
}

export interface FilterGroup {
  kind: 'group';
  combinator: 'and' | 'or';
  filters: Filter[];
}

export type Filter = FilterCondition | FilterGroup;

/** Board grouping. `null` when the view is ungrouped. */
export interface ViewGroupBy {
  propertyId: string;
}

/**
 * View-type-specific config. Open shape — only the fields relevant to the
 * view type are read. Documented options:
 *   - calendar: { datePropertyId }
 *   - timeline: { startPropertyId, endPropertyId? }
 *   - gallery:  { coverSource, coverPropertyId?, fit? }
 *   - board:    grouping is via top-level `groupBy`; no extra fields needed.
 */
export interface ViewConfig {
  datePropertyId?: string;
  startPropertyId?: string;
  endPropertyId?: string;
  coverSource?: 'property' | 'pageCover';
  coverPropertyId?: string;
  fit?: 'cover' | 'contain';
}

/** The default a view is created with when the caller supplies no filter. */
export const EMPTY_FILTER_GROUP: FilterGroup = {
  kind: 'group',
  combinator: 'and',
  filters: [],
};

/** The default `pageSize` of a view. */
export const DEFAULT_VIEW_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// CHECK rendering for values buried in jsonb
// ---------------------------------------------------------------------------

/**
 * `@ == "a" || @ == "b"` — the jsonpath analogue of `inList`, for a closed
 * value set inside a jsonb document.
 *
 * Same safety contract as `inList`: `const` tuples of identifier-shaped
 * literals only, never a runtime value. It is not an escaping routine.
 *
 * Why jsonpath rather than the obvious `jsonb_array_elements` form: a CHECK
 * constraint may not contain a subquery, so the readable
 * `not exists (select 1 from jsonb_array_elements(...) ...)` is rejected
 * outright at CREATE TABLE. The two-argument `jsonb_path_exists` is IMMUTABLE
 * and needs no subquery.
 */
function jsonPathAnyOf(values: readonly string[]): string {
  return values.map((value) => `@ == "${value}"`).join(' || ');
}

/*
 * A CHECK's predicate is satisfied unless it evaluates to FALSE, so every
 * expression below is written as "no violating element exists" rather than
 * "every element is valid" — the latter is NULL, and therefore passes, on the
 * inputs that matter.
 *
 * Measured on the real server (PG 17.10) rather than reasoned about, because
 * three of these read the comfortable way round:
 *   - `jsonb_typeof(doc->'properties') = 'array'` is NULL when the key is
 *     absent entirely, so `{}` PASSES it. `coalesce` to a jsonb `null` is what
 *     makes a missing key fail. Same shape as the `array_length` trap.
 *   - `$.properties[*].type ? (!(...))` yields nothing when a property has no
 *     `type` key at all, so the enum check alone ADMITS a property missing its
 *     type. `exists(@.type)` in the shape check is what covers it.
 *   - `$.properties[*]` auto-wraps a scalar in lax mode, so a `properties`
 *     that is a string is walked as a one-element array rather than erroring.
 */

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const databases = pgTable(
  'databases',
  {
    id: generatedId(),
    workspaceId: text()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text().notNull().default(''),
    icon: text(),
    cover: text(),
    /** Oxy user id — text, not a foreign key. See `workspaces.ownerId`. */
    ownerId: text().notNull(),
    propertiesSchema: jsonb().$type<DatabaseSchema>().notNull().default({ properties: [] }),
    isInline: boolean().notNull().default(false),
    /**
     * The page an inline database is rendered inside.
     *
     * DELIBERATELY carries no `.references(() => pages.id)` yet: the `pages`
     * table is ported in a sibling change and does not exist in this schema
     * folder at the time of writing, so declaring the reference here would not
     * compile. The foreign key belongs in the integration commit that first
     * has both tables. Two things that commit must get right:
     *
     * ## It must be SET NULL, and that is a choice about the PAIR
     *
     * `databases.parentPageId -> pages.id` ON DELETE **SET NULL**, paired with
     * `pages.databaseId -> databases.id` ON DELETE **CASCADE**. Neither line is
     * safe to review on its own — the hazard is the interaction, so a reviewer
     * reading one line at a time cannot see it.
     *
     * Measured by port-pages-blocks against a real server, 2026-08-12, on a
     * host page H, its child C, an inline database D on H, and D's row R (which
     * is created with `parentId: null` at `routes/databases.ts:1057`, so R is
     * NOT in H's subtree). Deleting {H, C} — the set `deletePageTree` computes:
     *
     *   parentPageId CASCADE + databaseId CASCADE -> H cascades to D, D
     *     cascades back into `pages` and takes R. Three pages destroyed, two
     *     asked for. Worse, `deletePageTree` counts from `RETURNING`, which
     *     never reports cascade-deleted rows, so it answers `deleted: 2` having
     *     destroyed 3 — silent data loss AND a wrong count.
     *   parentPageId CASCADE + databaseId SET NULL -> no chain, but a deleted
     *     database's rows become loose parentless pages in the sidebar.
     *   parentPageId SET NULL + databaseId CASCADE -> R survives, count is
     *     correct. The only safe pair.
     *
     * SET NULL is safe here because nothing reads `parentPageId` as a
     * predicate: it is written at `routes/databases.ts:687-688`, serialized at
     * `:315`, and that is all — so an orphaned inline database keeps appearing
     * in exactly the list it already appeared in. WHAT WOULD INVALIDATE THIS:
     * any route filtering `parent_page_id IS NULL` to mean "top-level
     * database", which would turn an orphan into a different category.
     *
     * ## Verify the result, do not trust the declaration
     *
     * A circular column-level reference has been silently dropped from both a
     * generated migration and its snapshot before. port-pages-blocks measured
     * that this particular pair survives — drizzle emits FKs as separate
     * `ALTER TABLE ADD CONSTRAINT` after every `CREATE TABLE`, so both land —
     * and confirmed both in `pg_constraint`. Re-check there, not here.
     *
     * BOTH columns must also stay NULLABLE: if either became `notNull` the
     * pair is uninsertable without `DEFERRABLE INITIALLY DEFERRED`.
     */
    parentPageId: text(),
    /**
     * Soft delete — a boolean.
     *
     * NOT `archivedAt`, despite `workspaces.archivedAt` sitting next door.
     * That column is not a house convention about how soft deletes are
     * represented. An already-archived database has no true `archived_at`,
     * only `updatedAt`, which a future trash auto-purge would misread.
     *
     * It is also two-way rather than a one-way stamp — `PATCH /databases/:id`
     * accepts `archived: false` and un-archives (`routes/databases.ts:731`),
     * unlike the workspace route, which only ever stamps
     * (`routes/workspaces.ts:325-332`).
     */
    archived: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    /**
     * `GET /databases?workspaceId=` filters on workspace + not-archived and
     * sorts `updatedAt` DESC, so all three columns are in the index.
     *
     * There is no separate single-column `workspaceId` index: a btree on
     * `(workspace_id, archived_at, ...)` serves every query that could use a
     * `workspace_id` index on its own, so a second index would be maintained
     * on every write and read by nothing.
     */
    index('databases_workspace_archived_updated_idx').on(
      t.workspaceId,
      t.archived,
      t.updatedAt.desc(),
    ),
    /**
     * Ported from `DatabaseSchemaDef.index({ parentPageId: 1 })`.
     *
     * It has NO query reader — `parent_page_id` is written and serialized but
     * never a predicate (see the column's note) — and it is still not dead
     * weight, for a reason unrelated to queries: once the FK above exists,
     * `ON DELETE SET NULL` has to find every referencing row on each page
     * delete, and Postgres does not index a referencing column automatically.
     * Measured on this server at 300k rows: 8.42ms per page delete without
     * this index, 0.15ms with it — 55x. Deleting a page tree pays that per
     * page.
     *
     * So do not drop it as unused when the census says nothing reads it; the
     * reader is the constraint, not a query.
     */
    index('databases_parent_page_idx').on(t.parentPageId),
    /**
     * The property-type enum, derived from `DATABASE_PROPERTY_TYPES` rather
     * than retyped, exactly as `inList` does for a plain text column. Ports
     * `DatabasePropertySchema`'s `enum: DATABASE_PROPERTY_TYPES`.
     *
     * Vacuously true for `{"properties": []}`, which is the column default and
     * a legitimate state — a database with no properties yet.
     */
    check(
      'databases_property_types',
      sql`not jsonb_path_exists(${t.propertiesSchema}, ${sql.raw(
        `'$.properties[*].type ? (!(${jsonPathAnyOf(DATABASE_PROPERTY_TYPES)}))'`,
      )})`,
    ),
    /**
     * Ports the sub-schema's structure: `properties` is an array, and every
     * element carries a non-empty string `id` and `name` (`''` is rejected as
     * well as absent) and a `type` key at all.
     *
     * `coalesce(..., 'null'::jsonb)` is load-bearing: without it a document
     * with no `properties` key at all yields NULL, and a CHECK rejects only
     * FALSE.
     */
    check(
      'databases_properties_schema_shape',
      sql`jsonb_typeof(coalesce(${t.propertiesSchema} -> 'properties', 'null'::jsonb)) = 'array'
        and not jsonb_path_exists(${t.propertiesSchema}, ${sql.raw(
          `'$.properties[*] ? (!(@.id.type() == "string" && @.id <> "" && @.name.type() == "string" && @.name <> "" && exists(@.type)))'`,
        )})`,
    ),
  ],
);

export const databaseViews = pgTable(
  'database_views',
  {
    id: generatedId(),
    databaseId: text()
      .notNull()
      .references(() => databases.id, { onDelete: 'cascade' }),
    name: text().notNull().default(''),
    type: text().$type<DatabaseViewType>().notNull().default('table'),
    isDefault: boolean().notNull().default(false),
    filters: jsonb().$type<FilterGroup>().notNull().default(EMPTY_FILTER_GROUP),
    sorts: jsonb().$type<ViewSort[]>().notNull().default([]),
    /** `null` when the view is ungrouped — the default. */
    groupBy: jsonb().$type<ViewGroupBy>(),
    hiddenProperties: text().array().notNull().default([]),
    frozenProperties: text().array().notNull().default([]),
    pageSize: integer().notNull().default(DEFAULT_VIEW_PAGE_SIZE),
    config: jsonb().$type<ViewConfig>().notNull().default({}),
    /**
     * `double precision`, NOT an integer or a bigint, and both halves of that
     * matter. `createViewSchema.order` is `z.number().finite()` — fractional
     * orders are accepted by the API today, and an `integer` column would
     * round one silently. And `postgres.js` decodes `bigint`/`int8` as a
     * STRING while drizzle types it `number`, so `max(order) + 1` on an int8
     * column would be string concatenation; `float8` decodes to a real number.
     */
    order: doublePrecision().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    /**
     * Every view listing is `where database_id = ? order by "order", created_at`
     * (`routes/databases.ts:607-609, 695-697, 1110-1112, 1276-1277`), and
     * "next order" is the same index read backwards (`:1134-1137`).
     * `created_at` is included so the sort is covered rather than only the
     * filter.
     *
     * There is no separate single-column `databaseId` index, for the same
     * reason as on `databases`: it would be a strict prefix of this one.
     *
     * `findOne({databaseId, isDefault: true})` gets no index of its own — a
     * database holds a handful of views, so the prefix scan is the whole set.
     */
    index('database_views_database_order_idx').on(t.databaseId, t.order, t.createdAt),
    // Ports `type: { enum: DATABASE_VIEW_TYPES }`, which ran on every write:
    // views are only ever created with `.create()` and updated with
    // `view.type = ...; view.save()`.
    check('database_views_type', sql`${t.type} in (${sql.raw(inList(DATABASE_VIEW_TYPES))})`),
    /**
     * Ports `sorts: [ViewSortSchema]` — an array whose elements each carry a
     * required non-empty `propertyId` and a `direction` in
     * `SORT_DIRECTIONS`.
     *
     * `jsonb_typeof` needs no `coalesce` here because the column is NOT NULL
     * and the value is the whole column rather than a key inside it.
     */
    check(
      'database_views_sorts_shape',
      sql`jsonb_typeof(${t.sorts}) = 'array'
        and not jsonb_path_exists(${t.sorts}, ${sql.raw(
          `'$[*] ? (!(@.propertyId.type() == "string" && @.propertyId <> "" && exists(@.direction)))'`,
        )})
        and not jsonb_path_exists(${t.sorts}, ${sql.raw(
          `'$[*].direction ? (!(${jsonPathAnyOf(SORT_DIRECTIONS)}))'`,
        )})`,
    ),
  ],
);
