import { describe, expect, it } from 'vitest';
import type { DatabaseProperty } from '../../db/schema/databases.js';
import type { DatabaseRecord } from '../../repositories/databases.js';
import type { PageRow } from '../../repositories/pages.js';
import {
  type CalendarSource,
  EventWriteError,
  eventOf,
  eventProperties,
  mergedTime,
  readEventTime,
  storedTime,
  wireTime,
} from './events.js';

const properties: DatabaseProperty[] = [
  { id: 'name', name: 'Name', type: 'text' },
  { id: 'when', name: 'When', type: 'date' },
  { id: 'loc', name: 'Location', type: 'text' },
  { id: 'who', name: 'Attendees', type: 'person' },
  {
    id: 'color',
    name: 'Color',
    type: 'select',
    config: { options: [{ id: 'blue', name: 'Blue', color: 'blue' }] },
  },
  { id: 'repeat', name: 'Repeat', type: 'text' },
];

const source: CalendarSource = {
  database: {
    id: 'db',
    workspaceId: 'ws',
    name: 'Team',
    icon: null,
    propertiesSchema: { properties },
    systemKey: null,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  } as unknown as DatabaseRecord,
  fields: {
    when: 'when',
    location: 'loc',
    url: null,
    description: null,
    attendees: 'who',
    color: 'color',
    recurrence: 'repeat',
    uid: null,
  },
  role: 'editor',
};

const row = (values: Record<string, unknown>): PageRow =>
  ({
    id: 'row-1',
    workspaceId: 'ws',
    title: 'Standup',
    icon: null,
    ownerId: 'u1',
    properties: values,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
  }) as unknown as PageRow;

describe('reading a stored date as an event time', () => {
  it('reads days (inclusive end, as stored) as all-day with an exclusive end', () => {
    const time = readEventTime({
      start: '2026-11-03T00:00:00.000Z',
      end: '2026-11-05T00:00:00.000Z',
      includeTime: false,
    });
    expect(time && wireTime(time)).toEqual({
      allDay: true,
      start: '2026-11-03',
      end: '2026-11-06',
    });
  });

  it('reads a one-day value, a bare day and a day with no end', () => {
    expect(wireTime(readEventTime({ start: '2026-11-03', end: null }) as never)).toEqual({
      allDay: true,
      start: '2026-11-03',
      end: '2026-11-04',
    });
  });

  it('reads instants, an event with no end ending when it starts', () => {
    const time = readEventTime({ start: '2026-11-03T09:00:00.000Z', includeTime: true });
    expect(time && wireTime(time)).toEqual({
      allDay: false,
      start: '2026-11-03T09:00:00.000Z',
      end: '2026-11-03T09:00:00.000Z',
    });
  });

  it('has no time without a start, or with one that is not a date', () => {
    expect(readEventTime(null)).toBeNull();
    expect(readEventTime({ start: null })).toBeNull();
    expect(readEventTime({ start: 'soon' })).toBeNull();
  });
});

describe('writing an event time as a stored date', () => {
  it('stores days as midnight UTC with an inclusive end, none for one day', () => {
    expect(storedTime({ allDay: true, start: '2026-11-03', end: '2026-11-06' })).toEqual({
      start: '2026-11-03T00:00:00.000Z',
      end: '2026-11-05T00:00:00.000Z',
      includeTime: false,
    });
    expect(storedTime({ allDay: true, start: '2026-11-03', end: null })).toEqual({
      start: '2026-11-03T00:00:00.000Z',
      end: null,
      includeTime: false,
    });
  });

  it('stores instants in UTC', () => {
    expect(
      storedTime({
        allDay: false,
        start: '2026-11-03T10:00:00+01:00',
        end: '2026-11-03T11:30:00+01:00',
      }),
    ).toEqual({
      start: '2026-11-03T09:00:00.000Z',
      end: '2026-11-03T10:30:00.000Z',
      includeTime: true,
    });
  });

  it('refuses the wrong form and an end before the start', () => {
    expect(() => storedTime({ allDay: true, start: '2026-11-03T00:00:00Z', end: null })).toThrow(
      EventWriteError,
    );
    expect(() => storedTime({ allDay: true, start: '2026-11-03', end: '2026-11-03' })).toThrow(
      /after start/,
    );
    expect(() =>
      storedTime({ allDay: false, start: '2026-11-03T10:00:00Z', end: '2026-11-03T09:00:00Z' }),
    ).toThrow(/before start/);
  });
});

