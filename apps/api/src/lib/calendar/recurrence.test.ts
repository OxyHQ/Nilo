import { describe, expect, it } from 'vitest';
import {
  expandSeries,
  formatExceptions,
  formatRepeatRule,
  isException,
  MAX_EXCEPTIONS,
  normalizeRepeatRule,
  parseExceptions,
  parseRepeatRule,
  RepeatRuleError,
  type Series,
  type SeriesExceptions,
  weekdayOf,
  type Window,
} from './recurrence.js';
import {
  DAY_MS,
  dayNumberOfIso,
  instantOf,
  isoOfDayNumber,
  localDayNumber,
  startOfLocalDay,
  wallTimeOf,
} from './zoned-time.js';

const day = dayNumberOfIso;
const iso = (ms: number) => new Date(ms).toISOString();

function windowOf(from: string, to: string, timeZone = 'UTC'): Window {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  return {
    fromMs,
    toMs,
    firstDay: localDayNumber(fromMs, timeZone),
    endDay: localDayNumber(toMs - 1, timeZone) + 1,
    timeZone,
  };
}

const allDaySeries = (rule: string, start: string, length = 1): Series => ({
  rule: parseRepeatRule(rule),
  allDay: true,
  start: day(start),
  length,
});

const timedSeries = (rule: string, start: string, lengthMs = 60 * 60 * 1000): Series => ({
  rule: parseRepeatRule(rule),
  allDay: false,
  start: Date.parse(start),
  length: lengthMs,
});

describe('zoned time', () => {
  it('reads and writes wall-clock time across a change to summer time', () => {
    // Berlin: CET (+1) until 2026-03-29 02:00, CEST (+2) after.
    const before = instantOf(
      { year: 2026, month: 3, day: 28, hour: 9, minute: 0, second: 0, millisecond: 0 },
      'Europe/Berlin',
    );
    const after = instantOf(
      { year: 2026, month: 3, day: 30, hour: 9, minute: 0, second: 0, millisecond: 0 },
      'Europe/Berlin',
    );
    expect(iso(before)).toBe('2026-03-28T08:00:00.000Z');
    expect(iso(after)).toBe('2026-03-30T07:00:00.000Z');
    expect(wallTimeOf(after, 'Europe/Berlin')).toMatchObject({ day: 30, hour: 9 });
  });

  it('moves a skipped time forward and reads a repeated time as its first occurrence', () => {
    const skipped = instantOf(
      { year: 2026, month: 3, day: 29, hour: 2, minute: 30, second: 0, millisecond: 0 },
      'Europe/Berlin',
    );
    expect(wallTimeOf(skipped, 'Europe/Berlin')).toMatchObject({ hour: 3, minute: 30 });
    // 2026-10-25 02:30 happens twice in Berlin: first at +2 (00:30Z).
    const repeated = instantOf(
      { year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 0, millisecond: 0 },
      'Europe/Berlin',
    );
    expect(iso(repeated)).toBe('2026-10-25T00:30:00.000Z');
  });

  it('knows which day an instant falls on, and when a day starts, in a zone', () => {
    const ms = Date.parse('2026-11-03T23:30:00Z');
    expect(isoOfDayNumber(localDayNumber(ms, 'UTC'))).toBe('2026-11-03');
    expect(isoOfDayNumber(localDayNumber(ms, 'Asia/Tokyo'))).toBe('2026-11-04');
    expect(iso(startOfLocalDay(day('2026-11-04'), 'Asia/Tokyo'))).toBe('2026-11-03T15:00:00.000Z');
  });
});

