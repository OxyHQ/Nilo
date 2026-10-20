import * as React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { DatabaseProperty, DateGroupGranularity, GroupRange } from '@/lib/types/databases';
import { dateGroupLabel, formatBound } from '@/lib/view-groups';

/**
 * How a group's key reads as text: an option's name, a date's day or month,
 * a range of numbers, a text, a person.
 */
export function useGroupLabel(
  property: DatabaseProperty,
  granularity?: DateGroupGranularity,
): (key: string | null, range?: GroupRange) => string {
  const { t, locale } = useTranslation();
  return React.useCallback(
    (key: string | null, range?: GroupRange) => {
      if (property.type === 'checkbox') {
        return t(key === 'true' ? 'databases.board.checked' : 'databases.board.unchecked');
      }
      if (key === null) return t('databases.groups.none', { name: property.name });
      if (range) {
        if (range.from === null && range.to !== null) {
          return t('databases.groups.below', { to: formatBound(range.to, locale) });
        }
        if (range.to === null && range.from !== null) {
          return t('databases.groups.above', { from: formatBound(range.from, locale) });
        }
        if (range.from !== null && range.to !== null) {
          return t('databases.groups.range', {
            from: formatBound(range.from, locale),
            to: formatBound(range.to, locale),
          });
        }
      }
      switch (property.type) {
        case 'select':
        case 'status':
        case 'multi_select':
          return property.config?.options?.find((o) => o.id === key)?.name ?? key;
        case 'date':
        case 'created_time':
        case 'last_edited_time':
          return dateGroupLabel(key, granularity, locale, (date) =>
            t('databases.groups.weekOf', { date }),
          );
        default:
          return key;
      }
    },
    [property, granularity, t, locale],
  );
}
