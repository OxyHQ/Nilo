/**
 * A view's rows in PostgreSQL: its filter tree, the title search and its sorts
 * compiled to SQL over the database's row pages, paged by keyset.
 *
 * The SQL answers what `evaluateFilter` and `compareBySorts` answer for the
 * same rows, value for value: a property's value is read where
 * `readPropertyValue` reads it (`pages.properties` by property id, the title,
 * or a page column), emptiness and every operator follow `filters.ts`, and
 * each sort key is `sorts.ts`' scalar in the same order (nulls last ascending,
 * first descending; text by the `nilo_sort` collation, which `compareText`
 * mirrors). `view-query.pgdb.test.ts` holds the two to each other on random
 * views. Formulas and rollups are computed in JS, so a view that reads one is
 * not compiled here: the route keeps the JS path for it.
 *
 * Every value that comes from a user — property ids, option ids, filter
 * values, the search, the cursor — is a bound parameter.
 */
import { and, asc, eq, or, type SQL, sql } from 'drizzle-orm';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import type { PgHandle } from '../../db/client.js';
import type { DatabaseProperty, Filter, ViewSort } from '../../db/schema/databases.js';
import { pages } from '../../db/schema/pages.js';
import type { PageRow } from '../../repositories/pages.js';
import { emptyMatches } from './filters.js';
import { type GroupKey, type GroupSpec, groupKind, orderedOptionIds } from './groups.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A sort key: a number (`float8`) or a text ordered by `nilo_sort` (or by bytes, `collate "C"`). */
type KeyKind = 'number' | 'text';

interface SortKey {
  expr: SQL;
  kind: KeyKind;
  direction: 'asc' | 'desc';
}

/**
 * A view's grouping in SQL (`groups.ts` is its JS reference): each row's
 * group (`key`, text, NULL for the empty group), the keys its groups are
 * ordered by, and for a property with several values a lateral join giving
 * the row once per value.
 */
export interface CompiledGroup {
  key: SQL;
  keys: SortKey[];
  lateral: SQL | null;
  /** Whether a row's group (`key`) is one the view shows; null when it hides none. */
  shown: SQL | null;
}

/** A view compiled to SQL: which rows it shows and the order it shows them in. */
export interface CompiledView {
  where: SQL;
  /** The group's keys first when the view is grouped, then its sorts. */
  keys: SortKey[];
  group: CompiledGroup | null;
}

// ---------------------------------------------------------------------------
// JSON values, read as JavaScript reads them
// ---------------------------------------------------------------------------

/** `x ?? null`: SQL NULL for an absent key and for JSON null alike. */
const present = (x: SQL) => sql`nullif(${x}, 'null'::jsonb)`;

/** `typeof x === 'object' && x !== null`: an object or an array. */
const isObject = (x: SQL) => sql`coalesce(jsonb_typeof(${x}) in ('object', 'array'), false)`;

/** JavaScript truthiness of a JSON value; an absent one is falsy. */
const truthy = (x: SQL) => sql`(case jsonb_typeof(${x})
  when 'string' then (${x} #>> '{}') <> ''
  when 'number' then (${x})::numeric <> 0
  when 'boolean' then (${x})::boolean
  when 'object' then true
  when 'array' then true
  else false end)`;

/** `Array.isArray(x) && x.length > 0`. */
const nonEmptyArray = (x: SQL) =>
  sql`(case when jsonb_typeof(${x}) = 'array' then jsonb_array_length(${x}) > 0 else false end)`;

/** A JSON scalar as text (`String(x)` for a string or a number); NULL when absent. */
const asText = (x: SQL) => sql`(${x} #>> '{}')`;

/** `arr.join(',')` of a non-empty array, NULL otherwise — `scalarFor`'s list key. */
const joined = (x: SQL) => sql`(case when ${nonEmptyArray(x)} then (
  select string_agg(coalesce(e.value #>> '{}', ''), ',' order by e.ordinality)
  from jsonb_array_elements(${x}) with ordinality as e(value, ordinality)
) end)`;

/** Milliseconds since the epoch, floored as `Date#getTime` reads an instant. */
const epochMs = (instant: SQL) => sql`floor(extract(epoch from ${instant}) * 1000)::float8`;

