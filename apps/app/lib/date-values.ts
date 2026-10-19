import type { DateValue, PropertyValue } from '@/lib/types/databases';

/**
 * `v` (a date) starting at `start`. Its end and whether it has a time are
 * kept, and so is the start's time of day when only the day was picked.
 */
export function withStart(v: PropertyValue, start: string | null): PropertyValue {
  if (start === null) return { start: null, end: null, includeTime: false };
  const was = v && typeof v === 'object' && 'start' in v ? (v as DateValue) : null;
  if (!was) return { start, end: null, includeTime: false };
  let next = start;
  if (was.includeTime && typeof was.start === 'string') {
    const day = new Date(start);
    const time = new Date(was.start);
    day.setUTCHours(time.getUTCHours(), time.getUTCMinutes(), time.getUTCSeconds(), 0);
    next = day.toISOString();
  }
  return { start: next, end: was.end ?? null, includeTime: was.includeTime ?? false };
}
