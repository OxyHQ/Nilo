import type { PropertyConfig } from '@/lib/types/databases';

/**
 * A number property's value as its `format` and `precision` show it: plain,
 * with thousands separators, a percentage (0.5 → 50%) or an amount of a
 * currency. `precision` is the digits after the point, exactly; absent, a
 * plain number shows as it is and the rest with up to two.
 */
export function formatNumberValue(
  value: number | null,
  config: Pick<PropertyConfig, 'format' | 'precision'> | undefined,
  locale?: string,
): string {
  if (value === null || !Number.isFinite(value)) return '';
  const format = config?.format ?? 'number';
  const precision = config?.precision;
  const digits =
    precision === undefined
      ? { maximumFractionDigits: 2 }
      : { minimumFractionDigits: precision, maximumFractionDigits: precision };
  try {
    if (format === 'number') {
      return precision === undefined ? String(value) : value.toFixed(precision);
    }
    if (format === 'number_with_commas') {
      return new Intl.NumberFormat(locale, {
        useGrouping: true,
        ...(precision === undefined ? { maximumFractionDigits: 20 } : digits),
      }).format(value);
    }
    if (format === 'percent') {
      return new Intl.NumberFormat(locale, { style: 'percent', ...digits }).format(value);
    }
    if (format.startsWith('currency:')) {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: format.slice('currency:'.length),
        ...(precision === undefined ? {} : digits),
      }).format(value);
    }
  } catch {
    // An engine without the locale or currency: the number as it is.
  }
  return String(value);
}