const ISO_DAY = String.raw`^\d{4}-\d{2}-\d{2}$`;
const ISO_INSTANT = String.raw`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$`;

/**
 * `new Date(start).getTime()` of a stored date, for the forms the server
 * writes: an ISO instant with its offset, or a day (UTC midnight, as
 * JavaScript reads one). Anything else — which JavaScript reads as NaN — is
 * NULL, and an impossible date is NULL rather than an error.
 */
function dateMs(start: SQL): SQL {
  const text = asText(start);
  const day = sql`(${text} || 'T00:00:00Z')`;
  return sql`(case
    when jsonb_typeof(${start}) <> 'string' then null
    when ${text} ~ ${ISO_DAY} and pg_input_is_valid(${day}, 'timestamptz')
      then ${epochMs(sql`${day}::timestamptz`)}
    when ${text} ~ ${ISO_INSTANT} and pg_input_is_valid(${text}, 'timestamptz')
      then ${epochMs(sql`(${text})::timestamptz`)}
  end)`;
}

/** Lowercased as `String#toLowerCase` does: full Unicode case mapping. */
const lowered = (text: SQL) => sql`lower(${text} collate "und-x-icu")`;

const float = (n: number) => sql`${n}::float8`;
const never = sql`false`;

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

/** What filtering and sorting need of one property, mirroring `filters.ts` and `sorts.ts`. */
interface Accessor {
  /** `isEmpty(value, type)`; never NULL. */
  empty: SQL;
  /** The operator on a value that is not empty; `null` when it never matches. */
  test(operator: string, value: unknown): SQL | null;
  /** `scalarFor`: the value a sort compares. */
  key: { expr: SQL; kind: KeyKind };
}

/** Text, URL, email and phone (`{ text }` or `{ value }`); `stored` null for the title. */
function textAccessor(stored: SQL | null): Accessor {
  // The title reads as `{ text: title }`: empty when it is '', never absent.
  const scalar = stored
    ? asText(
        sql`coalesce(${present(sql`${stored} -> 'text'`)}, ${present(sql`${stored} -> 'value'`)})`,
      )
    : sql`${pages.title}`;
  const empty = stored
    ? sql`not (${isObject(stored)} and (${truthy(sql`${stored} -> 'text'`)} or ${truthy(sql`${stored} -> 'value'`)}))`
    : sql`(${pages.title} = '')`;
  return {
    empty,
    test(operator, value) {
      const haystack = lowered(sql`coalesce(${scalar}, '')`);
      const needle = String(value ?? '').toLowerCase();
      switch (operator) {
        case 'equals':
          return sql`${haystack} = ${needle}::text`;
        case 'does_not_equal':
          return sql`${haystack} <> ${needle}::text`;
        case 'contains':
          return sql`strpos(${haystack}, ${needle}::text) > 0`;
        case 'starts_with':
          return sql`starts_with(${haystack}, ${needle}::text)`;
        case 'ends_with':
          return sql`right(${haystack}, char_length(${needle}::text)) = ${needle}::text`;
        default:
          return null;
      }
    },
    key: { expr: scalar, kind: 'text' },
  };
}

function numberAccessor(stored: SQL): Accessor {
  const field = sql`${stored} -> 'number'`;
  const number = sql`(case when jsonb_typeof(${field}) = 'number' then (${field})::float8 end)`;
  return {
    empty: sql`not (${isObject(stored)} and ${present(field)} is not null)`,
    test(operator, value) {
      const target = Number(value);
      if (Number.isNaN(target)) return null;
      const t = float(target);
      switch (operator) {
        case '=':
          return sql`${number} = ${t}`;
        // A stored value that is not a number is never equal to one.
        case '!=':
          return sql`coalesce(${number} <> ${t}, true)`;
        case '>':
          return sql`${number} > ${t}`;
        case '<':
          return sql`${number} < ${t}`;
        case '>=':
          return sql`${number} >= ${t}`;
        case '<=':
          return sql`${number} <= ${t}`;
        default:
          return null;
      }
    },
    key: { expr: number, kind: 'number' },
  };
}

