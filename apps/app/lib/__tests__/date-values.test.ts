import {
  dayOf,
  formatDateValue,
  instantOf,
  timeOf,
  withDays,
  withEnd,
  withStart,
  withTime,
  withTimeOf,
} from '../date-values';

describe('editing a date in the cell', () => {
  const local = (y: number, m: number, d: number, h = 0, min = 0) =>
    new Date(y, m - 1, d, h, min).toISOString();

  it('reads a day without time as the UTC day it names, whatever the zone', () => {
    const day = dayOf('2026-10-05T00:00:00.000Z', false);
    expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2026, 9, 5]);
    expect(instantOf(new Date(2026, 9, 5), null)).toBe('2026-10-05T00:00:00.000Z');
  });

  it('moves to other days keeping each end’s time, and drops the end with the start', () => {
    const value = {
      start: local(2026, 10, 1, 9, 30),
      end: local(2026, 10, 2, 18, 0),
      includeTime: true,
    };
    expect(withDays(value, new Date(2026, 9, 10), new Date(2026, 9, 12))).toEqual({
      start: local(2026, 10, 10, 9, 30),
      end: local(2026, 10, 12, 18, 0),
      includeTime: true,
    });
    expect(withDays(value, null, null)).toEqual({ start: null, end: null, includeTime: false });
    // A range picked where there was a single day: the end takes the start's time.
    expect(
      withDays(
        { start: local(2026, 10, 1, 8, 0), includeTime: true },
        new Date(2026, 9, 3),
        new Date(2026, 9, 4),
      ),
    ).toEqual({
      start: local(2026, 10, 3, 8, 0),
      end: local(2026, 10, 4, 8, 0),
      includeTime: true,
    });
  });

  it('adds an end on the start’s day and removes it, keeping the start', () => {
    const value = { start: '2026-10-05T00:00:00.000Z', end: null, includeTime: false };
    expect(withEnd(value, true)).toEqual({ ...value, end: '2026-10-05T00:00:00.000Z' });
    expect(withEnd({ ...value, end: '2026-10-09T00:00:00.000Z' }, false)).toEqual(value);
  });

  it('turns a time on and off on the days the reader saw', () => {
    const value = {
      start: '2026-10-05T00:00:00.000Z',
      end: '2026-10-09T00:00:00.000Z',
      includeTime: false,
    };
    const timed = withTime(value, true);
    expect(timed).toEqual({
      start: local(2026, 10, 5),
      end: local(2026, 10, 9),
      includeTime: true,
    });
    expect(withTime(withTimeOf(timed, 'end', '17:45'), false)).toEqual(value);
    expect(withTimeOf(timed, 'start', '08:15').start).toBe(local(2026, 10, 5, 8, 15));
    expect(timeOf(local(2026, 10, 5, 8, 15))).toBe('08:15');
  });

  it('reads as people write a date, a range and a time', () => {
    expect(formatDateValue({ start: '2026-10-05T00:00:00.000Z' }, 'en-US')).toBe('Oct 5, 2026');
    expect(
      formatDateValue(
        { start: '2026-10-05T00:00:00.000Z', end: '2026-10-09T00:00:00.000Z' },
        'en-US',
      ),
    ).toBe('Oct 5, 2026 → Oct 9, 2026');
    expect(formatDateValue({ start: local(2026, 10, 5, 14, 30), includeTime: true }, 'en-US')).toBe(
      'Oct 5, 2026 14:30',
    );
    expect(formatDateValue(null)).toBe('');
  });

  it('reads in the property’s date format', () => {
    const day = { start: '2026-10-05T00:00:00.000Z' };
    expect(formatDateValue(day, 'en-US', 'full')).toBe('October 5, 2026');
    expect(formatDateValue(day, 'en-US', 'short')).toBe('Oct 5, 2026');
    expect(formatDateValue(day, 'en-US', 'month_day_year')).toBe('10/05/2026');
    expect(formatDateValue(day, 'en-US', 'day_month_year')).toBe('05/10/2026');
    expect(formatDateValue(day, 'en-US', 'iso')).toBe('2026-10-05');
    expect(formatDateValue(day, 'es-ES', 'full')).toBe('5 de octubre de 2026');
    // Each end of a range and the time keep the format.
    expect(
      formatDateValue(
        { start: local(2026, 10, 5, 14, 30), end: local(2026, 10, 9, 9, 0), includeTime: true },
        'en-US',
        'iso',
      ),
    ).toBe('2026-10-05 14:30 → 2026-10-09 09:00');
  });

  it('reads as a day relative to today within a week, else as a short date', () => {
    const now = new Date(2026, 9, 5, 15, 0);
    const on = (d: number) => ({ start: new Date(Date.UTC(2026, 9, d)).toISOString() });
    expect(formatDateValue(on(5), 'en-US', 'relative', now)).toBe('Today');
    expect(formatDateValue(on(6), 'en-US', 'relative', now)).toBe('Tomorrow');
    expect(formatDateValue(on(4), 'en-US', 'relative', now)).toBe('Yesterday');
    expect(formatDateValue(on(8), 'en-US', 'relative', now)).toBe('In 3 days');
    expect(formatDateValue(on(1), 'en-US', 'relative', now)).toBe('4 days ago');
    expect(formatDateValue(on(5), 'es-ES', 'relative', now)).toBe('Hoy');
    expect(formatDateValue(on(20), 'en-US', 'relative', now)).toBe('Oct 20, 2026');
    // A time on a day of the reader's zone: today until midnight there.
    expect(
      formatDateValue(
        { start: local(2026, 10, 5, 23, 30), includeTime: true },
        'en-US',
        'relative',
        now,
      ),
    ).toBe('Today 23:30');
  });
});

describe('editing a date’s start', () => {
  it('keeps the end of a range and that it has no time', () => {
    expect(
      withStart(
        { start: '2026-10-01T00:00:00.000Z', end: '2026-10-05T00:00:00.000Z' },
        '2026-10-02T00:00:00.000Z',
      ),
    ).toEqual({
      start: '2026-10-02T00:00:00.000Z',
      end: '2026-10-05T00:00:00.000Z',
      includeTime: false,
    });
  });

  it('keeps the time of day when only the day was picked', () => {
    expect(
      withStart(
        { start: '2026-10-01T14:30:00.000Z', includeTime: true },
        '2026-10-09T00:00:00.000Z',
      ),
    ).toEqual({ start: '2026-10-09T14:30:00.000Z', end: null, includeTime: true });
  });

  it('starts a date that had none, and clears one', () => {
    expect(withStart(null, '2026-10-09T00:00:00.000Z')).toEqual({
      start: '2026-10-09T00:00:00.000Z',
      end: null,
      includeTime: false,
    });
    expect(
      withStart({ start: '2026-10-01T00:00:00.000Z', end: '2026-10-05T00:00:00.000Z' }, null),
    ).toEqual({
      start: null,
      end: null,
      includeTime: false,
    });
  });
});
