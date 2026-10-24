/**
 * Wall-clock time in an IANA time zone, with `Intl` only: what a day means for
 * an all-day event in the reader's zone, and the local time a repeating event
 * keeps across daylight-saving changes.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface WallTime {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();

function formatFor(timeZone: string): Intl.DateTimeFormat {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formats.set(timeZone, format);
  }
  return format;
}

/** The wall-clock time `ms` shows in `timeZone`. */
export function wallTimeOf(ms: number, timeZone: string): WallTime {
  const parts: Record<string, number> = {};
  for (const part of formatFor(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
    millisecond: ((ms % 1000) + 1000) % 1000,
  };
}

const asUtc = (t: WallTime) =>
  Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second, t.millisecond);

/** How far `timeZone` is ahead of UTC at `ms`, in milliseconds. */
function offsetAt(ms: number, timeZone: string): number {
  return asUtc(wallTimeOf(ms, timeZone)) - ms;
}

/**
 * The instant `wall` names in `timeZone`. A time that happens twice (the
 * hour clocks go back) is its first occurrence; a time that never happens
 * (the hour clocks skip) is read with the offset before the change, so 02:30
 * becomes 03:30, as iCalendar does.
 */
export function instantOf(wall: WallTime, timeZone: string): number {
  const guess = asUtc(wall);
  const offsets = [
    ...new Set([offsetAt(guess - DAY_MS / 2, timeZone), offsetAt(guess + DAY_MS / 2, timeZone)]),
  ];
  const valid = offsets
    .map((offset) => guess - offset)
    .filter((candidate) => offsetAt(candidate, timeZone) === guess - candidate);
  if (valid.length > 0) return Math.min(...valid);
  return guess - Math.min(...offsets);
}

/** Whether `timeZone` is a zone this server knows. */
export function isTimeZone(timeZone: string): boolean {
  try {
    formatFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** A day as days since 1970-01-01 (UTC): what all-day events are compared in. */
export type DayNumber = number;

export function dayNumberOfIso(day: string): DayNumber {
  return Math.floor(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

export function isoOfDayNumber(day: DayNumber): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** The day `ms` falls on in `timeZone`. */
export function localDayNumber(ms: number, timeZone: string): DayNumber {
  const wall = wallTimeOf(ms, timeZone);
  return Math.floor(Date.UTC(wall.year, wall.month - 1, wall.day) / DAY_MS);
}

/** The instant a day starts in `timeZone`. */
export function startOfLocalDay(day: DayNumber, timeZone: string): number {
  const date = new Date(day * DAY_MS);
  return instantOf(
    {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    },
    timeZone,
  );
}