function optionAccessor(stored: SQL, property: DatabaseProperty): Accessor {
  const option = sql`${stored} -> 'optionId'`;
  const isOption = (value: unknown) =>
    sql`coalesce(jsonb_typeof(${option}) = 'string' and ${asText(option)} = ${String(value)}::text, false)`;
  // In the order the options are listed; an option not listed sorts as empty.
  const ids = (property.config?.options ?? []).map((o) => sql`${o.id ?? null}::text`);
  const position = sql`array_position(array[${sql.join(ids, sql`, `)}]::text[], ${asText(option)})`;
  return {
    empty: sql`not (${isObject(stored)} and ${truthy(option)})`,
    test(operator, value) {
      if (operator === 'is') return isOption(value);
      if (operator === 'is_not') return sql`not ${isOption(value)}`;
      return null;
    },
    key: {
      expr: sql`(case when jsonb_typeof(${option}) = 'string' then (${position} - 1)::float8 end)`,
      kind: 'number',
    },
  };
}

/** `evaluateCondition`'s list operators read the first list the value has. */
function listContains(stored: SQL, value: unknown): SQL {
  const list = sql`coalesce(${present(sql`${stored} -> 'optionIds'`)}, ${present(sql`${stored} -> 'userIds'`)}, ${present(sql`${stored} -> 'pageIds'`)})`;
  return sql`(case when jsonb_typeof(${list}) = 'array' then ${list} ? ${String(value ?? '')}::text else false end)`;
}

function listAccessor(stored: SQL, field: 'optionIds' | 'userIds' | 'pageIds'): Accessor {
  const list = sql`${stored} -> ${field}::text`;
  return {
    empty: sql`not (${isObject(stored)} and ${nonEmptyArray(list)})`,
    test(operator, value) {
      if (operator === 'contains') return listContains(stored, value);
      if (operator === 'does_not_contain') return sql`not ${listContains(stored, value)}`;
      return null;
    },
    key: { expr: joined(list), kind: 'text' },
  };
}

/** `created_by` and `last_edited_by`: one user id from the page's columns, '' for none. */
function userAccessor(user: SQL): Accessor {
  return {
    empty: sql`(${user} = '')`,
    test(operator, value) {
      const target = String(value ?? '');
      if (operator === 'contains') return sql`${user} = ${target}::text`;
      if (operator === 'does_not_contain') return sql`${user} <> ${target}::text`;
      return null;
    },
    key: { expr: sql`nullif(${user}, '')`, kind: 'text' },
  };
}

function dateAccessor(ms: SQL, empty: SQL, includeTime: SQL): Accessor {
  return {
    empty,
    test(operator, value) {
      if (operator === 'in_last' || operator === 'in_next') {
        const days = Number(value);
        if (!Number.isFinite(days)) return null;
        const now = Date.now();
        const [from, to] =
          operator === 'in_last' ? [now - days * DAY_MS, now] : [now, now + days * DAY_MS];
        return sql`(${ms} >= ${float(from)} and ${ms} <= ${float(to)})`;
      }
      const target = value ? new Date(String(value)).getTime() : Number.NaN;
      if (Number.isNaN(target)) return null;
      switch (operator) {
        case 'before':
          return sql`${ms} < ${float(target)}`;
        case 'after':
          return sql`${ms} > ${float(target)}`;
        case 'on_or_before':
          return sql`${ms} <= ${float(target)}`;
        case 'on_or_after':
          return sql`${ms} >= ${float(target)}`;
        // To the millisecond when the value has a time, else the same UTC day.
        case 'equals':
          return sql`(case when ${includeTime} then ${ms} = ${float(target)}
            else floor(${ms} / ${DAY_MS}) = ${float(Math.floor(target / DAY_MS))} end)`;
        default:
          return null;
      }
    },
    key: { expr: ms, kind: 'number' },
  };
}

