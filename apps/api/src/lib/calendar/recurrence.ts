/**
 * Repeating events: the subset of iCalendar's RRULE (RFC 5545 §3.3.10) Nilo
 * stores in an event's repeat property and expands when events are read.
 *
 * Supported: FREQ (DAILY, WEEKLY, MONTHLY, YEARLY), INTERVAL, COUNT or UNTIL,
 * BYDAY (weekdays for WEEKLY; weekdays with an optional ordinal, `1MO`,
 * `-1FR`, for MONTHLY), BYMONTHDAY (MONTHLY), and WKST=MO. Anything else is
 * refused when written and, on import, the event keeps its first occurrence.
 *
 * A timed series keeps its wall-clock time in the reader's zone: a meeting at
 * 09:00 stays at 09:00 across a change to summer time. An all-day series
 * repeats days.
 */
import {
  DAY_MS,
  type DayNumber,
  dayNumberOfIso,
  instantOf,
  isoOfDayNumber,
  localDayNumber,
  wallTimeOf,
} from './zoned-time.js';

export const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

/** Monday 0 … Sunday 6. */
export type Weekday = number;

export interface WeekdayRule {
  weekday: Weekday;
  /** The nth such weekday of the month (negative from its end); null for every one. */
  ordinal: number | null;
}

export interface RepeatRule {
  freq: Frequency;
  interval: number;
  count: number | null;
  /** The last occurrence may start on this day (a date UNTIL) or at this instant. */
  until: { day: DayNumber } | { instant: number } | null;
  byDay: WeekdayRule[];
  byMonthDay: number[];
}

export const MAX_INTERVAL = 1000;
export const MAX_COUNT = 10_000;
/** The most periods (days, weeks, months, years) one expansion walks. */
const MAX_PERIODS = 100_000;

export class RepeatRuleError extends Error {}

function parseUntil(value: string): RepeatRule['until'] {
  const day = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (day) {
    const iso = `${day[1]}-${day[2]}-${day[3]}`;
    const number = dayNumberOfIso(iso);
    if (Number.isNaN(number) || isoOfDayNumber(number) !== iso) {
      throw new RepeatRuleError('UNTIL is not a date');
    }
    return { day: number };
  }
  const instant = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (instant) {
    const [, y, mo, d, h, mi, s] = instant.map(Number);
    const ms = Date.UTC(y as number, (mo as number) - 1, d, h, mi, s);
    if (Number.isNaN(ms)) throw new RepeatRuleError('UNTIL is not a date');
    return { instant: ms };
  }
  throw new RepeatRuleError('UNTIL must be a date (YYYYMMDD) or a UTC time (YYYYMMDDTHHMMSSZ)');
}

function positiveInt(value: string, name: string, max: number): number {
  if (!/^\d+$/.test(value)) throw new RepeatRuleError(`${name} must be a positive integer`);
  const n = Number(value);
  if (n < 1 || n > max) throw new RepeatRuleError(`${name} must be between 1 and ${max}`);
  return n;
}

/**
 * The rule `raw` spells (an `RRULE:` prefix is allowed), or a `RepeatRuleError`
 * saying what Nilo does not support.
 */
