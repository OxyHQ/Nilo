/**
 * A view's groups: the sections of a table, a list, a gallery or a timeline
 * (`groupBy`), a board's sub-groups (`subGroupBy`), a chart's points. Each row
 * falls in the group of its value — an option, a person, the day, week, month
 * or year of a date (in the reader's time zone when it has a time), a text,
 * checked or not, the range a number is in — or in the empty group (`null`)
 * when it has none. A multi-select or a person property with several values
 * puts its row in each of their groups.
 *
 * This is the JS reference: `view-query.ts` groups the same rows in SQL with
 * the same keys and order, and `view-query.pgdb.test.ts` holds the two to each
 * other. The groups come in a fixed order — options as listed (a status's in
 * the order of its groups), checked before unchecked, dates oldest first,
 * numbers' ranges lowest first, text and people in `compareText`'s order — the
 * empty group last; the groups a view lists first (`config.groupOrder`) come
 * before the others, and those it hides (`config.hiddenGroups`) not at all.
 */
import {
  type DateGroupGranularity,
  groupKind,
  type NumberRanges,
  numberGroupRange,
  numberRanges,
  SECTIONED_VIEWS,
} from '@oxy.so/nilo-contracts';
import type {
  DatabaseProperty,
  DatabaseViewType,
  ViewConfig,
  ViewGroupBy,
} from '../../db/schema/databases.js';
import { readPropertyValue } from './filters.js';
import { asObject, numberOf, truthy } from './json-values.js';
import { normalizeStatusGroups } from './schema-defaults.js';
import { compareText } from './sorts.js';

/** What a view groups by, resolved against its schema. */
export interface GroupSpec {
  property: DatabaseProperty;
  granularity: DateGroupGranularity;
  /** The IANA zone a date with a time is grouped in. */
  timeZone: string;
  /** A number's ranges; set for a number, a formula or a rollup. */
  numbers?: NumberRanges;
  /** The groups that come first, in this order (`config.groupOrder`). */
  order?: readonly GroupKey[];
  /** The groups left out, and their rows (`config.hiddenGroups`). */
  hidden?: readonly GroupKey[];
}

/** A group's key: an option or user id, `YYYY-MM-DD`, a text, `true`/`false`, a range's index; null for the empty group. */
export type GroupKey = string | null;