describe('repeat rules', () => {
  it('reads the supported subset and writes it back one way', () => {
    expect(normalizeRepeatRule('RRULE:freq=weekly;byday=MO,WE;interval=2')).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
    );
    expect(normalizeRepeatRule('FREQ=MONTHLY;BYDAY=-1FR;COUNT=3')).toBe(
      'FREQ=MONTHLY;BYDAY=-1FR;COUNT=3',
    );
    expect(normalizeRepeatRule('FREQ=DAILY;UNTIL=20261231')).toBe('FREQ=DAILY;UNTIL=20261231');
    expect(normalizeRepeatRule('FREQ=DAILY;UNTIL=20261231T235959Z;WKST=MO')).toBe(
      'FREQ=DAILY;UNTIL=20261231T235959Z',
    );
    const rule = parseRepeatRule('FREQ=MONTHLY;BYMONTHDAY=1,-1');
    expect(formatRepeatRule(rule)).toBe('FREQ=MONTHLY;BYMONTHDAY=1,-1');
  });

  it.each([
    ['', 'empty'],
    ['FREQ=HOURLY', 'FREQ'],
    ['FREQ=DAILY;COUNT=2;UNTIL=20261231', 'COUNT and UNTIL'],
    ['FREQ=YEARLY;BYMONTH=3', 'BYMONTH'],
    ['FREQ=WEEKLY;BYDAY=1MO', 'BYDAY'],
    ['FREQ=DAILY;INTERVAL=0', 'INTERVAL'],
    ['FREQ=DAILY;WKST=SU', 'WKST'],
    ['FREQ=DAILY;UNTIL=20260230', 'UNTIL'],
    ['FREQ=MONTHLY;BYMONTHDAY=32', 'BYMONTHDAY'],
  ])('refuses %j (%s)', (raw, what) => {
    expect(() => parseRepeatRule(raw)).toThrow(RepeatRuleError);
    expect(() => parseRepeatRule(raw)).toThrow(new RegExp(what.split(' ')[0] as string, 'i'));
  });
});

describe('expanding a series over a window', () => {
  it('repeats an all-day event weekly on the weekdays it names', () => {
    // 2026-11-02 is a Monday.
    expect(weekdayOf(day('2026-11-02'))).toBe(0);
    const starts = expandSeries(
      allDaySeries('FREQ=WEEKLY;BYDAY=MO,WE', '2026-11-02'),
      windowOf('2026-11-01T00:00:00Z', '2026-11-15T00:00:00Z'),
      100,
    );
    expect(starts.map(isoOfDayNumber)).toEqual([
      '2026-11-02',
      '2026-11-04',
      '2026-11-09',
      '2026-11-11',
    ]);
  });

  it('counts COUNT from the first occurrence, whatever the window', () => {
    const series = allDaySeries('FREQ=DAILY;COUNT=5', '2026-11-01');
    const starts = expandSeries(
      series,
      windowOf('2026-11-04T00:00:00Z', '2026-12-01T00:00:00Z'),
      100,
    );
    expect(starts.map(isoOfDayNumber)).toEqual(['2026-11-04', '2026-11-05']);
  });

  it('stops at UNTIL, inclusive', () => {
    const starts = expandSeries(
      allDaySeries('FREQ=DAILY;INTERVAL=2;UNTIL=20261107', '2026-11-01'),
      windowOf('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'),
      100,
    );
    expect(starts.map(isoOfDayNumber)).toEqual([
      '2026-11-01',
      '2026-11-03',
      '2026-11-05',
      '2026-11-07',
    ]);
  });

  it('skips months without the day, and finds the last Friday of each month', () => {
    const on31st = expandSeries(
      allDaySeries('FREQ=MONTHLY', '2026-01-31'),
      windowOf('2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z'),
      100,
    );
    expect(on31st.map(isoOfDayNumber)).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
    const lastFriday = expandSeries(
      allDaySeries('FREQ=MONTHLY;BYDAY=-1FR', '2026-01-30'),
      windowOf('2026-01-01T00:00:00Z', '2026-04-01T00:00:00Z'),
      100,
    );
    expect(lastFriday.map(isoOfDayNumber)).toEqual(['2026-01-30', '2026-02-27', '2026-03-27']);
  });

  it('keeps Feb 29 to leap years', () => {
    const starts = expandSeries(
      allDaySeries('FREQ=YEARLY', '2024-02-29'),
      windowOf('2024-01-01T00:00:00Z', '2029-01-01T00:00:00Z'),
      100,
    );
    expect(starts.map(isoOfDayNumber)).toEqual(['2024-02-29', '2028-02-29']);
  });

  it('includes an occurrence that started before the window and is still going', () => {
    const starts = expandSeries(
      allDaySeries('FREQ=WEEKLY', '2026-11-02', 3),
      windowOf('2026-11-11T00:00:00Z', '2026-11-12T00:00:00Z'),
      100,
    );
    expect(starts.map(isoOfDayNumber)).toEqual(['2026-11-09']);
  });

  it('keeps a timed series at its local time across a change to summer time', () => {
    // Mondays 09:00 in Berlin, from before the clocks go forward to after.
    const starts = expandSeries(
      timedSeries('FREQ=WEEKLY', '2026-03-23T08:00:00Z'),
      windowOf('2026-03-20T00:00:00Z', '2026-04-07T00:00:00Z', 'Europe/Berlin'),
      100,
    );
    expect(starts.map(iso)).toEqual([
      '2026-03-23T08:00:00.000Z',
      '2026-03-30T07:00:00.000Z',
      '2026-04-06T07:00:00.000Z',
    ]);
  });

  it('jumps ahead over a long history without walking it, and honours the limit', () => {
    const starts = expandSeries(
      timedSeries('FREQ=DAILY', '2000-01-01T12:00:00Z'),
      windowOf('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'),
      7,
    );
    expect(starts).toHaveLength(7);
    expect(iso(starts[0] as number)).toBe('2026-11-01T12:00:00.000Z');
    expect((starts[6] as number) - (starts[0] as number)).toBe(6 * DAY_MS);
  });

  it('counts its limit after the occurrences a cursor has already passed', () => {
    const series = allDaySeries('FREQ=DAILY', '2026-11-01');
    const window = windowOf('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z');
    const page = expandSeries(series, window, 3, (start) => start > day('2026-11-20'));
    expect(page.map(isoOfDayNumber)).toEqual(['2026-11-21', '2026-11-22', '2026-11-23']);
  });

  it('reads a timed event that ends before the window as outside it', () => {
    const starts = expandSeries(
      timedSeries('FREQ=DAILY', '2026-11-01T08:00:00Z', 30 * 60 * 1000),
      windowOf('2026-11-03T09:00:00Z', '2026-11-03T12:00:00Z'),
      10,
    );
    expect(starts).toEqual([]);
  });
});