export function parseRepeatRule(raw: string): RepeatRule {
  const text = raw.trim().replace(/^RRULE:/i, '');
  if (text === '') throw new RepeatRuleError('The repeat rule is empty');
  const parts = new Map<string, string>();
  for (const part of text.split(';')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    if (eq <= 0) throw new RepeatRuleError(`"${part}" is not KEY=VALUE`);
    const key = part.slice(0, eq).toUpperCase();
    if (parts.has(key)) throw new RepeatRuleError(`${key} is given twice`);
    parts.set(key, part.slice(eq + 1).toUpperCase());
  }
  const supported = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'WKST']);
  for (const key of parts.keys()) {
    if (!supported.has(key)) throw new RepeatRuleError(`${key} is not supported`);
  }
  const freq = parts.get('FREQ');
  if (!freq || !(FREQUENCIES as readonly string[]).includes(freq)) {
    throw new RepeatRuleError('FREQ must be DAILY, WEEKLY, MONTHLY or YEARLY');
  }
  const wkst = parts.get('WKST');
  if (wkst !== undefined && wkst !== 'MO') throw new RepeatRuleError('Only WKST=MO is supported');
  if (parts.has('COUNT') && parts.has('UNTIL')) {
    throw new RepeatRuleError('COUNT and UNTIL cannot both be given');
  }
  const rule: RepeatRule = {
    freq: freq as Frequency,
    interval: parts.has('INTERVAL')
      ? positiveInt(parts.get('INTERVAL') as string, 'INTERVAL', MAX_INTERVAL)
      : 1,
    count: parts.has('COUNT')
      ? positiveInt(parts.get('COUNT') as string, 'COUNT', MAX_COUNT)
      : null,
    until: parts.has('UNTIL') ? parseUntil(parts.get('UNTIL') as string) : null,
    byDay: [],
    byMonthDay: [],
  };
  const byDay = parts.get('BYDAY');
  if (byDay !== undefined) {
    if (rule.freq !== 'WEEKLY' && rule.freq !== 'MONTHLY') {
      throw new RepeatRuleError('BYDAY is supported with WEEKLY and MONTHLY only');
    }
    for (const item of byDay.split(',')) {
      const match = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(item);
      if (!match) throw new RepeatRuleError(`BYDAY "${item}" is not a weekday`);
      const ordinal = match[1] === undefined ? null : Number(match[1]);
      if (ordinal !== null && (rule.freq !== 'MONTHLY' || ordinal === 0 || Math.abs(ordinal) > 5)) {
        throw new RepeatRuleError(`BYDAY "${item}" is not supported`);
      }
      rule.byDay.push({
        weekday: WEEKDAYS.indexOf(match[2] as (typeof WEEKDAYS)[number]),
        ordinal,
      });
    }
  }
  const byMonthDay = parts.get('BYMONTHDAY');
  if (byMonthDay !== undefined) {
    if (rule.freq !== 'MONTHLY') {
      throw new RepeatRuleError('BYMONTHDAY is supported with MONTHLY only');
    }
    if (rule.byDay.length > 0) {
      throw new RepeatRuleError('BYDAY and BYMONTHDAY cannot both be given');
    }
    for (const item of byMonthDay.split(',')) {
      if (!/^[+-]?\d{1,2}$/.test(item))
        throw new RepeatRuleError(`BYMONTHDAY "${item}" is not a day`);
      const day = Number(item);
      if (day === 0 || Math.abs(day) > 31)
        throw new RepeatRuleError(`BYMONTHDAY "${item}" is not a day`);
      rule.byMonthDay.push(day);
    }
  }
  return rule;
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0');

/** The rule written back the one way Nilo stores it. */
export function formatRepeatRule(rule: RepeatRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay.length > 0) {
    parts.push(
      `BYDAY=${rule.byDay
        .map((d) => `${d.ordinal === null ? '' : d.ordinal}${WEEKDAYS[d.weekday]}`)
        .join(',')}`,
    );
  }
  if (rule.byMonthDay.length > 0) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
  if (rule.count !== null) parts.push(`COUNT=${rule.count}`);
  if (rule.until) {
    if ('day' in rule.until) {
      parts.push(`UNTIL=${isoOfDayNumber(rule.until.day).replaceAll('-', '')}`);
    } else {
      const d = new Date(rule.until.instant);
      parts.push(
        `UNTIL=${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(
          d.getUTCHours(),
        )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`,
      );
    }
  }
  return parts.join(';');
}

