import type { CalendarEvent } from '@oxy.so/nilo-contracts';
import { describe, expect, it } from 'vitest';
import { contentLines, durationMs, eventsToIcs, foldLine, parseIcs } from './ics.js';

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