export interface GroupSummary {
  key: GroupKey;
  /** The rows in it (a row with several values counts in each of their groups). */
  count: number;
  /** A number range's bounds: from (included) to (excluded), open below or above. */
  range?: { from: number | null; to: number | null };
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
 * What a view's rows are grouped by: a table's, a list's or a gallery's
 * sections, a timeline's swimlanes, a board's sub-groups (its columns are its
 * own, grouped as it shows them). A calendar does not group, nor a form; a
 * chart's axis is its own (`config.chart`). What `config`'s group keys
 * (`groupOrder`, `collapsedGroups`, `hiddenGroups`, `numberGrouping`) are of.
 */
export function rowGrouping(
  view: {
    type: DatabaseViewType;
    groupBy?: ViewGroupBy | null;
    subGroupBy?: ViewGroupBy | null;
  } | null,
): ViewGroupBy | null {
  if (!view) return null;
  if (view.type === 'board') return view.subGroupBy ?? null;
  if (SECTIONED_VIEWS.has(view.type)) return view.groupBy ?? null;
  return null;
}

/** What of a view's config shapes the groups of its rows. */
export type GroupSections = Pick<ViewConfig, 'numberGrouping' | 'groupOrder' | 'hiddenGroups'>;

/** The smallest and largest number of a property in the database's rows, null for none. */
export interface NumberBounds {
  min: number | null;
  max: number | null;
}

const NO_BOUNDS: NumberBounds = { min: null, max: null };

/**
 * What `groupBy` groups by in `properties`, or null when the view is not
 * grouped by anything this schema can group: no grouping, a property gone,
 * or one of a type that has no groups. Its sections (`config`) order and
 * hide groups and set a number's ranges; without ranges, a number is grouped
 * over the bounds `readBounds` reads, which only such a number calls (in SQL
 * that is a query, so the spec is then awaited).
 */
export function resolveGroupSpec(
  groupBy: ViewGroupBy | null | undefined,
  propertyById: ReadonlyMap<string, DatabaseProperty>,
  timeZone?: string,
  sections?: GroupSections,
  readBounds?: (property: DatabaseProperty) => NumberBounds,
): GroupSpec | null;
export function resolveGroupSpec(
  groupBy: ViewGroupBy | null | undefined,
  propertyById: ReadonlyMap<string, DatabaseProperty>,
  timeZone: string,
  sections: GroupSections | undefined,
  readBounds: (property: DatabaseProperty) => Promise<NumberBounds>,
): GroupSpec | null | Promise<GroupSpec | null>;
export function resolveGroupSpec(
  groupBy: ViewGroupBy | null | undefined,
  propertyById: ReadonlyMap<string, DatabaseProperty>,
  timeZone = 'UTC',
  sections: GroupSections = {},
  readBounds?: (property: DatabaseProperty) => NumberBounds | Promise<NumberBounds>,
): GroupSpec | null | Promise<GroupSpec | null> {
  if (!groupBy) return null;
  const property = propertyById.get(groupBy.propertyId);
  const kind = property ? groupKind(property.type) : null;
  if (!property || !kind) return null;
  const spec = (numbers?: NumberRanges): GroupSpec => ({
    property,
    granularity: groupBy.granularity ?? 'day',
    timeZone,
    ...(numbers && { numbers }),
    ...(sections.groupOrder?.length && { order: sections.groupOrder }),
    ...(sections.hiddenGroups?.length && { hidden: sections.hiddenGroups }),
  });
  if (kind !== 'number') return spec();
  if (sections.numberGrouping) return spec(numberRanges(sections.numberGrouping));
  const bounds = readBounds?.(property) ?? NO_BOUNDS;
  return bounds instanceof Promise
    ? bounds.then((read) => spec(defaultNumberRanges(read)))
    : spec(defaultNumberRanges(bounds));
}

// ---------------------------------------------------------------------------
// Number ranges
// ---------------------------------------------------------------------------

/** 1, 2 or 5 times a power of ten: the smallest one at least `x`. */
function roundStep(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const power = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 2, 5]) if (m * power >= x) return m * power;
  return 10 * power;
}

/**
 * The ranges of a view that sets none: about ten of a round size, from a
 * multiple of it at or below the smallest number to one above the largest.
 */
export function defaultNumberRanges({ min, max }: NumberBounds): NumberRanges {
  if (min === null || max === null) return { from: 0, to: 100, step: 10, count: 10 };
  const span = max - min;
  const step = roundStep(span > 0 ? span / 10 : Math.max(Math.abs(min), 1) / 10);
  let from = Math.floor(min / step) * step;
  if (from > min) from -= step;
  let to = (Math.floor(max / step) + 1) * step;
  if (to <= max) to += step;
  return numberRanges({ from, to, step });
}

/** The group of `n`: its range's index, `-1` below them, `count` from `to` up. */
export function numberGroupKey(n: number, ranges: NumberRanges): string {
  if (n < ranges.from) return '-1';
  if (n >= ranges.to) return String(ranges.count);
  return String(Math.min(ranges.count - 1, Math.floor((n - ranges.from) / ranges.step)));
}

