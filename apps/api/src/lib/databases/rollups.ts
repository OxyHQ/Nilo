import type { PgHandle } from '../../db/client.js';
import type { DatabaseProperty, DatabaseSchema } from '../../db/schema/databases.js';
import type { PageProperties } from '../../db/schema/pages.js';
import { findDatabaseById } from '../../repositories/databases.js';
import { findPagesByIds } from '../../repositories/pages.js';

/**
 * Rollup values for rows of one database.
 *
 * Behaviour:
 *   - one-way relations only (we do not propagate two-way back-refs yet)
 *   - functions: count | sum | avg | min | max | earliest | latest
 *   - target property must be a number (for sum/avg/min/max) or a date
 *     (for earliest/latest); other shapes give `null`.
 *
 * `null` when a rollup cannot be resolved (missing config, missing target
 * database…) so the UI can render an em-dash placeholder.
 *
 * Batched: per rollup property, the related rows of every row are read in one
 * query and the target database once — a view of a thousand rows used to read
 * them row by row. This module is NOT one of the pure `lib/databases/*`
 * evaluators: it reads, so it takes a handle like any repository caller.
 */
export type RollupValue = number | string | null;

type RowLike = { id: string; properties: PageProperties };

/** The page ids a row's relation value points at. */
function relatedIds(row: RowLike, relationPropertyId: string): string[] | null {
  const value = row.properties[relationPropertyId] ?? null;
  if (!value || typeof value !== 'object') return null;
  const pageIds = (value as { pageIds?: unknown }).pageIds;
  if (!Array.isArray(pageIds)) return null;
  /**
   * No 24-hex filter: it kept a malformed string out of `new ObjectId(...)`,
   * and a uuid v7 does not match it — it would empty this list for every row
   * created since the port. An id that names nothing simply finds no row.
   */
  return pageIds.filter((id): id is string => typeof id === 'string');
}

function computeRollup(
  fn: string,
  target: DatabaseProperty,
  related: readonly { properties: PageProperties }[],
): RollupValue {
  if (related.length === 0) return null;
  const numbers: number[] = [];
  const dates: number[] = [];
  for (const r of related) {
    const value = r.properties[target.id] ?? null;
    if (!value || typeof value !== 'object') continue;
    const obj = value as Record<string, unknown>;
    if (typeof obj.number === 'number' && Number.isFinite(obj.number)) numbers.push(obj.number);
    if (typeof obj.start === 'string') {
      const t = Date.parse(obj.start);
      if (Number.isFinite(t)) dates.push(t);
    }
  }
  switch (fn) {
    case 'sum':
      return numbers.reduce((acc, n) => acc + n, 0);
    case 'avg':
      return numbers.length > 0 ? numbers.reduce((acc, n) => acc + n, 0) / numbers.length : null;
    case 'min':
      return numbers.length > 0 ? Math.min(...numbers) : null;
    case 'max':
      return numbers.length > 0 ? Math.max(...numbers) : null;
    case 'earliest':
      return dates.length > 0 ? new Date(Math.min(...dates)).toISOString() : null;
    case 'latest':
      return dates.length > 0 ? new Date(Math.max(...dates)).toISOString() : null;
    default:
      return null;
  }
}

/** Every rollup of `schema` for every row: row id → property id → value. */
export async function resolveRollups(
  handle: PgHandle,
  schema: DatabaseSchema,
  rows: readonly RowLike[],
): Promise<Map<string, Map<string, RollupValue>>> {
  const out = new Map<string, Map<string, RollupValue>>(rows.map((r) => [r.id, new Map()]));
  for (const property of schema.properties) {
    if (property.type !== 'rollup') continue;
    const config = property.config;
    const set = (rowId: string, value: RollupValue) => out.get(rowId)?.set(property.id, value);
    if (!config?.relationPropertyId || !config.function || !config.targetPropertyId) {
      for (const row of rows) set(row.id, null);
      continue;
    }
    const idsByRow = new Map(
      rows.map((r) => [r.id, relatedIds(r, config.relationPropertyId as string)]),
    );
    if (config.function === 'count') {
      for (const row of rows) {
        const ids = idsByRow.get(row.id);
        set(row.id, ids === null || ids === undefined ? null : ids.length);
      }
      continue;
    }
    const wanted = [...new Set([...idsByRow.values()].flatMap((ids) => ids ?? []))];
    const related =
      wanted.length > 0 ? await findPagesByIds(handle, wanted, { archived: false }) : [];
    const byId = new Map(related.map((r) => [r.id, r]));
    // The related rows' database (one relation points into one database).
    const targetDbId = related[0]?.databaseId;
    const targetDb = targetDbId ? await findDatabaseById(handle, targetDbId) : null;
    const target = targetDb?.propertiesSchema.properties.find(
      (p) => p.id === config.targetPropertyId,
    );
    for (const row of rows) {
      const ids = idsByRow.get(row.id) ?? [];
      const rowRelated = ids.flatMap((id) => {
        const found = byId.get(id);
        return found && found.databaseId === targetDbId ? [found] : [];
      });
      set(row.id, target ? computeRollup(config.function, target, rowRelated) : null);
    }
  }
  return out;
}