describe('exceptions', () => {
  it('stores days and instants sorted, once each, without anything malformed', () => {
    expect(
      formatExceptions([
        '2026-11-11T08:00:00.000Z',
        '2026-11-04T08:00:00.000Z',
        '2026-11-04T08:00:00.000Z',
        'not a date',
        '2027-12-24',
      ]),
    ).toBe('2026-11-04T08:00:00.000Z,2026-11-11T08:00:00.000Z,2027-12-24');
    expect(formatExceptions([])).toBe('');
  });

  it('keeps the latest when a feed lists more than it holds', () => {
    const many = Array.from({ length: MAX_EXCEPTIONS + 10 }, (_, i) =>
      new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString(),
    );
    const stored = formatExceptions(many).split(',');
    expect(stored).toHaveLength(MAX_EXCEPTIONS);
    expect(stored[stored.length - 1]).toBe(many[many.length - 1]);
  });

  it('removes an all-day occurrence by its day', () => {
    const exceptions = parseExceptions('2027-12-24');
    expect(exceptions).not.toBeNull();
    const day = dayNumberOfIso('2027-12-24');
    expect(isException(exceptions as SeriesExceptions, true, day, 'UTC')).toBe(true);
    expect(isException(exceptions as SeriesExceptions, true, day + 1, 'UTC')).toBe(false);
  });

  it('removes a timed occurrence near the instant named, whatever zone it is read in', () => {
    const exceptions = parseExceptions('2026-11-04T08:00:00.000Z') as SeriesExceptions;
    const at = Date.parse('2026-11-04T08:00:00.000Z');
    expect(isException(exceptions, false, at, 'Europe/Paris')).toBe(true);
    expect(isException(exceptions, false, at + 60 * 60 * 1000, 'America/New_York')).toBe(true);
    expect(isException(exceptions, false, at + 86_400_000, 'Europe/Paris')).toBe(false);
    expect(isException(exceptions, false, at - 86_400_000, 'Europe/Paris')).toBe(false);
  });

  it('holds nothing for an empty or unreadable value', () => {
    expect(parseExceptions(null)).toBeNull();
    expect(parseExceptions('')).toBeNull();
    expect(parseExceptions('nope,also nope')).toBeNull();
  });

  it('leaves the numbering of COUNT alone: an exception does not add an occurrence', () => {
    const rule = parseRepeatRule('FREQ=DAILY;COUNT=3');
    const first = dayNumberOfIso('2026-11-02');
    const exceptions = parseExceptions('2026-11-03') as SeriesExceptions;
    const days = expandSeries(
      { rule, allDay: true, start: first, length: 1 },
      { fromMs: 0, toMs: 0, firstDay: first, endDay: first + 30, timeZone: 'UTC' },
      100,
      (day) => !isException(exceptions, true, day, 'UTC'),
    );
    expect(days).toEqual([first, first + 2]);
  });
});
