import type { Filter, FilterGroup } from './types/databases';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The filter a calendar or a timeline reads its rows with: those whose date
 * falls in `from`..`to`, or, with an end property, whose span meets it. A day
 * either side, so a date stored as UTC midnight is read in every time zone:
 * the view itself places each row on its days.
 */
export function visibleDatesFilter({
  startPropertyId,
  endPropertyId,
  from,
  to,
}: {
  startPropertyId: string;
  endPropertyId?: string | null;
  from: Date;
  to: Date;
}): FilterGroup {
  const after = new Date(from.getTime() - DAY_MS).toISOString();
  const before = new Date(to.getTime() + 2 * DAY_MS).toISOString();
  const condition = (propertyId: string, operator: string, value: string): Filter => ({
    kind: 'condition',
    propertyId,
    operator,
    value,
  });
  const startsIn = condition(startPropertyId, 'on_or_after', after);
  return {
    kind: 'group',
    combinator: 'and',
    filters: [
      condition(startPropertyId, 'before', before),
      endPropertyId
        ? {
            kind: 'group',
            combinator: 'or',
            filters: [startsIn, condition(endPropertyId, 'on_or_after', after)],
          }
        : startsIn,
    ],
  };
}
