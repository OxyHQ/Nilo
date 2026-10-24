import { describe, expect, it } from 'vitest';
import type { DatabaseProperty, DatabaseViewType } from '../../db/schema/databases.js';
import { CALENDAR_PROPERTY } from '../databases/system.js';
import { calendarDateProperty, recogniseCalendar } from './recognition.js';

const view = (
  type: DatabaseViewType,
  config: Record<string, unknown> = {},
  extra: { blockId?: string | null; order?: number } = {},
) => ({ type, config, blockId: extra.blockId ?? null, order: extra.order ?? 0 });

const database = (properties: DatabaseProperty[], systemKey: 'calendar' | null = null) => ({
  systemKey,
  propertiesSchema: { properties },
});

const prop = (id: string, name: string, type: DatabaseProperty['type']): DatabaseProperty => ({
  id,
  name,
  type,
});

describe('which databases are calendars', () => {
  const props = [
    prop('name', 'Name', 'text'),
    prop('due', 'Due', 'date'),
    prop('meet', 'Meeting', 'date'),
    prop('status', 'Status', 'status'),
  ];

  it('is not one without a calendar view, whatever dates it holds', () => {
    expect(recogniseCalendar(database(props), [view('table'), view('board')])).toBeNull();
  });

  it('is one through its own calendar view, on that view’s date property', () => {
    expect(
      calendarDateProperty(database(props), [
        view('table'),
        view('calendar', { datePropertyId: 'meet' }),
      ]),
    ).toBe('meet');
  });

  it('takes the first calendar view by order, and ignores linked views', () => {
    const views = [
      view('calendar', { datePropertyId: 'due' }, { blockId: 'block-1', order: 0 }),
      view('calendar', { datePropertyId: 'meet' }, { order: 2 }),
      view('calendar', { datePropertyId: 'due' }, { order: 1 }),
    ];
    expect(calendarDateProperty(database(props), views)).toBe('due');
    expect(calendarDateProperty(database(props), [views[0] as (typeof views)[number]])).toBeNull();
  });

  it('is not one when the calendar view names a property that is gone or not a date', () => {
    expect(
      recogniseCalendar(database(props), [view('calendar', { datePropertyId: 'status' })]),
    ).toBeNull();
    expect(
      recogniseCalendar(database(props), [view('calendar', { datePropertyId: 'missing' })]),
    ).toBeNull();
  });

  it('reads the system calendar by its fixed ids, without a view', () => {
    const fields = recogniseCalendar(
      database(
        [
          prop(CALENDAR_PROPERTY.name, 'Name', 'text'),
          prop(CALENDAR_PROPERTY.when, 'Renamed', 'date'),
          prop(CALENDAR_PROPERTY.location, 'Somewhere', 'text'),
          prop(CALENDAR_PROPERTY.description, 'Location', 'text'),
          prop(CALENDAR_PROPERTY.uid, 'iCal UID', 'text'),
        ],
        'calendar',
      ),
      [],
    );
    expect(fields).toEqual({
      when: CALENDAR_PROPERTY.when,
      location: CALENDAR_PROPERTY.location,
      url: null,
      description: CALENDAR_PROPERTY.description,
      attendees: null,
      color: null,
      recurrence: null,
      uid: CALENDAR_PROPERTY.uid,
    });
  });
});

describe('which property holds each field', () => {
  it('finds them by type and name, each property once, in schema order', () => {
    const fields = recogniseCalendar(
      database([
        prop('name', 'Name', 'text'),
        prop('when', 'When', 'date'),
        prop('notes', 'Notes', 'text'),
        prop('where', ' Where ', 'text'),
        prop('link', 'Website', 'url'),
        prop('owner', 'Owner', 'person'),
        prop('guests', 'Guests', 'person'),
        prop('kind', 'Type', 'select'),
        prop('rule', 'Repeat', 'text'),
        prop('other', 'Other text', 'text'),
      ]),
      [view('calendar', { datePropertyId: 'when' })],
    );
    expect(fields).toEqual({
      when: 'when',
      location: 'where',
      url: 'link',
      description: 'notes',
      attendees: 'guests',
      color: 'kind',
      recurrence: 'rule',
      uid: null,
    });
  });

  it('takes any person or url property when none is named for it, but never guesses text', () => {
    const fields = recogniseCalendar(
      database([
        prop('when', 'When', 'date'),
        prop('who', 'Assignee', 'person'),
        prop('site', 'Site', 'url'),
        prop('body', 'Body', 'text'),
        prop('tag', 'Tag', 'select'),
      ]),
      [view('calendar', { datePropertyId: 'when' })],
    );
    expect(fields).toMatchObject({
      attendees: 'who',
      url: 'site',
      location: null,
      description: null,
      color: null,
    });
  });

  it('lets a fixed id win over a property named for the field', () => {
    const fields = recogniseCalendar(
      database([
        prop('when', 'When', 'date'),
        prop('decoy', 'Location', 'text'),
        prop(CALENDAR_PROPERTY.location, 'Venue name', 'text'),
      ]),
      [view('calendar', { datePropertyId: 'when' })],
    );
    expect(fields?.location).toBe(CALENDAR_PROPERTY.location);
  });
});
