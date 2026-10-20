import { CALCULATIONS_BY_TYPE } from '@oxy.so/nilo-contracts';
import { formatDateValue } from './date-values';
import { formatNumberValue } from './number-format';
import type { CalculationFunction, DatabaseProperty } from './types/databases';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** The calculations a column's footer offers: those its type takes (`CALCULATIONS_BY_TYPE`). */
export function calculationsFor(property: DatabaseProperty): readonly CalculationFunction[] {
  return CALCULATIONS_BY_TYPE[property.type];
}

/** What the footer writes: plurals and units come from the app's strings. */
export interface CalculationLabels {
  days: (count: number) => string;
  hours: (count: number) => string;
}

/**
 * A number computed over a property's values (a sum, an average, a chart's
 * measure): in the property's format when it is a number, rounded to two
 * places when that sets no precision; to two places for any other.
 */
export function formatComputedNumber(
  value: number,
  property: Pick<DatabaseProperty, 'type' | 'config'> | undefined,
  locale: string | undefined,
): string {
  if (property?.type !== 'number') {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  }
  const config =
    property.config?.precision === undefined && !Number.isInteger(value)
      ? { ...property.config, precision: 2 }
      : property.config;
  return formatNumberValue(value, config, locale);
}

/**
 * A calculation's value as the footer shows it: a count, a percentage, a
 * number in its property's format (an average or a median rounded to two
 * places when it has none), a date in its property's format, a span of days
 * or hours. A dash when there is nothing to compute it from.
 */
export function formatCalculation(
  fn: CalculationFunction,
  value: number | null,
  property: DatabaseProperty,
  locale: string | undefined,
  labels: CalculationLabels,
): string {
  if (value === null || !Number.isFinite(value)) return '—';
  switch (fn) {
    case 'percent_empty':
    case 'percent_not_empty':
    case 'percent_checked':
      return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
        value / 100,
      );
    case 'sum':
    case 'average':
    case 'median':
    case 'min':
    case 'max':
    case 'range':
      return formatComputedNumber(value, property, locale);
    case 'earliest':
    case 'latest': {
      const iso = new Date(value).toISOString();
      // A day is stored as its UTC midnight; anything else is an instant, read in the reader's zone.
      const includeTime = property.type !== 'date' || value % DAY_MS !== 0;
      return formatDateValue({ start: iso, includeTime }, locale, property.config?.dateFormat);
    }
    case 'date_range':
      return value >= DAY_MS || value === 0
        ? labels.days(Math.round(value / DAY_MS))
        : labels.hours(Math.round(value / HOUR_MS));
    default:
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  }
}