export function accessorFor(property: DatabaseProperty): Accessor {
  if (property.id === 'name' && property.type === 'text') return textAccessor(null);
  const stored = sql`(${pages.properties} -> ${property.id}::text)`;
  switch (property.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return textAccessor(stored);
    case 'number':
    case 'unique_id':
      return numberAccessor(stored);
    case 'select':
    case 'status':
      return optionAccessor(stored, property);
    case 'multi_select':
      return listAccessor(stored, 'optionIds');
    case 'person':
      return listAccessor(stored, 'userIds');
    case 'relation':
      return listAccessor(stored, 'pageIds');
    case 'created_by':
      return userAccessor(sql`${pages.ownerId}`);
    case 'last_edited_by':
      return userAccessor(sql`coalesce(${pages.lastEditedBy}, ${pages.ownerId})`);
    case 'date': {
      const start = sql`${stored} -> 'start'`;
      return dateAccessor(
        dateMs(start),
        sql`not (${isObject(stored)} and ${truthy(start)})`,
        truthy(sql`${stored} -> 'includeTime'`),
      );
    }
    case 'created_time':
      return dateAccessor(epochMs(sql`${pages.createdAt}`), never, never);
    case 'last_edited_time':
      return dateAccessor(epochMs(sql`${pages.updatedAt}`), never, never);
    case 'checkbox': {
      const checked = truthy(sql`${stored} -> 'checked'`);
      return {
        // `false` is a value: only a missing one is empty.
        empty: sql`not ${isObject(stored)}`,
        test(operator, value) {
          const target = sql.raw(value ? 'true' : 'false');
          if (operator === 'is') return sql`${checked} = ${target}`;
          if (operator === 'is_not') return sql`${checked} <> ${target}`;
          return null;
        },
        key: {
          expr: sql`(case when ${isObject(stored)} then (case when ${checked} then 1 else 0 end)::float8 end)`,
          kind: 'number',
        },
      };
    }
    case 'files': {
      const files = sql`${stored} -> 'files'`;
      return {
        empty: sql`not (${isObject(stored)} and ${nonEmptyArray(files)})`,
        test: () => null,
        key: {
          expr: sql`(case when ${nonEmptyArray(files)} then ${files} -> 0 ->> 'name' end)`,
          kind: 'text',
        },
      };
    }
    // A button holds no value: always empty, never matched, sorted as nothing.
    case 'button':
      return {
        empty: sql`true`,
        test: () => null,
        key: { expr: sql`null::float8`, kind: 'number' },
      };
    case 'formula':
    case 'rollup':
      throw new Error(`A ${property.type} is computed in JS and cannot be read in SQL`);
  }
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

const textArray = (values: readonly (string | null)[]) =>
  sql`array[${sql.join(
    values.map((v) => sql`${v}::text`),
    sql`, `,
  )}]::text[]`;

/** The groups' order for text keys: as a sort orders them, then by their bytes. */
function textGroupKeys(key: SQL): SortKey[] {
  return [
    { expr: sql`(${key}) collate nilo_sort`, kind: 'text', direction: 'asc' },
    { expr: sql`(${key}) collate "C"`, kind: 'text', direction: 'asc' },
  ];
}

/** The alias of a multi-valued property's lateral join (`… cross join lateral <lateral>`): one row per value, `nilo_group.k`. */
const GROUP_KEY = sql`nilo_group.k`;

/**
 * Each value of a list as a row of `nilo_group`, distinct, the strings among
 * them only (`listed`, when given, those only); one NULL row for none.
 */
function lateralValues(list: SQL, listed: readonly string[] | null): SQL {
  const elements = sql`jsonb_array_elements(case when jsonb_typeof(${list}) = 'array' then ${list} else '[]'::jsonb end) as nilo_value(v)`;
  const kept = listed
    ? sql`jsonb_typeof(nilo_value.v) = 'string' and (nilo_value.v #>> '{}') = any(${textArray(listed)})`
    : sql`jsonb_typeof(nilo_value.v) = 'string'`;
  return sql`unnest(coalesce(nullif(array(select distinct (nilo_value.v #>> '{}') from ${elements} where ${kept}), '{}'::text[]), array[null]::text[])) as nilo_group(k)`;
}

/** The day, week, month or year a date falls in, as `groups.ts`' `dateGroupKey`. */
function dateGroup(ms: SQL, includeTime: SQL, spec: GroupSpec): Omit<CompiledGroup, 'shown'> {
  const at = sql`to_timestamp(${ms} / 1000.0)`;
  const local = sql`(case when ${includeTime} then (${at} at time zone ${spec.timeZone}::text) else (${at} at time zone 'UTC') end)`;
  const bucket = sql`date_trunc(${spec.granularity}::text, ${local})`;
  return {
    key: sql`to_char(${bucket}, 'YYYY-MM-DD')`,
    keys: [{ expr: sql`extract(epoch from ${bucket})::float8`, kind: 'number', direction: 'asc' }],
    lateral: null,
  };
}

/**
 * What `groups.ts`' `rowGroupKeys` and `compareGroupKeys` answer, in SQL: the
 * groups the view lists first (`order`) before the others, and whether a
 * group is one it shows (`hidden`).
 */
export function compileGroup(spec: GroupSpec): CompiledGroup {
  const group = groupKeys(spec);
  const order = spec.order ?? [];
  const hidden = spec.hidden ?? [];
  return {
    ...group,
    keys: order.length
      ? [
          {
            expr: sql`coalesce(array_position(${textArray(order)}, ${group.key}) - 1, ${order.length}::int)::float8`,
            kind: 'number',
            direction: 'asc',
          },
          ...group.keys,
        ]
      : group.keys,
    shown: hidden.length ? sql`(array_position(${textArray(hidden)}, ${group.key}) is null)` : null,
  };
}

/** A number's range (`groups.ts`' `numberGroupKey`): its index, -1 below, `count` from `to` up. */
function numberGroup(n: SQL, spec: GroupSpec): Omit<CompiledGroup, 'shown'> {
  const ranges = spec.numbers;
  if (!ranges) throw new Error('A number is grouped by its ranges');
  const from = float(ranges.from);
  const index = sql`(case
    when ${n} is null then null
    when ${n} < ${from} then (-1)::float8
    when ${n} >= ${float(ranges.to)} then ${float(ranges.count)}
    else least(${float(ranges.count - 1)}, floor((${n} - ${from}) / ${float(ranges.step)}))
  end)`;
  return {
    key: sql`((${index})::int)::text`,
    keys: [{ expr: index, kind: 'number', direction: 'asc' }],
    lateral: null,
  };
}

function groupKeys(spec: GroupSpec): Omit<CompiledGroup, 'shown'> {
  const { property } = spec;
  const stored = sql`(${pages.properties} -> ${property.id}::text)`;
  switch (groupKind(property)) {
    case 'option': {
      const option = sql`${stored} -> 'optionId'`;
      const id = sql`(case when jsonb_typeof(${option}) = 'string' then ${asText(option)} end)`;
      const position = sql`array_position(${textArray(orderedOptionIds(property))}, ${id})`;
      return {
        key: sql`(case when ${position} is not null then ${id} end)`,
        keys: [{ expr: sql`(${position} - 1)::float8`, kind: 'number', direction: 'asc' }],
        lateral: null,
      };
    }
    case 'list_option': {
      const ids = orderedOptionIds(property);
      return {
        key: GROUP_KEY,
        keys: [
          {
            expr: sql`(array_position(${textArray(ids)}, ${GROUP_KEY}) - 1)::float8`,
            kind: 'number',
            direction: 'asc',
          },
        ],
        lateral: lateralValues(sql`${stored} -> 'optionIds'`, ids),
      };
    }
    case 'people':
      return {
        key: GROUP_KEY,
        keys: textGroupKeys(GROUP_KEY),
        lateral: lateralValues(sql`${stored} -> 'userIds'`, null),
      };
    case 'user': {
      const user =
        property.type === 'created_by'
          ? sql`${pages.ownerId}`
          : sql`coalesce(${pages.lastEditedBy}, ${pages.ownerId})`;
      const key = sql`nullif(${user}, '')`;
      return { key, keys: textGroupKeys(key), lateral: null };
    }
    case 'checkbox': {
      const checked = truthy(sql`${stored} -> 'checked'`);
      return {
        key: sql`(case when ${checked} then 'true' else 'false' end)`,
        keys: [
          {
            expr: sql`(case when ${checked} then 0 else 1 end)::float8`,
            kind: 'number',
            direction: 'asc',
          },
        ],
        lateral: null,
      };
    }
    case 'date':
      if (property.type === 'created_time')
        return dateGroup(epochMs(sql`${pages.createdAt}`), sql`true`, spec);
      if (property.type === 'last_edited_time')
        return dateGroup(epochMs(sql`${pages.updatedAt}`), sql`true`, spec);
      return dateGroup(
        dateMs(sql`${stored} -> 'start'`),
        truthy(sql`${stored} -> 'includeTime'`),
        spec,
      );
    case 'text': {
      const accessor = accessorFor(property);
      const key = sql`(case when ${accessor.empty} then null else ${accessor.key.expr} end)`;
      return { key, keys: textGroupKeys(key), lateral: null };
    }
    // A stored number: a formula's or a rollup's is computed, and grouped, in JS.
    case 'number':
      return numberGroup(accessorFor(property).key.expr, spec);
    default:
      throw new Error(`A ${property.type} property has no groups`);
  }
}

/** The rows a view reads: the database's pages, once per group for a multi-valued group. */
export function rowSource(view: CompiledView): SQL {
  return view.group?.lateral
    ? sql`${pages} cross join lateral ${view.group.lateral}`
    : sql`${pages}`;
}

/**
 * What a view's grouped rows (`rowSource`) are read with: its rows, and of a
 * row in several groups only its entries in groups the view shows.
 */
export function groupedWhere(view: CompiledView): SQL {
  const group = view.group;
  return group?.lateral && group.shown ? sql`(${view.where} and ${group.shown})` : view.where;
}

/**
 * The smallest and largest number of a stored number property in the
 * database's rows (`groups.ts`' `numberBounds`): what a view grouped by it
 * with no ranges of its own spans.
 */
export async function numberBoundsInSql(
  handle: PgHandle,
  databaseId: string,
  property: DatabaseProperty,
): Promise<{ min: number | null; max: number | null }> {
  const n = accessorFor(property).key.expr;
  const [row] = await handle.execute<{ min: number | string | null; max: number | string | null }>(
    sql`select min(${n}) as min, max(${n}) as max from ${pages}
      where ${pages.databaseId} = ${databaseId} and ${pages.archived} = false and ${pages.template} = false`,
  );
  const read = (x: number | string | null | undefined) =>
    x === null || x === undefined ? null : Number(x);
  return { min: read(row?.min), max: read(row?.max) };
}

/**
 * How many of a compiled view's rows each of its groups holds, and with
 * `measure` (a number per row) its sum and average there: a grouped view's
 * sections, a chart's points.
 */
export async function listViewGroups(
  handle: PgHandle,
  view: CompiledView,
  measure?: SQL,
): Promise<Map<GroupKey, { count: number; sum: number | null; average: number | null }>> {
  const group = view.group;
  if (!group) throw new Error('The view is not grouped');
  const rows = await handle.execute<{
    k: string | null;
    count: number;
    sum: number | null;
    average: number | null;
  }>(sql`select ${group.key} as k, count(*)::int as count,
      ${measure ? sql`sum(${measure})::float8` : sql`null::float8`} as sum,
      ${measure ? sql`avg(${measure})::float8` : sql`null::float8`} as average
    from ${rowSource(view)} where ${groupedWhere(view)} group by 1`);
  return new Map(
    [...rows].map((r) => [
      r.k,
      {
        count: Number(r.count),
        sum: r.sum === null ? null : Number(r.sum),
        average: r.average === null ? null : Number(r.average),
      },
    ]),
  );
}

// ---------------------------------------------------------------------------
// Filters, search and sorts
// ---------------------------------------------------------------------------

function compileFilter(filter: Filter, propertyById: Map<string, DatabaseProperty>): SQL {
  if (filter.kind === 'group') {
    if (filter.filters.length === 0) return sql`true`;
    const children = filter.filters.map((child) => compileFilter(child, propertyById));
    const combined = filter.combinator === 'and' ? and(...children) : or(...children);
    return sql`(${combined})`;
  }
  const property = propertyById.get(filter.propertyId);
  // An unknown property does not filter the row out.
  if (!property) return sql`true`;
  const accessor = accessorFor(property);
  if (filter.operator === 'is_empty') return sql`(${accessor.empty})`;
  if (filter.operator === 'is_not_empty') return sql`(not ${accessor.empty})`;
  const test = accessor.test(filter.operator, filter.value);
  // An empty value passes only the negative operators, as `evaluateCondition` has it.
  if (emptyMatches(filter.operator, property.type)) {
    return sql`(${accessor.empty} or coalesce(${test ?? never}, false))`;
  }
  if (!test) return never;
  return sql`(not ${accessor.empty} and coalesce(${test}, false))`;
}

/**
 * The rows a view shows, and their order: `search` on the title, the view's
 * filter tree, then its sorts, ties left in the order the rows were created
 * (the id breaks a tie), as `listDatabaseRows` returns them.
 */
export function compileView(
  databaseId: string,
  view: { filters?: Filter | null; sorts?: readonly ViewSort[] | null; search?: string },
  propertyById: Map<string, DatabaseProperty>,
  /** Grouped, its rows come group by group (`groups.ts`), each in its view's order. */
  groupBy: GroupSpec | null = null,
): CompiledView {
  const conditions: SQL[] = [
    sql`${pages.databaseId} = ${databaseId}`,
    // Literals, not parameters, so the planner can use the partial index.
    sql`${pages.archived} = false`,
    sql`${pages.template} = false`,
  ];
  if (view.search) {
    conditions.push(
      sql`strpos(${lowered(sql`${pages.title}`)}, ${view.search.toLowerCase()}::text) > 0`,
    );
  }
  // Only a group filters, as in the JS path; an empty one passes every row.
  if (view.filters?.kind === 'group') conditions.push(compileFilter(view.filters, propertyById));
  const group = groupBy ? compileGroup(groupBy) : null;
  // A view shows the rows in a group it does not hide: one in several, in any.
  if (group?.shown) {
    conditions.push(
      group.lateral
        ? sql`exists (select 1 from ${group.lateral} where ${group.shown})`
        : group.shown,
    );
  }
  const keys: SortKey[] = [...(group?.keys ?? [])];
  for (const sort of view.sorts ?? []) {
    const property = propertyById.get(sort.propertyId);
    if (!property) continue;
    const { key } = accessorFor(property);
    keys.push({
      expr: key.kind === 'text' ? sql`(${key.expr}) collate nilo_sort` : key.expr,
      kind: key.kind,
      direction: sort.direction,
    });
  }
  return { where: and(...conditions) ?? sql`true`, keys, group };
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

/** `created_at` exactly, to the microsecond, for the cursor. */
const createdAtText = sql<string>`to_char(${pages.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const keyValueSchema = z.union([z.number().finite(), z.string(), z.null()]);
const instantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u)
  .refine((s) => {
    const parsed = new Date(s);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 23) === s.slice(0, 23);
  });
const entityIdSchema = z.string().refine(isLiveEntityId);

/**
 * Where the next page starts: after the last row's sort-key values, its
 * creation time and its id (`after`); after that row, its values read back
 * when the values were too long to carry (`row`); or, for a view sorted in
 * JS, after a number of rows (`offset`).
 */
const cursorSchema = z.union([
  z.object({ after: z.array(keyValueSchema), at: instantSchema, id: entityIdSchema }).strict(),
  // A row in several groups is in the one it was last read in (`group`).
  z.object({ row: entityIdSchema, group: z.string().max(200).nullable().optional() }).strict(),
  z.object({ offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict(),
]);

export type RowsCursor = z.infer<typeof cursorSchema>;

/** The longest cursor that carries its values; a longer one names its row instead. */
const MAX_VALUES_CURSOR = 1024;

/** The opaque `cursor` a client passes back: base64url JSON. */
export function encodeRowsCursor(cursor: RowsCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** A cursor from a client, or `null` when it is not one this API issued. */
export function decodeRowsCursor(raw: string): RowsCursor | null {
  if (!/^[A-Za-z0-9_-]{1,2048}$/u.test(raw)) return null;
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

interface Position {
  values: readonly (string | number | null)[];
  at: string;
  id: string;
}

/**
 * Rows after `position` in the view's order. Ascending, NULL sorts last, so
 * nothing follows a NULL but the next key; descending, it sorts first, so
 * every value follows it. `null` when the position does not fit the keys.
 */
function keysetAfter(keys: readonly SortKey[], position: Position): SQL | null {
  if (position.values.length !== keys.length) return null;
  const branches: SQL[] = [];
  const equal: SQL[] = [];
  for (const [i, key] of keys.entries()) {
    const value = position.values[i];
    if (value !== null && typeof value !== (key.kind === 'number' ? 'number' : 'string')) {
      return null;
    }
    const bound =
      value === null ? null : key.kind === 'number' ? sql`${value}::float8` : sql`${value}::text`;
    const beyond =
      key.direction === 'asc'
        ? bound && sql`(${key.expr} > ${bound} or ${key.expr} is null)`
        : bound
          ? sql`${key.expr} < ${bound}`
          : sql`${key.expr} is not null`;
    if (beyond) branches.push(sql`(${and(...equal, beyond)})`);
    equal.push(bound ? sql`${key.expr} = ${bound}` : sql`${key.expr} is null`);
  }
  const tail = sql`(${pages.createdAt}, ${pages.id}) > (${position.at}::timestamptz, ${position.id}::text)`;
  branches.push(sql`(${and(...equal, tail)})`);
  return sql`(${or(...branches)})`;
}

function keyColumns(keys: readonly SortKey[]): Record<string, SQL> {
  return Object.fromEntries(keys.map((key, i) => [`k${i}`, key.expr]));
}

function keyValues(
  row: Record<string, unknown>,
  keys: readonly SortKey[],
): (string | number | null)[] {
  return keys.map((_, i) => (row[`k${i}`] ?? null) as string | number | null);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface ViewRowsPage {
  rows: PageRow[];
  /** A grouped view's: the group of each row of `rows`, in turn (a row can be in several). */
  groupKeys: GroupKey[] | null;
  total: number;
  /** The next page's cursor; null on the last page. */
  cursor: string | null;
}

/**
 * One page of a compiled view, and how many rows the view has. `null` when
 * the cursor is not a position in this view (another view's, or an offset).
 */
export async function listViewRows(
  handle: PgHandle,
  databaseId: string,
  view: CompiledView,
  page: { size: number; cursor: RowsCursor | null },
): Promise<ViewRowsPage | null> {
  let after: SQL | undefined;
  if (page.cursor) {
    let position: Position | null = null;
    if ('after' in page.cursor) {
      position = { values: page.cursor.after, at: page.cursor.at, id: page.cursor.id };
    } else if ('row' in page.cursor) {
      const lateral = view.group?.lateral;
      const group = page.cursor.group ?? null;
      const query = handle
        .select({ ...keyColumns(view.keys), at: createdAtText })
        .from(pages)
        .$dynamic();
      const [row] = await (lateral ? query.crossJoinLateral(lateral) : query).where(
        and(
          eq(pages.id, page.cursor.row),
          eq(pages.databaseId, databaseId),
          lateral ? sql`${GROUP_KEY} is not distinct from ${group}::text` : undefined,
        ),
      );
      if (row) position = { values: keyValues(row, view.keys), at: row.at, id: page.cursor.row };
    }
    if (!position) return null;
    const predicate = keysetAfter(view.keys, position);
    if (!predicate) return null;
    after = predicate;
  }

  const order = [
    ...view.keys.map((key) =>
      key.direction === 'asc' ? sql`${key.expr} asc nulls last` : sql`${key.expr} desc nulls first`,
    ),
    asc(pages.createdAt),
    asc(pages.id),
  ];
  const group = view.group;
  const query = handle
    .select({
      page: pages,
      ...keyColumns(view.keys),
      at: createdAtText,
      groupKey: group ? sql<string | null>`${group.key}` : sql<null>`null`,
    })
    .from(pages)
    .$dynamic();
  const [found, [counted]] = await Promise.all([
    (group?.lateral ? query.crossJoinLateral(group.lateral) : query)
      .where(and(groupedWhere(view), after))
      .orderBy(...order)
      .limit(page.size + 1),
    // The rows, each once, whatever groups they are in.
    handle.select({ total: sql<number>`count(*)::int` }).from(pages).where(view.where),
  ]);

  const rows = found.slice(0, page.size);
  const last = rows.at(-1);
  let cursor: string | null = null;
  if (found.length > page.size && last) {
    const values: RowsCursor = { after: keyValues(last, view.keys), at: last.at, id: last.page.id };
    const encoded = encodeRowsCursor(values);
    cursor =
      encoded.length <= MAX_VALUES_CURSOR
        ? encoded
        : encodeRowsCursor(
            group?.lateral ? { row: last.page.id, group: last.groupKey } : { row: last.page.id },
          );
  }
  return {
    rows: rows.map((r) => r.page),
    groupKeys: group ? rows.map((r) => r.groupKey) : null,
    total: counted?.total ?? 0,
    cursor,
  };
}
