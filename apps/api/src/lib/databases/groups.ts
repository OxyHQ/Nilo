/**
 * A view's groups: the sections of a table or a list (`groupBy`), a board's
 * sub-groups (`subGroupBy`), a chart's points. Each row falls in the group of
 * its value — an option, a person, the day, week, month or year of a date
 * (in the reader's time zone when it has a time), a text, checked or not —
 * or in the empty group (`null`) when it has none. A multi-select or a person
 * property with several values puts its row in each of their groups.
 *
 * This is the JS reference: `view-query.ts` groups the same rows in SQL with
 * the same keys and order, and `view-query.pgdb.test.ts` holds the two to each
 * other. The groups come in a fixed order — options as listed (a status's in
 * the order of its groups), checked before unchecked, dates oldest first,
 * text and people in `compareText`'s order — the empty group last.
 */
import { type DateGroupGranularity, isGroupableType } from '@oxy.so/nilo-contracts';
import type { DatabaseProperty, ViewGroupBy } from '../../db/schema/databases.js';
import { readPropertyValue } from './filters.js';
import { normalizeStatusGroups } from './schema-defaults.js';
import { compareText } from './sorts.js';

/** What a view groups by, resolved against its schema. */
export interface GroupSpec {
  property: DatabaseProperty;
  granularity: DateGroupGranularity;
  /** The IANA zone a date with a time is grouped in. */
  timeZone: string;
}

/** A group's key: an option or user id, `YYYY-MM-DD`, a text, `true`/`false`; null for the empty group. */
export type GroupKey = string | null;

export interface GroupSummary {
  key: GroupKey;
  /** The rows in it (a row with several values counts in each of their groups). */
  count: number;
}

/** How a group property is grouped: by option, by date, by text or user id, or checked. */
export type GroupKind = 'option' | 'list_option' | 'date' | 'text' | 'people' | 'user' | 'checkbox';

export function groupKind(property: DatabaseProperty): GroupKind | null {
  if (!isGroupableType(property.type)) return null;
  switch (property.type) {
    case 'select':
    case 'status':
      return 'option';
    case 'multi_select':
      return 'list_option';
    case 'person':
      return 'people';
    case 'created_by':
    case 'last_edited_by':
      return 'user';
    case 'checkbox':
      return 'checkbox';
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return 'date';
    default:
      return 'text';
  }
}

/** Whether `timeZone` is a zone this server knows (`Intl`), as `?timeZone=` must name. */
export function isTimeZone(timeZone: string): boolean {
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/u.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * What `groupBy` groups by in `properties`, or null when the view is not
 * grouped by anything this schema can group: no grouping, a property gone,
 * or one of a type that has no groups.
 */
export function resolveGroupSpec(
  groupBy: ViewGroupBy | null | undefined,
  propertyById: ReadonlyMap<string, DatabaseProperty>,
  timeZone = 'UTC',
): GroupSpec | null {
  if (!groupBy) return null;
  const property = propertyById.get(groupBy.propertyId);
  if (!property || !groupKind(property)) return null;
  return { property, granularity: groupBy.granularity ?? 'day', timeZone };
}

/** A select's options in the order they are listed; a status's in the order of its groups. */
export function orderedOptionIds(property: DatabaseProperty): string[] {
  const options = property.config?.options ?? [];
  if (property.type !== 'status') return options.map((o) => o.id);
  return normalizeStatusGroups(options, property.config?.groups).flatMap((g) => g.optionIds);
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * `new Date(start).getTime()` for the forms `view-query.ts`' `dateMs` reads:
 * an ISO instant with its offset, or a day; NaN, which no group holds, for
 * anything else.
 */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/u;
export function storedDateMs(start: unknown): number {
  if (typeof start !== 'string') return Number.NaN;
  if (ISO_DAY.test(start)) return validDay(start) ? Date.parse(`${start}T00:00:00Z`) : Number.NaN;
  if (!ISO_INSTANT.test(start)) return Number.NaN;
  return validDay(start.slice(0, 10)) ? Date.parse(start) : Number.NaN;
}

/** A calendar day that exists (PostgreSQL refuses the 31st of April; JavaScript rolls it over). */
function validDay(day: string): boolean {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();
function localDay(ms: number, timeZone: string): [number, number, number] {
  let format = zoneFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hourCycle: 'h23',
    });
    zoneFormats.set(timeZone, format);
  }
  const parts = format.formatToParts(new Date(ms));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // `formatToParts` writes a year before 1 BCE as its era's; none is stored.
  return [part('year'), part('month'), part('day')];
}

/**
 * The first day of the group of `ms` (`YYYY-MM-DD`): of its day, its week
 * from Monday, its month or its year, on the calendar of `timeZone` for an
 * instant, of UTC for a day (which names the day itself).
 */
export function dateGroupKey(
  ms: number,
  includeTime: boolean,
  granularity: DateGroupGranularity,
  timeZone: string,
): string | null {
  if (!Number.isFinite(ms)) return null;
  let [y, m, d] = includeTime
    ? localDay(ms, timeZone)
    : (() => {
        const date = new Date(ms);
        return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()] as const;
      })();
  if (granularity === 'week') {
    const day = new Date(Date.UTC(y, m - 1, d));
    const monday = new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
    [y, m, d] = [monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate()];
  } else if (granularity === 'month') {
    d = 1;
  } else if (granularity === 'year') {
    [m, d] = [1, 1];
  }
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

