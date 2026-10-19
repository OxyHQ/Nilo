import type { DateValue, PropertyValue } from '@/lib/types/databases';

/**
 * A date property's value is a start, an optional end and whether it has a
 * time. Without a time an instant names a day: midnight UTC of it, the day
 * a date filter compares (`filters.ts`) whatever the reader's time zone. With
 * a time it is the instant itself, shown and edited in the reader's zone.
 */
export interface DateParts {
  start: string | null;
  end: string | null;
  includeTime: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

function validIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

export function readDateValue(v: PropertyValue): DateParts {
  const was = v && typeof v === 'object' && 'start' in v ? (v as DateValue) : null;
  return {
    start: validIso(was?.start),
    end: validIso(was?.end),
    includeTime: was?.includeTime === true,
  };
}

/** The day `iso` falls on, as a local-midnight `Date` (what a calendar picks and shows). */
export function dayOf(iso: string, includeTime: boolean): Date {
  const d = new Date(iso);
  return includeTime
    ? new Date(d.getFullYear(), d.getMonth(), d.getDate())
    : new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** `HH:mm` of `iso` in the reader's zone, the shape Bloom's `TimeField` takes. */
export function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The instant stored for `day` (local midnight) at `time` (`HH:mm`), or the day alone. */
export function instantOf(day: Date, time: string | null): string {
  if (time === null) {
    return new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate())).toISOString();
  }
  const [h, m] = time.split(':').map(Number);
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Number.isFinite(h) ? h : 0,
    Number.isFinite(m) ? m : 0,
  ).toISOString();
}

/** `v` on other days, each keeping the time of day it had. */
export function withDays(v: PropertyValue, start: Date | null, end: Date | null): DateParts {
  const was = readDateValue(v);
  if (start === null) return { start: null, end: null, includeTime: false };
  const time = (iso: string | null) => (was.includeTime && iso ? timeOf(iso) : null);
  const at = (day: Date, iso: string | null) =>
    instantOf(day, was.includeTime ? (time(iso) ?? time(was.start) ?? '00:00') : null);
  return {
    start: at(start, was.start),
    end: end ? at(end, was.end) : null,
    includeTime: was.includeTime,
  };
}

/** With an end (on the start's day, as a range picked of one day), or without one. */
export function withEnd(v: PropertyValue, on: boolean): DateParts {
  const was = readDateValue(v);
  return { ...was, end: on ? (was.end ?? was.start) : null };
}

/**
 * With a time (midnight of the days it had), or back to the days alone. The
 * days stay those the reader saw.
 */
export function withTime(v: PropertyValue, include: boolean): DateParts {
  const was = readDateValue(v);
  if (include === was.includeTime) return was;
  const convert = (iso: string | null) =>
    iso ? instantOf(dayOf(iso, was.includeTime), include ? '00:00' : null) : null;
  return { start: convert(was.start), end: convert(was.end), includeTime: include };
}

/** The start's or the end's time of day set to `time` (`HH:mm`). */
export function withTimeOf(v: PropertyValue, which: 'start' | 'end', time: string): DateParts {
  const was = readDateValue(v);
  const iso = was[which];
  if (!iso || !was.includeTime) return was;
  return { ...was, [which]: instantOf(dayOf(iso, true), time) };
}

/**
 * `v` (a date) starting on the day `start` names (midnight UTC). Its end and
 * whether it has a time are kept, and so is the start's time of day.
 */
export function withStart(v: PropertyValue, start: string | null): PropertyValue {
  if (start === null) return { start: null, end: null, includeTime: false };
  const was = readDateValue(v);
  if (!was.start) return { start, end: null, includeTime: false };
  return {
    start: was.includeTime ? instantOf(dayOf(start, false), timeOf(was.start)) : start,
    end: was.end,
    includeTime: was.includeTime,
  };
}

/** `Oct 5, 2026`, `Oct 5, 2026 14:30`, `Oct 5, 2026 → Oct 9, 2026`; empty for no date. */
export function formatDateValue(v: PropertyValue, locale?: string): string {
  const { start, end, includeTime } = readDateValue(v);
  if (!start) return '';
  const one = (iso: string) => {
    const day = dayOf(iso, includeTime).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    return includeTime ? `${day} ${timeOf(iso)}` : day;
  };
  return end ? `${one(start)} → ${one(end)}` : one(start);
}
