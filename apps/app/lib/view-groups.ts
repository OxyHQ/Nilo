import { isGroupableType, MAX_NUMBER_GROUPS, numberGroupCount } from '@oxy.so/nilo-contracts';
import type {
  DatabaseProperty,
  DatabaseRow,
  DatabaseView,
  DateGroupGranularity,
  GroupRange,
  PropertyValue,
  RowGroup,
  ViewConfig,
  ViewGroupBy,
  ViewGroupKey,
  ViewNumberGrouping,
} from './types/databases';

/** A group of a grouped view as it is shown: its key, how many rows it holds, those loaded. */
export interface RowSection {
  key: string | null;
  count: number;
  rows: DatabaseRow[];
  /** A number range's bounds. */
  range?: GroupRange;
}

/**
 * The sections a grouped view shows, in the API's order of its groups
 * (`groups`), each with the loaded rows listed in it. The rows come group by
 * group, so while more are to load, the groups after the last one any loaded
 * row is in are left for later — none shows up empty only to fill in. With
 * `hideEmpty`, a group no row is in is not shown. The view's own order
 * (`groupOrder`) and hidden groups (`hiddenGroups`), which the API reads the
 * rows by, apply at once, while a change to them is saved.
 */
export function rowSections(
  rows: readonly DatabaseRow[],
  groups: readonly RowGroup[],
  options: {
    hideEmpty?: boolean;
    complete: boolean;
    order?: readonly ViewGroupKey[];
    hidden?: readonly ViewGroupKey[];
  },
): RowSection[] {
  const byKey = new Map<string | null, DatabaseRow[]>();
  for (const row of rows) {
    const key = row.groupKey ?? null;
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  const hidden = new Set(options.hidden ?? []);
  const shown = orderGroups(groups, options.order ?? []).filter((group) => !hidden.has(group.key));
  let reached = -1;
  shown.forEach((group, i) => {
    if (byKey.has(group.key)) reached = i;
  });
  return shown
    .filter((_group, i) => options.complete || i <= reached)
    .filter((group) => !options.hideEmpty || group.count > 0)
    .map((group) => ({
      key: group.key,
      count: group.count,
      rows: byKey.get(group.key) ?? [],
      ...(group.range && { range: group.range }),
    }));
}

/** `groups` with those `order` lists first, in its order; the others after, as they came. */
export function orderGroups<G extends { key: ViewGroupKey }>(
  groups: readonly G[],
  order: readonly ViewGroupKey[],
): G[] {
  if (order.length === 0) return [...groups];
  const at = (key: ViewGroupKey) => {
    const i = order.indexOf(key);
    return i < 0 ? order.length : i;
  };
  return groups
    .map((group, i) => ({ group, i }))
    .sort((a, b) => at(a.group.key) - at(b.group.key) || a.i - b.i)
    .map(({ group }) => group);
}

/** The sections' order once `key` moved up (-1) or down (1) among them; null when it cannot. */
export function moveGroup(
  keys: readonly ViewGroupKey[],
  key: ViewGroupKey,
  by: -1 | 1,
): ViewGroupKey[] | null {
  const from = keys.indexOf(key);
  const to = from + by;
  if (from < 0 || to < 0 || to >= keys.length) return null;
  const next = [...keys];
  next.splice(from, 1);
  next.splice(to, 0, key);
  return next;
}

/** The sections' order once `key` is dropped on `onto`: where it was, `onto` moving aside. */
export function placeGroup(
  keys: readonly ViewGroupKey[],
  key: ViewGroupKey,
  onto: ViewGroupKey,
): ViewGroupKey[] | null {
  const from = keys.indexOf(key);
  const to = keys.indexOf(onto);
  if (from < 0 || to < 0 || from === to) return null;
  const next = keys.filter((k) => k !== key);
  next.splice(to, 0, key);
  return next;
}

/** What of a view's config the groups of its rows are shown by: their order, those hidden. */
export function sectionOptions(view: DatabaseView): {
  order?: ViewGroupKey[];
  hidden?: ViewGroupKey[];
} {
  return { order: view.config?.groupOrder, hidden: view.config?.hiddenGroups };
}

/**
 * Whether a row added in a group can be given the group's value: not a
 * creator or an editor, nor a computed value.
 */
export function groupTakesRows(property: DatabaseProperty): boolean {
  return !['created_by', 'last_edited_by', 'formula', 'rollup'].includes(property.type);
}

/**
 * The ranges a view's numbers are grouped in, read back from its groups
 * (`range`): what the API chose when the view sets none. Undefined when the
 * groups are no ranges.
 */
export function numberGroupingOf(groups: readonly RowGroup[]): ViewNumberGrouping | undefined {
  const ranged = groups.filter(
    (g): g is RowGroup & { key: string; range: { from: number; to: number } } =>
      g.key !== null && Number(g.key) >= 0 && g.range?.from != null && g.range?.to != null,
  );
  const first = ranged.find((g) => g.key === '0');
  if (!first) return undefined;
  const last = ranged.reduce((a, b) => (Number(b.key) > Number(a.key) ? b : a), first);
  const step = Number((first.range.to - first.range.from).toPrecision(12));
  return { from: first.range.from, to: last.range.to, step };
}

/**
 * A range group's bounds under `grouping`, as the API gives them: its key is
 * its index, `-1` below `from` and the count of ranges from `to` up.
 */
export function numberRangeOf(key: string, grouping: ViewNumberGrouping): GroupRange {
  const count = Math.min(MAX_NUMBER_GROUPS, Math.max(1, numberGroupCount(grouping)));
  const i = Number(key);
  if (i < 0) return { from: null, to: grouping.from };
  if (i >= count) return { from: grouping.to, to: null };
  const from = grouping.from + i * grouping.step;
  return { from, to: Math.min(grouping.to, from + grouping.step) };
}

/** The config keys that name a view's groups: they go when it is grouped otherwise. */
const GROUP_KEYS = ['numberGrouping', 'groupOrder', 'collapsedGroups', 'hiddenGroups'] as const;

/** `config` without the keys of its groups, or null when it has none. */
export function withoutGroupKeys(config: ViewConfig): ViewConfig | null {
  if (!GROUP_KEYS.some((key) => key in config)) return null;
  const out: ViewConfig = { ...config };
  for (const key of GROUP_KEYS) delete out[key];
  return out;
}

/** A range's bound as it reads: the float noise of adding steps up rounded off. */
export function formatBound(n: number, locale: string | undefined): string {
  return Number(n.toPrecision(12)).toLocaleString(locale, { maximumFractionDigits: 10 });
}

/** The property a view groups by, when it is one that groups. */
export function groupProperty(
  properties: readonly DatabaseProperty[],
  groupBy: ViewGroupBy | null | undefined,
): DatabaseProperty | null {
  if (!groupBy) return null;
  const property = properties.find((p) => p.id === groupBy.propertyId);
  return property && isGroupableType(property.type) ? property : null;
}

/** The local day a date group's key (`YYYY-MM-DD`) names. */
export function groupDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** How a date group reads: its day, the week starting on it, its month or its year. */
export function dateGroupLabel(
  key: string,
  granularity: DateGroupGranularity | undefined,
  locale: string | undefined,
  weekOf: (date: string) => string,
): string {
  const day = groupDay(key);
  switch (granularity) {
    case 'year':
      return String(day.getFullYear());
    case 'month':
      return day.toLocaleDateString(locale, { year: 'numeric', month: 'long' });
    case 'week':
      return weekOf(
        day.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
      );
    default:
      return day.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  }
}

/**
 * The value a row added in a group gets, so it is listed there: the option,
 * the label or person, checked or not, the group's first day, the text, the
 * number its range starts at. Undefined for the empty group and for what no
 * write sets (a creator, a formula).
 */
export function groupValue(
  property: DatabaseProperty,
  key: string | null,
  range?: GroupRange,
): PropertyValue | undefined {
  if (property.type === 'checkbox') return { checked: key === 'true' };
  if (key === null) return undefined;
  switch (property.type) {
    case 'number':
      return range?.from === null || range?.from === undefined ? undefined : { number: range.from };
    case 'select':
    case 'status':
      return { optionId: key };
    case 'multi_select':
      return { optionIds: [key] };
    case 'person':
      return { userIds: [key] };
    case 'date':
      return { start: `${key}T00:00:00.000Z`, end: null, includeTime: false };
    case 'text':
      return property.id === 'name' ? undefined : { text: key };
    case 'url':
    case 'email':
    case 'phone':
      return { value: key };
    default:
      return undefined;
  }
}