type Row = Parameters<typeof readPropertyValue>[0];

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

/** The groups a row is in: one for most properties, each of its values' for a multi-valued one. */
export function rowGroupKeys(row: Row, spec: GroupSpec): GroupKey[] {
  const { property } = spec;
  const raw = readPropertyValue(row, property);
  const value = asObject(raw);
  switch (groupKind(property)) {
    case 'option': {
      const id = value?.optionId;
      return [typeof id === 'string' && orderedOptionIds(property).includes(id) ? id : null];
    }
    case 'list_option': {
      const listed = new Set(orderedOptionIds(property));
      const list = Array.isArray(value?.optionIds) ? (value.optionIds as unknown[]) : [];
      const ids = [
        ...new Set(list.filter((x): x is string => typeof x === 'string' && listed.has(x))),
      ];
      return ids.length > 0 ? ids : [null];
    }
    case 'people': {
      const list = Array.isArray(value?.userIds) ? (value.userIds as unknown[]) : [];
      const ids = [...new Set(list.filter((x): x is string => typeof x === 'string'))];
      return ids.length > 0 ? ids : [null];
    }
    case 'user': {
      const ids = (value?.userIds as unknown[] | undefined) ?? [];
      const id = ids[0];
      return [typeof id === 'string' && id !== '' ? id : null];
    }
    case 'checkbox':
      return [truthy(value?.checked) ? 'true' : 'false'];
    case 'date': {
      if (!value) return [null];
      const instant = property.type !== 'date';
      return [
        dateGroupKey(
          instant ? Date.parse(String(value.start)) : storedDateMs(value.start),
          instant || truthy(value.includeTime),
          spec.granularity,
          spec.timeZone,
        ),
      ];
    }
    case 'text': {
      if (property.id === 'name' && property.type === 'text') return [row.title ? row.title : null];
      if (!value || (!truthy(value.text) && !truthy(value.value))) return [null];
      const text = value.text ?? value.value;
      return [jsonText(text)];
    }
    default:
      return [null];
  }
}

/** JavaScript truthiness, as `view-query.ts`' `truthy` reads a JSON value. */
function truthy(x: unknown): boolean {
  if (typeof x === 'string') return x !== '';
  if (typeof x === 'number') return x !== 0;
  if (typeof x === 'boolean') return x;
  return typeof x === 'object' && x !== null;
}

/** A JSON scalar as PostgreSQL's `#>> '{}'` writes it. */
function jsonText(x: unknown): string | null {
  if (x === null || x === undefined) return null;
  if (typeof x === 'string') return x;
  return JSON.stringify(x);
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

/** Two strings in byte order (UTF-16 here, which orders as UTF-8 does for these keys). */
function compareBytes(a: string, b: string): number {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return Buffer.compare(x, y);
}

/** The order of a group property's groups, the empty one last. */
export function compareGroupKeys(spec: GroupSpec): (a: GroupKey, b: GroupKey) => number {
  const kind = groupKind(spec.property);
  const position =
    kind === 'option' || kind === 'list_option'
      ? new Map(orderedOptionIds(spec.property).map((id, i) => [id, i]))
      : null;
  return (a, b) => {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    if (position) return (position.get(a) ?? 0) - (position.get(b) ?? 0);
    if (kind === 'checkbox') return a === 'true' ? -1 : 1;
    if (kind === 'date') return a < b ? -1 : 1;
    // Texts and people: as a sort orders them, then strings it cannot tell apart by their bytes.
    return compareText(a, b) || compareBytes(a, b);
  };
}

/**
 * Each row once per group it is in, in the order of the groups, and within a
 * group in the order the rows came (their view's sort).
 */
export function groupRows<R extends Row>(
  rows: readonly R[],
  spec: GroupSpec,
): { row: R; key: GroupKey }[] {
  const compare = compareGroupKeys(spec);
  const entries = rows.flatMap((row, index) =>
    rowGroupKeys(row, spec).map((key) => ({ row, key, index })),
  );
  entries.sort((a, b) => compare(a.key, b.key) || a.index - b.index);
  return entries.map(({ row, key }) => ({ row, key }));
}

/**
 * The view's groups, in order, with their rows' count: every option of an
 * option property (and checked and unchecked) even when no row holds it, the
 * other groups as the rows have them, the empty group when a row is in it.
 */
export function summarizeGroups(
  counts: ReadonlyMap<GroupKey, number>,
  spec: GroupSpec,
): GroupSummary[] {
  const kind = groupKind(spec.property);
  const keys = new Set<GroupKey>(counts.keys());
  if (kind === 'option' || kind === 'list_option') {
    for (const id of orderedOptionIds(spec.property)) keys.add(id);
  }
  if (kind === 'checkbox') {
    keys.add('true');
    keys.add('false');
  }
  return [...keys]
    .sort(compareGroupKeys(spec))
    .map((key) => ({ key, count: counts.get(key) ?? 0 }));
}

/** How many of `entries` each group holds. */
export function countGroups(entries: readonly { key: GroupKey }[]): Map<GroupKey, number> {
  const counts = new Map<GroupKey, number>();
  for (const { key } of entries) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}
