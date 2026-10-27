import type { CalendarEvent } from '@oxy.so/nilo-contracts';
import { describe, expect, it } from 'vitest';
import { contentLines, durationMs, eventsToIcs, foldLine, isCompleteIcs, parseIcs } from './ics.js';

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'r1',
  rowId: 'r1',
  calendarId: 'c',
  workspaceId: 'w',
  title: 'Lunch, with; friends',
  icon: null,
  allDay: false,
  start: '2026-11-03T12:00:00.000Z',
  end: '2026-11-03T13:00:00.000Z',
  location: null,
  url: null,
  description: 'Line one\nLine two',
  attendees: [],
  color: null,
  recurrence: null,
  seriesStart: null,
  uid: null,
  createdBy: 'u',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T10:20:30.000Z',
  ...over,
});

describe('writing iCalendar', () => {
  it('writes each event with escaped text, UTC times and its rule', () => {
    const ics = eventsToIcs('Team', [
      event({}),
      event({
        rowId: 'r2',
        allDay: true,
        start: '2026-11-04',
        end: '2026-11-06',
        recurrence: 'FREQ=WEEKLY',
        uid: 'abc@google.com',
        description: null,
      }),
    ]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('UID:r1@nilo.so\r\n');
    expect(ics).toContain('DTSTART:20261103T120000Z\r\n');
    expect(ics).toContain('DTEND:20261103T130000Z\r\n');
    expect(ics).toContain('SUMMARY:Lunch\\, with\\; friends\r\n');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two\r\n');
    expect(ics).toContain('UID:abc@google.com\r\n');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261104\r\n');
    expect(ics).toContain('DTEND;VALUE=DATE:20261106\r\n');
    expect(ics).toContain('RRULE:FREQ=WEEKLY\r\n');
    expect(ics).toContain('DTSTAMP:20261002T102030Z\r\n');
  });

  it('folds long lines at 75 octets without splitting a character', () => {
    const line = `SUMMARY:${'é'.repeat(60)}`;
    const folded = foldLine(line);
    for (const part of folded.split('\r\n')) {
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });

  it('round-trips through the reader', () => {
    const ics = eventsToIcs('Team', [event({ uid: 'x1' })]);
    const [read] = parseIcs(ics, 'UTC').events;
    expect(read).toMatchObject({
      uid: 'x1',
      title: 'Lunch, with; friends',
      allDay: false,
      start: '2026-11-03T12:00:00.000Z',
      end: '2026-11-03T13:00:00.000Z',
      description: 'Line one\nLine two',
    });
  });
});

describe('reading iCalendar', () => {
  const doc = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Berlin',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:zoned',
    'DTSTART;TZID=Europe/Berlin:20261103T090000',
    'DURATION:PT1H30M',
    'SUMMARY:Zoned',
    'LOCATION:Room\\, 2',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'DESCRIPTION:Reminder',
    'END:VALARM',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:floating',
    'DTSTART:20261103T090000',
    'DTEND:20261103T100000',
    'SUMMARY:Floating that is long enough to be fol',
    ' ded across two lines',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:day',
    'DTSTART;VALUE=DATE:20261105',
    'RRULE:FREQ=YEARLY;BYMONTH=11',
    'SUMMARY:Unsupported rule',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:day',
    'RECURRENCE-ID;VALUE=DATE:20271105',
    'DTSTART;VALUE=DATE:20271106',
    'SUMMARY:Moved occurrence',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:cancelled',
    'STATUS:CANCELLED',
    'DTSTART:20261103T090000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:weekly',
    'DTSTART:20261102T080000Z',
    'DTEND:20261102T083000Z',
    'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4',
    'SUMMARY:Weekly',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('reads zones, floating times, durations, folded lines and rules', () => {
    const { events, skipped } = parseIcs(doc, 'America/New_York');
    expect(skipped).toBe(2);
    const byUid = new Map(events.map((e) => [e.uid, e]));
    expect(byUid.get('zoned')).toMatchObject({
      start: '2026-11-03T08:00:00.000Z',
      end: '2026-11-03T09:30:00.000Z',
      location: 'Room, 2',
      description: null,
    });
    expect(byUid.get('floating')).toMatchObject({
      title: 'Floating that is long enough to be folded across two lines',
      start: '2026-11-03T14:00:00.000Z',
      end: '2026-11-03T15:00:00.000Z',
    });
    expect(byUid.get('day')).toMatchObject({
      allDay: true,
      start: '2026-11-05',
      end: null,
      recurrence: null,
      simplified: true,
    });
    expect(byUid.get('weekly')).toMatchObject({
      recurrence: 'FREQ=WEEKLY;BYDAY=MO;COUNT=4',
      simplified: false,
    });
  });

  it('gives an event without a UID a stable one', () => {
    const noUid =
      'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261103T090000Z\r\nSUMMARY:A\r\nEND:VEVENT\r\nEND:VCALENDAR';
    const first = parseIcs(noUid, 'UTC').events[0]?.uid;
    expect(first).toMatch(/@import$/);
    expect(parseIcs(noUid, 'UTC').events[0]?.uid).toBe(first);
  });

  it('reads quoted parameters holding a colon', () => {
    const [line] = contentLines('ATTENDEE;CN="Ada: Lovelace":mailto:ada@example.com');
    expect(line).toEqual({
      name: 'ATTENDEE',
      params: { CN: 'Ada: Lovelace' },
      value: 'mailto:ada@example.com',
    });
  });

  it('reads durations', () => {
    expect(durationMs('PT30M')).toBe(30 * 60 * 1000);
    expect(durationMs('P1DT2H')).toBe((24 + 2) * 3600 * 1000);
    expect(durationMs('P2W')).toBe(14 * 24 * 3600 * 1000);
    expect(durationMs('P')).toBeNull();
    expect(durationMs('1H')).toBeNull();
  });
});

describe('reading exceptions and changed occurrences', () => {
  const feed = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'X-WR-CALNAME:Work\\, shared',
    'BEGIN:VEVENT',
    'UID:standup@example.com',
    'DTSTART;TZID=Europe/Paris:20261102T090000',
    'DTEND;TZID=Europe/Paris:20261102T091500',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
    'EXDATE;TZID=Europe/Paris:20261104T090000,20261111T090000',
    'EXDATE;TZID=Europe/Paris:20261116T090000',
    'SUMMARY:Standup',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:standup@example.com',
    'RECURRENCE-ID;TZID=Europe/Paris:20261109T090000',
    'DTSTART;TZID=Europe/Paris:20261109T100000',
    'DTEND;TZID=Europe/Paris:20261109T101500',
    'SUMMARY:Standup (moved)',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:standup@example.com',
    'RECURRENCE-ID;TZID=Europe/Paris:20261123T090000',
    'DTSTART;TZID=Europe/Paris:20261123T090000',
    'STATUS:CANCELLED',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:holiday@example.com',
    'DTSTART;VALUE=DATE:20261224',
    'RRULE:FREQ=YEARLY',
    'EXDATE;VALUE=DATE:20271224',
    'SUMMARY:Holiday',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it("keeps a series' EXDATEs, each read in its own zone", () => {
    const parsed = parseIcs(feed, 'UTC');
    const standup = parsed.events.find((e) => e.uid === 'standup@example.com');
    expect(standup?.recurrence).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
    expect(standup?.exceptions).toEqual([
      '2026-11-04T08:00:00.000Z',
      '2026-11-11T08:00:00.000Z',
      '2026-11-16T08:00:00.000Z',
    ]);
    expect(parsed.events.find((e) => e.uid === 'holiday@example.com')?.exceptions).toEqual([
      '2027-12-24',
    ]);
  });

  it('reads a changed occurrence as an override, and a cancelled one as an override with no event', () => {
    const parsed = parseIcs(feed, 'UTC');
    expect(parsed.overrides).toHaveLength(2);
    const moved = parsed.overrides.find((o) => o.recurrenceId === '2026-11-09T08:00:00.000Z');
    expect(moved?.uid).toBe('standup@example.com');
    expect(moved?.event).toMatchObject({
      title: 'Standup (moved)',
      start: '2026-11-09T09:00:00.000Z',
      end: '2026-11-09T09:15:00.000Z',
      recurrence: null,
    });
    const cancelled = parsed.overrides.find((o) => o.recurrenceId === '2026-11-23T08:00:00.000Z');
    expect(cancelled?.event).toBeNull();
  });

  it("reads the calendar's own name, and counts overrides as skipped for an import", () => {
    const parsed = parseIcs(feed, 'UTC');
    expect(parsed.name).toBe('Work, shared');
    expect(parsed.events.map((e) => e.uid).sort()).toEqual([
      'holiday@example.com',
      'standup@example.com',
    ]);
    expect(parsed.skipped).toBe(2);
  });

  it('writes EXDATEs for a series that has exceptions', () => {
    const ics = eventsToIcs(
      'Team',
      [
        event({ recurrence: 'FREQ=WEEKLY' }),
        event({
          rowId: 'r2',
          allDay: true,
          start: '2026-12-24',
          end: '2026-12-25',
          recurrence: 'FREQ=YEARLY',
        }),
      ],
      (rowId) => (rowId === 'r1' ? ['2026-11-10T12:00:00.000Z'] : ['2027-12-24']),
    );
    expect(ics).toContain('EXDATE:20261110T120000Z\r\n');
    expect(ics).toContain('EXDATE;VALUE=DATE:20271224\r\n');
  });
});

describe('the zone a series repeats in, and whole documents', () => {
  it('keeps the TZID of a timed event, UTC for a Z time, the floating zone otherwise', () => {
    const parsed = parseIcs(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:a',
        'DTSTART;TZID=Europe/Paris:20261102T090000',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:b',
        'DTSTART:20261102T090000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:c',
        'DTSTART:20261102T090000',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:d',
        'DTSTART;VALUE=DATE:20261102',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
      'America/New_York',
    );
    expect(Object.fromEntries(parsed.events.map((e) => [e.uid, e.timeZone]))).toEqual({
      a: 'Europe/Paris',
      b: 'UTC',
      c: 'America/New_York',
      d: null,
    });
  });

  it('tells a document cut short from a whole one', () => {
    const whole = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    expect(isCompleteIcs(whole)).toBe(true);
    expect(isCompleteIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toBe(true);
    expect(isCompleteIcs('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(false);
    expect(isCompleteIcs(whole.slice(0, whole.indexOf('END:VEVENT')))).toBe(false);
    expect(isCompleteIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nEND:VCALENDAR\r\n')).toBe(
      false,
    );
  });
});
