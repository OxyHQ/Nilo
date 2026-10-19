/**
 * A view's footer calculations (`config.calculations`): what each property
 * comes to over every row the view shows — not only the page loaded — as
 * Notion's table footer computes it.
 *
 * Stored properties are computed in PostgreSQL (`calculationsInSql`), one
 * aggregate per calculation over the view's compiled filter; formulas and
 * rollups, which are computed per row in JS, and every calculation of a view
 * whose filter reads one, are computed here over the rows themselves
 * (`calculate`), which is also the reference the SQL is held to
 * (`view-query.pgdb.test.ts`).
 *
 * A value is a number: a count, a percentage (0–100), a sum or an average of
 * numbers, an instant (milliseconds since the epoch) for the earliest or the
 * latest date, a duration in milliseconds for a date range. `null` when there
 * is nothing to compute it from: no rows for a percentage, no numbers or dates.
 */
import { type CalculationFunction, acceptsCalculation } from '@oxy.so/nilo-contracts';
import { type SQL, sql } from 'drizzle-orm';
import type { PgHandle } from '../../db/client.js';
import type { DatabaseProperty } from '../../db/schema/databases.js';
import { pages } from '../../db/schema/pages.js';
import { isEmpty, readPropertyValue, valueType } from './filters.js';
import { storedDateMs } from './groups.js';
import { accessorFor, type CompiledView } from './view-query.js';

export type CalculationValue = number | null;

type Row = Parameters<typeof readPropertyValue>[0];

/** The list each list type holds, and how a value of it is told apart from another. */
const LISTS: Partial<
  Record<DatabaseProperty['type'], 'optionIds' | 'userIds' | 'pageIds' | 'files'>