/** `raw` checked and written the way Nilo stores it; throws `RepeatRuleError`. */
export function normalizeRepeatRule(raw: string): string {
  return formatRepeatRule(parseRepeatRule(raw));
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

/** Monday 0 … Sunday 6 of a day (1970-01-01 was a Thursday). */
export const weekdayOf = (day: DayNumber): Weekday => (((day + 3) % 7) + 7) % 7;

const dayOf = (year: number, month: number, date: number): DayNumber =>
  Math.floor(Date.UTC(year, month - 1, date) / DAY_MS);

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function ymdOf(day: DayNumber): { year: number; month: number; date: number } {
  const d = new Date(day * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, date: d.getUTCDate() };
}

/** The days of period `k` that the rule picks, ascending, any before `first` included. */
function periodDays(rule: RepeatRule, first: DayNumber, k: number): DayNumber[] {
  const step = k * rule.interval;
  const base = ymdOf(first);
  switch (rule.freq) {
    case 'DAILY':
      return [first + step];
    case 'WEEKLY': {
      const monday = first - weekdayOf(first) + 7 * step;
      const weekdays =
        rule.byDay.length > 0 ? rule.byDay.map((d) => d.weekday) : [weekdayOf(first)];
      return [...new Set(weekdays)].sort((a, b) => a - b).map((w) => monday + w);
    }
    case 'MONTHLY': {
      const monthIndex = base.year * 12 + (base.month - 1) + step;
      const year = Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      const length = daysInMonth(year, month);
      const days: DayNumber[] = [];
      if (rule.byDay.length > 0) {
        const firstOfMonth = dayOf(year, month, 1);
        for (const { weekday, ordinal } of rule.byDay) {
          const firstMatch = firstOfMonth + ((weekday - weekdayOf(firstOfMonth) + 7) % 7);
          const matches: DayNumber[] = [];
          for (let d = firstMatch; d < firstOfMonth + length; d += 7) matches.push(d);
          if (ordinal === null) days.push(...matches);
          else {
            const pick = ordinal > 0 ? matches[ordinal - 1] : matches[matches.length + ordinal];
            if (pick !== undefined) days.push(pick);
          }
        }
      } else {
        const dates = rule.byMonthDay.length > 0 ? rule.byMonthDay : [base.date];
        for (const date of dates) {
          const resolved = date > 0 ? date : length + date + 1;
          if (resolved >= 1 && resolved <= length) days.push(dayOf(year, month, resolved));
        }
      }
      return [...new Set(days)].sort((a, b) => a - b);
    }
    case 'YEARLY': {
      const year = base.year + step;
      return base.date <= daysInMonth(year, base.month) ? [dayOf(year, base.month, base.date)] : [];
    }
  }
}

/** The first period worth walking for a window starting on `windowFirstDay`. */
function firstUsefulPeriod(rule: RepeatRule, first: DayNumber, windowFirstDay: DayNumber): number {
  if (rule.count !== null || windowFirstDay <= first) return 0;
  const behind = windowFirstDay - first;
  const periodDays =
    rule.freq === 'DAILY' ? 1 : rule.freq === 'WEEKLY' ? 7 : rule.freq === 'MONTHLY' ? 31 : 366;
  return Math.max(0, Math.floor(behind / (periodDays * rule.interval)) - 1);
}

/** A repeating event as stored: its first occurrence and its length. */
export interface Series {
  rule: RepeatRule;
  allDay: boolean;
  /** All-day: the first day. Timed: the first start, ms since the epoch. */
  start: number;
  /** All-day: the number of days (at least 1). Timed: milliseconds (0 for no end). */
  length: number;
}

/** What is being read: instants for timed events, days for all-day ones. */
export interface Window {
  fromMs: number;
  toMs: number;
  firstDay: DayNumber;
  /** Exclusive. */
  endDay: DayNumber;
  timeZone: string;
}

/**
 * The starts (days for an all-day series, ms for a timed one) of the series'
 * occurrences overlapping the window, ascending, at most `max` of those
 * `accept` takes (a page's cursor leaves out the ones already read).
 */
export function expandSeries(
  series: Series,
  window: Window,
  max: number,
  accept: (start: number) => boolean = () => true,
): number[] {
  const { rule } = series;
  const out: number[] = [];
  const wall = series.allDay ? null : wallTimeOf(series.start, window.timeZone);
  const first = series.allDay ? series.start : localDayNumber(series.start, window.timeZone);
  const lengthDays = series.allDay ? series.length : Math.ceil(series.length / DAY_MS) + 1;
  const windowFirstDay = series.allDay
    ? window.firstDay
    : localDayNumber(window.fromMs, window.timeZone);
  let seen = 0;
  const startK = firstUsefulPeriod(rule, first, windowFirstDay - lengthDays);
  for (let k = startK; k < startK + MAX_PERIODS; k += 1) {
    for (const day of periodDays(rule, first, k)) {
      if (day < first) continue;
      seen += 1;
      if (rule.count !== null && seen > rule.count) return out;
      const start = wall ? instantOf({ ...wall, ...splitDay(day) }, window.timeZone) : day;
      if (rule.until) {
        const beyond =
          'day' in rule.until
            ? day > rule.until.day
            : series.allDay
              ? day > Math.floor(rule.until.instant / DAY_MS)
              : start > rule.until.instant;
        if (beyond) return out;
      }
      if (series.allDay) {
        if (day >= window.endDay) return out;
        if (day + series.length > window.firstDay && accept(day)) out.push(day);
      } else {
        if (start >= window.toMs) return out;
        const overlaps = start + series.length > window.fromMs || start >= window.fromMs;
        if (overlaps && accept(start)) out.push(start);
      }
      if (out.length >= max) return out;
    }
  }
  return out;
}

function splitDay(day: DayNumber): { year: number; month: number; day: number } {
  const { year, month, date } = ymdOf(day);
  return { year, month, day: date };
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

/** The most exceptions a series keeps: the latest ones, when a feed lists more. */
export const MAX_EXCEPTIONS = 1500;

/**
 * How far an exception may sit from the occurrence it removes. A timed series
 * keeps its wall-clock time in the reader's zone, which can put an occurrence
 * an hour or two from the instant the feed named (a zone with other summer-time
 * dates than the event's); occurrences are at least a day apart, so six hours
 * cannot reach the next one.
 */
const EXCEPTION_REACH_MS = 6 * 60 * 60 * 1000;

/** A series' exceptions: the occurrences it does not have (RFC 5545 EXDATE). */
export interface SeriesExceptions {
  days: ReadonlySet<DayNumber>;
  /** Ascending. */
  instants: readonly number[];
}

/** Exceptions as stored: `YYYY-MM-DD` days and ISO instants, comma-separated, ascending. */
export function formatExceptions(tokens: readonly string[]): string {
  const valid = tokens.filter(
    (t) => (/^\d{4}-\d{2}-\d{2}$/.test(t) || !Number.isNaN(Date.parse(t))) && !t.includes(','),
  );
  return [...new Set(valid)].sort().slice(-MAX_EXCEPTIONS).join(',');
}

/** The exceptions a stored value holds, or null for none. */
export function parseExceptions(text: string | null | undefined): SeriesExceptions | null {
  if (!text) return null;
  const days = new Set<DayNumber>();
  const instants: number[] = [];
  for (const token of text.split(',')) {
    const trimmed = token.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const day = dayNumberOfIso(trimmed);
      if (!Number.isNaN(day)) days.add(day);
    } else if (trimmed !== '') {
      const ms = Date.parse(trimmed);
      if (!Number.isNaN(ms)) instants.push(ms);
    }
  }
  if (days.size === 0 && instants.length === 0) return null;
  return { days, instants: instants.sort((a, b) => a - b) };
}

/**
 * Whether the occurrence starting at `start` (a day for an all-day series, ms
 * for a timed one) is one of the exceptions.
 */
export function isException(
  exceptions: SeriesExceptions,
  allDay: boolean,
  start: number,
  timeZone: string,
): boolean {
  if (allDay) {
    return (
      exceptions.days.has(start) ||
      exceptions.instants.some((ms) => Math.floor(ms / DAY_MS) === start)
    );
  }
  if (exceptions.days.has(localDayNumber(start, timeZone))) return true;
  const { instants } = exceptions;
  let low = 0;
  let high = instants.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((instants[mid] as number) < start - EXCEPTION_REACH_MS) low = mid + 1;
    else high = mid;
  }
  return low < instants.length && (instants[low] as number) <= start + EXCEPTION_REACH_MS;
}
