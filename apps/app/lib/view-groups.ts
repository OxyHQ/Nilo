import { isGroupableType } from '@oxy.so/nilo-contracts';
import type {
  DatabaseProperty,
  DatabaseRow,
  DateGroupGranularity,
  PropertyValue,
  RowGroup,
  ViewGroupBy,
} from './types/databases';

/** A group of a grouped view as it is shown: its key, how many rows it holds, those loaded. */
export interface RowSection {
  key: string | null;
  count: number;
  rows: DatabaseRow[];
}

/**
 * The sections a grouped view shows, in the API's order of its groups
 * (`groups`), each with the loaded rows listed in it. The rows come group by
 * group, so while more are to load, the groups after the last one any loaded
 * row is in are left for later — none shows up empty only to fill in. With
 * `hideEmpty`, a group no row is in is not shown.
 */
export function rowSections(
  rows: readonly DatabaseRow[],
  groups: readonly RowGroup[],
  options: { hideEmpty?: boolean; complete: boolean },
): RowSection[] {
  const byKey = new Map<string | null, DatabaseRow[]>();
  for (const row of rows) {
    const key = row.groupKey ?? null;
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  let reached = -1;
  groups.forEach((group, i) => {
    if (byKey.has(group.key)) reached = i;
  });
  return groups
    .filter((_group, i) => options.complete || i <= reached)
    .filter((group) => !options.hideEmpty || group.count > 0)
    .map((group) => ({ key: group.key, count: group.count, rows: byKey.get(group.key) ?? [] }));
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
 * the label or person, checked or not, the group's first day, the text.
 * Undefined for the empty group and for what no write sets (a creator).
 */
export function groupValue(
  property: DatabaseProperty,
  key: string | null,
): PropertyValue | undefined {
  if (property.type === 'checkbox') return { checked: key === 'true' };
  if (key === null) return undefined;
  switch (property.type) {
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