> = {
  multi_select: 'optionIds',
  person: 'userIds',
  relation: 'pageIds',
  files: 'files',
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

/** A list's values as `count_unique` tells them apart: strings, a file by its name. */
function listTokens(value: unknown, field: string): string[] {
  const list = asObject(value)?.[field];
  if (!Array.isArray(list)) return [];
  return list.flatMap((x) => {
    const token = field === 'files' ? asObject(x)?.name : x;
    return typeof token === 'string' ? [token] : [];
  });
}

/** A JSON scalar as PostgreSQL's `#>> '{}'` writes a string or an integer. */
function scalarToken(x: unknown): string | null {
  if (typeof x === 'string') return x;
  if (typeof x === 'number' && Number.isInteger(x)) return String(x);
  return x === null || x === undefined ? null : JSON.stringify(x);
}

/** What `count_unique` tells apart of a single value that is not empty. */
function uniqueToken(property: DatabaseProperty, row: Row, value: unknown): string | number | null {
  const v = asObject(value);
  switch (property.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      if (property.id === 'name' && property.type === 'text') return row.title ?? '';
      return scalarToken(v?.text ?? v?.value);
    case 'number':
    case 'unique_id':
      return typeof v?.number === 'number' ? v.number : null;
    case 'select':
    case 'status':
      return scalarToken(v?.optionId);
    case 'date': {
      const ms = storedDateMs(v?.start);
      return Number.isFinite(ms) ? ms : null;
    }
    case 'created_time':
    case 'last_edited_time': {
      const ms = Date.parse(String(v?.start));
      return Number.isFinite(ms) ? ms : null;
    }
    case 'created_by':
    case 'last_edited_by': {
      const id = (v?.userIds as unknown[] | undefined)?.[0];
      return typeof id === 'string' && id !== '' ? id : null;
    }
    default:
      return null;
  }
}

/** The number a value holds (a number, an ID, a formula's or a rollup's number). */
function numberOf(value: unknown): number | null {
  const n = asObject(value)?.number;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** The instant a date holds, as a view sorts it. */
function instantOf(property: DatabaseProperty, value: unknown): number | null {
  const start = asObject(value)?.start;
  const ms = property.type === 'date' ? storedDateMs(start) : Date.parse(String(start));
  return Number.isFinite(ms) ? ms : null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

const percent = (part: number, total: number) => (total === 0 ? null : (part / total) * 100);

/** `fn` over `property` of `rows` (computed values already merged into their properties). */
export function calculate(
  fn: CalculationFunction,
  property: DatabaseProperty,
  rows: readonly Row[],
): CalculationValue {
  const total = rows.length;
  const values = rows.map((row) => readPropertyValue(row, property));
  const empties = values.filter((value) => isEmpty(value, valueType(property, value))).length;
  const list = LISTS[property.type];
  const numbers = () => values.flatMap((v) => numberOf(v) ?? []);
  const instants = () => values.flatMap((v) => instantOf(property, v) ?? []);
  const checked = () => values.filter((v) => truthy(asObject(v)?.checked)).length;
  switch (fn) {
    case 'count_all':
      return total;
    case 'count_empty':
      return empties;
    case 'count_not_empty':
      return total - empties;
    case 'percent_empty':
      return percent(empties, total);
    case 'percent_not_empty':
      return percent(total - empties, total);
    case 'count_values':
      return list
        ? values.reduce<number>((sum, v) => {
            const items = asObject(v)?.[list];
            return sum + (Array.isArray(items) ? items.length : 0);
          }, 0)
        : total - empties;
    case 'count_unique': {
      if (list) return new Set(values.flatMap((v) => listTokens(v, list))).size;
      const tokens = new Set<string | number>();
      rows.forEach((row, i) => {
        const value = values[i];
        if (isEmpty(value, valueType(property, value))) return;
        const token = uniqueToken(property, row, value);
        if (token !== null) tokens.add(token);
      });
      return tokens.size;
    }
    case 'sum':
      return numbers().reduce((a, b) => a + b, 0);
    case 'average': {
      const ns = numbers();
      return ns.length === 0 ? null : ns.reduce((a, b) => a + b, 0) / ns.length;
    }
    case 'median':
      return median(numbers());
    case 'min': {
      const ns = numbers();
      return ns.length === 0 ? null : Math.min(...ns);
    }
    case 'max': {
      const ns = numbers();
      return ns.length === 0 ? null : Math.max(...ns);
    }
    case 'range': {
      const ns = numbers();
      return ns.length === 0 ? null : Math.max(...ns) - Math.min(...ns);
    }
    case 'earliest': {
      const ms = instants();
      return ms.length === 0 ? null : Math.min(...ms);
    }
    case 'latest': {
      const ms = instants();
      return ms.length === 0 ? null : Math.max(...ms);
    }
    case 'date_range': {
      const ms = instants();
      return ms.length === 0 ? null : Math.max(...ms) - Math.min(...ms);
    }
    case 'checked':
      return checked();
    case 'unchecked':
      return total - checked();
    case 'percent_checked':
      return percent(checked(), total);
  }
}

function truthy(x: unknown): boolean {
  if (typeof x === 'string') return x !== '';
  if (typeof x === 'number') return x !== 0;
  if (typeof x === 'boolean') return x;
  return typeof x === 'object' && x !== null;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/** Whether `calculationsInSql` can compute `property`: a stored one, not a formula or a rollup. */
export function calculableInSql(property: DatabaseProperty): boolean {
  return property.type !== 'formula' && property.type !== 'rollup';
}

/** The aggregate a calculation is in SQL, over the view's rows (or one per list value, `lateral`). */
function aggregate(
  fn: CalculationFunction,
  property: DatabaseProperty,
): { value: SQL; lateral?: SQL; percentOf?: true } {
  const accessor = accessorFor(property);
  const stored = sql`(${pages.properties} -> ${property.id}::text)`;
  const list = LISTS[property.type];
  const field = list ? sql`${stored} -> ${list}::text` : null;
  // Numbers and instants are what a sort reads of them: `float8`, NULL for none.
  const scalar = accessor.key.expr;
  switch (fn) {
    case 'count_all':
      return { value: sql`count(*)` };
    case 'count_empty':
      return { value: sql`count(*) filter (where ${accessor.empty})` };
    case 'count_not_empty':
      return { value: sql`count(*) filter (where not ${accessor.empty})` };
    case 'percent_empty':
      return { value: sql`count(*) filter (where ${accessor.empty})`, percentOf: true };
    case 'percent_not_empty':
      return { value: sql`count(*) filter (where not ${accessor.empty})`, percentOf: true };
    case 'count_values':
      return field
        ? {
            value: sql`coalesce(sum(case when jsonb_typeof(${field}) = 'array' then jsonb_array_length(${field}) else 0 end), 0)`,
          }
        : { value: sql`count(*) filter (where not ${accessor.empty})` };
    case 'count_unique': {
      if (field) {
        const token =
          list === 'files'
            ? sql`(case when jsonb_typeof(nilo_value.v -> 'name') = 'string' then nilo_value.v ->> 'name' end)`
            : sql`(case when jsonb_typeof(nilo_value.v) = 'string' then nilo_value.v #>> '{}' end)`;
        return {
          value: sql`count(distinct ${token})`,
          lateral: sql`cross join lateral jsonb_array_elements(case when jsonb_typeof(${field}) = 'array' then ${field} else '[]'::jsonb end) as nilo_value(v)`,
        };
      }
      return {
        value: sql`count(distinct ${uniqueSql(property, stored)}) filter (where not ${accessor.empty})`,
      };
    }
    case 'sum':
      return { value: sql`coalesce(sum(${scalar}), 0)` };
    case 'average':
      return { value: sql`avg(${scalar})` };
    case 'median':
      return { value: sql`percentile_cont(0.5) within group (order by ${scalar})` };
    case 'min':
    case 'earliest':
      return { value: sql`min(${scalar})` };
    case 'max':
    case 'latest':
      return { value: sql`max(${scalar})` };
    case 'range':
    case 'date_range':
      return { value: sql`max(${scalar}) - min(${scalar})` };
    case 'checked':
      return { value: sql`count(*) filter (where ${scalar} = 1)` };
    case 'unchecked':
      return { value: sql`count(*) filter (where ${scalar} is distinct from 1)` };
    case 'percent_checked':
      return { value: sql`count(*) filter (where ${scalar} = 1)`, percentOf: true };
  }
}

/** What `count_unique` tells apart of a single value, as `uniqueToken`. */
function uniqueSql(property: DatabaseProperty, stored: SQL): SQL {
  switch (property.type) {
    case 'select':
    case 'status':
      return sql`(${stored} -> 'optionId' #>> '{}')`;
    case 'created_by':
    case 'last_edited_by':
      return sql`(${accessorFor(property).key.expr})::text`;
    default:
      // Text, numbers and instants: the value a sort reads.
      return accessorFor(property).key.expr;
  }
}

/**
 * Each of `calculations` over the rows of `view`, in PostgreSQL. Every
 * property must be `calculableInSql`, and every function one its type takes.
 */
export async function calculationsInSql(
  handle: PgHandle,
  view: CompiledView,
  calculations: readonly { property: DatabaseProperty; fn: CalculationFunction }[],
): Promise<CalculationValue[]> {
  return Promise.all(
    calculations.map(async ({ property, fn }) => {
      if (!acceptsCalculation(property.type, fn)) return null;
      const { value, lateral, percentOf } = aggregate(fn, property);
      const [row] = await handle.execute<{ v: number | string | null; n: number | string }>(
        sql`select (${value})::float8 as v, count(distinct ${pages.id})::int as n
          from ${pages} ${lateral ?? sql``} where ${view.where}`,
      );
      const raw = row?.v ?? null;
      const v = raw === null ? null : Number(raw);
      if (!percentOf) return v;
      return percent(v ?? 0, Number(row?.n ?? 0));
    }),
  );
}