describe('a PATCH’s time', () => {
  const timed = readEventTime({
    start: '2026-11-03T09:00:00.000Z',
    end: '2026-11-03T10:00:00.000Z',
    includeTime: true,
  });
  const days = readEventTime({
    start: '2026-11-03T00:00:00.000Z',
    end: '2026-11-04T00:00:00.000Z',
    includeTime: false,
  });

  it('leaves the time alone when none of its fields is sent', () => {
    expect(mergedTime(timed as never, {})).toBeUndefined();
  });

  it('moves the event when only start is sent, keeping its length', () => {
    expect(mergedTime(timed as never, { start: '2026-11-04T14:00:00Z' })).toEqual({
      allDay: false,
      start: '2026-11-04T14:00:00Z',
      end: '2026-11-04T15:00:00.000Z',
    });
    expect(mergedTime(days as never, { start: '2026-11-10' })).toEqual({
      allDay: true,
      start: '2026-11-10',
      end: '2026-11-12',
    });
  });

  it('keeps the start when only end is sent', () => {
    expect(mergedTime(timed as never, { end: '2026-11-03T12:00:00Z' })).toEqual({
      allDay: false,
      start: '2026-11-03T09:00:00.000Z',
      end: '2026-11-03T12:00:00Z',
    });
  });

  it('needs start to change allDay', () => {
    expect(() => mergedTime(timed as never, { allDay: true })).toThrow(/needs start/);
    expect(mergedTime(timed as never, { allDay: true, start: '2026-11-03' })).toEqual({
      allDay: true,
      start: '2026-11-03',
      end: undefined,
    });
  });
});

describe('events from rows and rows from events', () => {
  it('reads every field from the properties the calendar names', () => {
    const event = eventOf(
      source,
      row({
        when: {
          start: '2026-11-03T09:00:00.000Z',
          end: '2026-11-03T09:30:00.000Z',
          includeTime: true,
        },
        loc: { text: 'Room 4' },
        who: { userIds: ['u2', 'u3'] },
        color: { optionId: 'blue' },
      }),
    );
    expect(event).toMatchObject({
      id: 'row-1',
      rowId: 'row-1',
      calendarId: 'db',
      title: 'Standup',
      allDay: false,
      start: '2026-11-03T09:00:00.000Z',
      end: '2026-11-03T09:30:00.000Z',
      location: 'Room 4',
      attendees: ['u2', 'u3'],
      color: { id: 'blue', name: 'Blue', color: 'blue' },
      recurrence: null,
      seriesStart: null,
      createdBy: 'u1',
    });
  });

  it('names an occurrence of a repeating event by its start', () => {
    const event = eventOf(
      source,
      row({
        when: { start: '2026-11-02T00:00:00.000Z', includeTime: false },
        repeat: { text: 'FREQ=WEEKLY' },
      }),
      Math.floor(Date.parse('2026-11-09T00:00:00Z') / 86_400_000),
    );
    expect(event).toMatchObject({
      id: 'row-1:2026-11-09',
      start: '2026-11-09',
      end: '2026-11-10',
      recurrence: 'FREQ=WEEKLY',
      seriesStart: '2026-11-02',
    });
  });

  it('writes the properties the calendar has, refusing values it has nowhere to keep', () => {
    expect(
      eventProperties(source, {
        title: 'Planning',
        time: { allDay: false, start: '2026-11-03T09:00:00Z', end: null },
        location: 'Room 1',
        attendees: ['u2', 'u2'],
        colorId: 'blue',
        recurrence: 'rrule:freq=daily;count=3',
        url: null,
      }),
    ).toEqual({
      title: 'Planning',
      properties: {
        name: { text: 'Planning' },
        when: { start: '2026-11-03T09:00:00.000Z', end: null, includeTime: true },
        loc: { text: 'Room 1' },
        who: { userIds: ['u2'] },
        color: { optionId: 'blue' },
        repeat: { text: 'FREQ=DAILY;COUNT=3' },
      },
    });
    expect(() => eventProperties(source, { url: 'https://meet.example' })).toThrow(
      /no link property/,
    );
    expect(() => eventProperties(source, { colorId: 'green' })).toThrow(/colou?r/);
    expect(() => eventProperties(source, { recurrence: 'FREQ=HOURLY' })).toThrow(EventWriteError);
  });
});