/** The smallest and largest number `property` holds in `rows` (computed values merged in). */
export function numberBounds(rows: readonly Row[], property: DatabaseProperty): NumberBounds {
  let min: number | null = null;
  let max: number | null = null;
  for (const row of rows) {
    const n = numberOf(readPropertyValue(row, property));
    if (n === null) continue;
    if (min === null || n < min) min = n;
    if (max === null || n > max) max = n;
  }
  return { min, max };
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

/** The groups a row is in: one for most properties, each of its values' for a multi-valued one. */
export function rowGroupKeys(row: Row, spec: GroupSpec): GroupKey[] {
  const { property } = spec;
  const raw = readPropertyValue(row, property);
  const value = asObject(raw);
  switch (groupKind(property.type)) {
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
    case 'number': {
      const n = numberOf(raw);
      return [n === null || !spec.numbers ? null : numberGroupKey(n, spec.numbers)];
    }
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

/**
 * The order of a view's groups: those it lists first (`order`) in that
 * order, then the others in their property's order, the empty one last.
 */
export function compareGroupKeys(spec: GroupSpec): (a: GroupKey, b: GroupKey) => number {
  const natural = naturalOrder(spec);
  const order = spec.order ?? [];
  if (order.length === 0) return natural;
  const at = (key: GroupKey) => {
    const i = order.indexOf(key);
    return i < 0 ? order.length : i;
  };
  return (a, b) => at(a) - at(b) || natural(a, b);
}

/** Whether a view shows the group of `key`: it is not one it hides. */
export function isShownGroup(spec: GroupSpec, key: GroupKey): boolean {
  return !(spec.hidden ?? []).includes(key);
}

/** The order of a group property's groups, the empty one last. */
function naturalOrder(spec: GroupSpec): (a: GroupKey, b: GroupKey) => number {
  const kind = groupKind(spec.property.type);
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
    if (kind === 'number') return Number(a) - Number(b);
    // Texts and people: as a sort orders them, then strings it cannot tell apart by their bytes.
    return compareText(a, b) || compareBytes(a, b);
  };
}

/**
 * Each row once per group it is in, in the order of the groups, and within a
 * group in the order the rows came (their view's sort); none in a group the
 * view hides.
 */
export function groupRows<R extends Row>(
  rows: readonly R[],
  spec: GroupSpec,
): { row: R; key: GroupKey }[] {
  const compare = compareGroupKeys(spec);
  const entries = rows.flatMap((row, index) =>
    rowGroupKeys(row, spec)
      .filter((key) => isShownGroup(spec, key))
      .map((key) => ({ row, key, index })),
  );
  entries.sort((a, b) => compare(a.key, b.key) || a.index - b.index);
  return entries.map(({ row, key }) => ({ row, key }));
}

/**
 * The view's groups, in order, with their rows' count: every option of an
 * option property (and checked and unchecked, and each range of numbers)
 * even when no row holds it, the other groups as the rows have them, the
 * empty group when a row is in it — but none the view hides.
 */
export function summarizeGroups(
  counts: ReadonlyMap<GroupKey, number>,
  spec: GroupSpec,
): GroupSummary[] {
  const kind = groupKind(spec.property.type);
  const keys = new Set<GroupKey>(counts.keys());
  if (kind === 'option' || kind === 'list_option') {
    for (const id of orderedOptionIds(spec.property)) keys.add(id);
  }
  if (kind === 'checkbox') {
    keys.add('true');
    keys.add('false');
  }
  const numbers = kind === 'number' ? spec.numbers : undefined;
  if (numbers) for (let i = 0; i < numbers.count; i += 1) keys.add(String(i));
  return [...keys]
    .filter((key) => isShownGroup(spec, key))
    .sort(compareGroupKeys(spec))
    .map((key) => ({
      key,
      count: counts.get(key) ?? 0,
      ...(numbers && key !== null && { range: numberGroupRange(key, numbers) }),
    }));
}

/** The rows a view grouped by `spec` shows: each in some group it does not hide. */
export function shownRows<R extends Row>(rows: readonly R[], spec: GroupSpec | null): R[] {
  if (!spec?.hidden?.length) return [...rows];
  return rows.filter((row) => rowGroupKeys(row, spec).some((key) => isShownGroup(spec, key)));
}

/** How many of `entries` each group holds. */
export function countGroups(entries: readonly { key: GroupKey }[]): Map<GroupKey, number> {
  const counts = new Map<GroupKey, number>();
  for (const { key } of entries) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}
