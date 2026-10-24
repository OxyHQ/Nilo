/**
 * `/calendar` against PostgreSQL, through the real routes: the personal
 * workspace's default calendar made on first use (once, even when asked for
 * at once), events written as rows that Nilo's own database routes see and
 * vice versa, the range read with all-day days, repeating events and its
 * keyset cursor, who may read and write, the refusals' shape, and ICS export
 * and import matched on UID.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type Calendar,
  type CalendarEvent,
  calendarErrorBodySchema,
  calendarEventPageSchema,
  calendarEventSchema,
  calendarListSchema,
} from '@oxy.so/nilo-contracts';
import { and, eq, like } from 'drizzle-orm';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { databases } from '../../db/schema/databases.js';
import { pageActivity } from '../../db/schema/page-activity.js';
import { pages } from '../../db/schema/pages.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';
import { CALENDAR_PROPERTY } from '../../lib/databases/system.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticateToken: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const id = req.header('x-test-user');
    if (!id) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.user = { id };
    next();
  },
  oxyClient: {
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
    users: { get: async () => ({ username: 'ada' }) },
  },
}));
vi.mock('../../lib/rate-limit.js', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/notification-service.js', () => ({ sendNotification: vi.fn(async () => ({})) }));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: calendarRouter } = await import('../calendar.js');
const { default: workspacesRouter } = await import('../workspaces.js');
const { default: databasesRouter } = await import('../databases.js');
const { default: pagesRouter } = await import('../pages.js');

let db: TestDatabase;
let server: Server;
let base: string;
let previousUrl: string | undefined;

const scope = testScope('calendar-routes');
const ADA = `${scope}-ada`;
const BEN = `${scope}-ben`;
const EVE = `${scope}-eve`;

type Json = Record<string, unknown>;

async function api(method: string, path: string, body?: unknown, user = ADA) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Json = {};
  try {
    json = text ? (JSON.parse(text) as Json) : {};
  } catch {
    json = { text };
  }
  return { status: res.status, json, text, headers: res.headers };
}

/** A refusal, checked against the contract's error shape. */
async function refused(
  res: Promise<Awaited<ReturnType<typeof api>>>,
  status: number,
  code: string,
) {
  const answer = await res;
  expect(answer.status, JSON.stringify(answer.json)).toBe(status);
  const body = calendarErrorBodySchema.parse(answer.json);
  expect(body.error.code).toBe(code);
  return body.error;
}

async function createEvent(body: Json, user = ADA): Promise<CalendarEvent> {
  const res = await api('POST', '/calendar/events', body, user);
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return calendarEventSchema.parse(res.json);
}

async function events(params: Record<string, string>, user = ADA) {
  const res = await api('GET', `/calendar/events?${new URLSearchParams(params)}`, undefined, user);
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return calendarEventPageSchema.parse(res.json);
}

async function personalCalendar(user = ADA): Promise<Calendar> {
  const res = await api('GET', '/calendar/calendars', undefined, user);
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  const list = calendarListSchema.parse(res.json);
  const calendar = list.items.find((c) => c.isDefault);
  if (!calendar) throw new Error('no default calendar');
  return calendar;
}

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const app = express();
  app.use(express.json());
  app.use('/calendar', calendarRouter);
  app.use('/workspaces', workspacesRouter);
  app.use('/databases', databasesRouter);
  app.use('/pages', pagesRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.delete(workspaces).where(like(workspaces.ownerId, `${scope}%`));
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousUrl;
});

describe('the default calendar', () => {
  it('is made on first use, once, even when asked for at once', async () => {
    const answers = await Promise.all([
      api('GET', '/calendar/calendars'),
      api('GET', '/calendar/calendars'),
      api('GET', '/calendar/calendars'),
    ]);
    for (const answer of answers) expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    const ids = answers.map((a) => calendarListSchema.parse(a.json).items[0]?.id);
    expect(new Set(ids).size).toBe(1);

    const [personal] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.ownerId, ADA), eq(workspaces.isPersonal, true)));
    const systemCalendars = await db
      .select({ id: databases.id, teamspaceId: databases.teamspaceId })
      .from(databases)
      .where(
        and(eq(databases.workspaceId, personal?.id as string), eq(databases.systemKey, 'calendar')),
      );
    expect(systemCalendars).toEqual([{ id: ids[0], teamspaceId: null }]);

    const calendar = await personalCalendar();
    expect(calendar).toMatchObject({
      name: 'Calendar',
      isDefault: true,
      role: 'admin',
      canEdit: true,
      fields: {
        when: CALENDAR_PROPERTY.when,
        location: CALENDAR_PROPERTY.location,
        url: CALENDAR_PROPERTY.url,
        description: CALENDAR_PROPERTY.description,
        attendees: CALENDAR_PROPERTY.attendees,
        color: CALENDAR_PROPERTY.color,
        recurrence: CALENDAR_PROPERTY.recurrence,
        uid: CALENDAR_PROPERTY.uid,
      },
    });
    expect(calendar.colors.map((c) => c.id)).toContain('blue');
  });

  it('opens in Nilo on its calendar view, and cannot be deleted', async () => {
    const calendar = await personalCalendar();
    const views = await api('GET', `/databases/${calendar.id}/views`);
    expect(views.status).toBe(200);
    const list = views.json.views as { type: string; isDefault: boolean; config: Json }[];
    expect(list.find((v) => v.isDefault)).toMatchObject({
      type: 'calendar',
      config: { datePropertyId: CALENDAR_PROPERTY.when },
    });
    expect((await api('DELETE', `/databases/${calendar.id}`)).status).toBe(409);
    const retype = await api(
      'PATCH',
      `/databases/${calendar.id}/properties/${CALENDAR_PROPERTY.when}`,
      { type: 'text' },
    );
    expect(retype.status).toBe(409);
  });
});

describe('events are rows', () => {
  it('creates one in the default calendar that Nilo’s database routes see', async () => {
    const calendar = await personalCalendar();
    const event = await createEvent({
      title: 'Design review',
      start: '2026-11-03T10:00:00+01:00',
      end: '2026-11-03T11:30:00+01:00',
      location: 'Room 4',
      url: 'https://meet.example/abc',
      description: 'Bring the mockups',
      colorId: 'blue',
      attendees: [ADA],
    });
    expect(event).toMatchObject({
      calendarId: calendar.id,
      title: 'Design review',
      allDay: false,
      start: '2026-11-03T09:00:00.000Z',
      end: '2026-11-03T10:30:00.000Z',
      location: 'Room 4',
      url: 'https://meet.example/abc',
      description: 'Bring the mockups',
      color: { id: 'blue' },
      attendees: [ADA],
      createdBy: ADA,
    });

    const row = await api('GET', `/databases/${calendar.id}/rows/${event.rowId}`);
    expect(row.status).toBe(200);
    expect(row.json.row).toMatchObject({
      title: 'Design review',
      properties: {
        name: { text: 'Design review' },
        [CALENDAR_PROPERTY.when]: {
          start: '2026-11-03T09:00:00.000Z',
          end: '2026-11-03T10:30:00.000Z',
          includeTime: true,
        },
        [CALENDAR_PROPERTY.location]: { text: 'Room 4' },
      },
    });
    const activity = await db
      .select({ kind: pageActivity.kind })
      .from(pageActivity)
      .where(eq(pageActivity.pageId, event.rowId));
    expect(activity.map((a) => a.kind)).toContain('created');
  });

  it('reads an edit made in Nilo, and a PATCH moves the event keeping its length', async () => {
    const event = await createEvent({
      title: 'Sync',
      start: '2026-11-05T09:00:00Z',
      end: '2026-11-05T09:30:00Z',
    });
    const renamed = await api('PATCH', `/pages/${event.rowId}`, {
      properties: { [CALENDAR_PROPERTY.location]: { text: 'Kitchen' } },
    });
    expect(renamed.status, JSON.stringify(renamed.json)).toBe(200);
    const read = await api('GET', `/calendar/events/${event.rowId}`);
    expect(calendarEventSchema.parse(read.json).location).toBe('Kitchen');

    const moved = await api('PATCH', `/calendar/events/${event.rowId}`, {
      start: '2026-11-06T14:00:00Z',
      title: 'Sync (moved)',
    });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    expect(calendarEventSchema.parse(moved.json)).toMatchObject({
      title: 'Sync (moved)',
      start: '2026-11-06T14:00:00.000Z',
      end: '2026-11-06T14:30:00.000Z',
      location: 'Kitchen',
    });
    const [page] = await db
      .select({ title: pages.title, lastEditedBy: pages.lastEditedBy })
      .from(pages)
      .where(eq(pages.id, event.rowId));
    expect(page).toEqual({ title: 'Sync (moved)', lastEditedBy: ADA });
    const kinds = (
      await db
        .select({ kind: pageActivity.kind })
        .from(pageActivity)
        .where(eq(pageActivity.pageId, event.rowId))
    ).map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(['created', 'properties_changed']));
  });

  it('turns a timed event into an all-day one only with a start in the new form', async () => {
    const event = await createEvent({ title: 'Offsite', start: '2026-11-10T09:00:00Z' });
    await refused(
      api('PATCH', `/calendar/events/${event.rowId}`, { allDay: true }),
      422,
      'validation_failed',
    );
    const changed = await api('PATCH', `/calendar/events/${event.rowId}`, {
      allDay: true,
      start: '2026-11-10',
      end: '2026-11-12',
    });
    expect(calendarEventSchema.parse(changed.json)).toMatchObject({
      allDay: true,
      start: '2026-11-10',
      end: '2026-11-12',
    });
  });

  it('deletes into the trash, and a second delete is still 204', async () => {
    const event = await createEvent({ title: 'Cancelled', start: '2026-11-07T09:00:00Z' });
    expect((await api('DELETE', `/calendar/events/${event.rowId}`)).status).toBe(204);
    expect((await api('DELETE', `/calendar/events/${event.rowId}`)).status).toBe(204);
    const [row] = await db
      .select({ archived: pages.archived })
      .from(pages)
      .where(eq(pages.id, event.rowId));
    expect(row?.archived).toBe(true);
    await refused(api('GET', `/calendar/events/${event.rowId}`), 410, 'gone');
    const page = await events({ from: '2026-11-07T00:00:00Z', to: '2026-11-08T00:00:00Z' });
    expect(page.items.map((e) => e.rowId)).not.toContain(event.rowId);
  });

  it('refuses values the calendar cannot hold, in the conventional shape', async () => {
    const outsider = await refused(
      api('POST', '/calendar/events', {
        title: 'x',
        start: '2026-11-03T09:00:00Z',
        attendees: [`${scope}-stranger`],
      }),
      422,
      'validation_failed',
    );
    expect(outsider.details).toMatchObject({ field: 'attendees', reason: 'UNKNOWN_PERSON' });
    await refused(
      api('POST', '/calendar/events', {
        title: 'x',
        start: '2026-11-03T09:00:00Z',
        colorId: 'teal',
      }),
      422,
      'validation_failed',
    );
    await refused(
      api('POST', '/calendar/events', {
        title: 'x',
        start: '2026-11-03T09:00:00Z',
        recurrence: 'FREQ=HOURLY',
      }),
      422,
      'validation_failed',
    );
    await refused(
      api('POST', '/calendar/events', { title: 'x', allDay: true, start: '2026-11-03T09:00:00Z' }),
      422,
      'validation_failed',
    );
    await refused(
      api('POST', '/calendar/events', { start: '2026-11-03T09:00:00Z' }),
      400,
      'bad_request',
    );
    await refused(
      api('POST', '/calendar/events', { title: 'x', start: '2026-11-03T09:00:00Z', extra: 1 }),
      400,
      'bad_request',
    );
  });
});

describe('reading a range', () => {
  let dense: string;

  it('returns what overlaps the window, all-day events by the reader’s days', async () => {
    const calendar = await api('POST', '/databases', {
      workspaceId: (await personalCalendar()).workspaceId,
      name: `Range ${scope}`,
      teamspaceId: null,
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'at', name: 'At', type: 'date' },
          { id: 'rule', name: 'Repeat', type: 'text' },
        ],
      },
    });
    expect(calendar.status, JSON.stringify(calendar.json)).toBe(201);
    dense = (calendar.json.database as { id: string }).id;
    const view = await api('POST', `/databases/${dense}/views`, { name: 'Cal', type: 'calendar' });
    expect(view.status, JSON.stringify(view.json)).toBe(201);

    const make = (title: string, fields: Json) =>
      createEvent({ calendarId: dense, title, ...fields });
    await make('before', { start: '2026-12-01T08:00:00Z', end: '2026-12-01T09:00:00Z' });
    await make('spans start', { start: '2026-12-01T23:00:00Z', end: '2026-12-02T01:00:00Z' });
    await make('inside', { start: '2026-12-02T12:00:00Z' });
    await make('ends at from', { start: '2026-12-01T22:00:00Z', end: '2026-12-02T00:00:00Z' });
    await make('day 2', { allDay: true, start: '2026-12-02' });
    await make('day 3', { allDay: true, start: '2026-12-03' });
    await make('days 1-2', { allDay: true, start: '2026-12-01', end: '2026-12-03' });
    await make('weekly', {
      allDay: true,
      start: '2026-11-25',
      recurrence: 'FREQ=WEEKLY;COUNT=3',
    });

    const utc = await events({
      calendarIds: dense,
      from: '2026-12-02T00:00:00Z',
      to: '2026-12-03T00:00:00Z',
    });
    expect(utc.items.map((e) => e.title).sort()).toEqual(
      ['day 2', 'days 1-2', 'weekly', 'inside', 'spans start'].sort(),
    );
    const weekly = utc.items.find((e) => e.title === 'weekly');
    expect(weekly).toMatchObject({
      start: '2026-12-02',
      end: '2026-12-03',
      seriesStart: '2026-11-25',
      recurrence: 'FREQ=WEEKLY;COUNT=3',
    });
    expect(weekly?.id).toBe(`${weekly?.rowId}:2026-12-02`);

    // Tokyo's 2 December is 1 Dec 15:00Z to 2 Dec 15:00Z.
    const tokyo = await events({
      calendarIds: dense,
      from: '2026-12-01T15:00:00Z',
      to: '2026-12-02T15:00:00Z',
      timeZone: 'Asia/Tokyo',
    });
    expect(tokyo.items.map((e) => e.title).sort()).toEqual(
      ['day 2', 'days 1-2', 'weekly', 'inside', 'spans start', 'ends at from'].sort(),
    );
    // All-day events come first on their day: ordered by the local midnight they start.
    expect(tokyo.items[0]?.title).toBe('days 1-2');

    const later = await events({
      calendarIds: dense,
      from: '2026-12-09T00:00:00Z',
      to: '2026-12-31T00:00:00Z',
    });
    expect(later.items.map((e) => e.start)).toEqual(['2026-12-09']);
  });

  it('pages by its cursor, in order, each event once', async () => {
    const params = { calendarIds: dense, from: '2026-11-01T00:00:00Z', to: '2027-01-01T00:00:00Z' };
    const all = await events({ ...params, limit: '1000' });
    const walked: string[] = [];
    let cursor: string | null = null;
    let pagesRead = 0;
    do {
      const page = await events({ ...params, limit: '2', ...(cursor && { cursor }) });
      expect(page.items.length).toBeLessThanOrEqual(2);
      walked.push(...page.items.map((e) => e.id));
      cursor = page.nextCursor;
      pagesRead += 1;
    } while (cursor && pagesRead < 50);
    expect(walked).toEqual(all.items.map((e) => e.id));
    expect(new Set(walked).size).toBe(walked.length);
    expect(walked.length).toBeGreaterThanOrEqual(9);

    const first = await events({ ...params, limit: '2' });
    await refused(
      api(
        'GET',
        `/calendar/events?${new URLSearchParams({
          ...params,
          to: '2027-02-01T00:00:00Z',
          cursor: first.nextCursor as string,
        })}`,
      ),
      400,
      'bad_request',
    );
  });

  it('lists every calendar of the personal workspace by default', async () => {
    const list = calendarListSchema.parse((await api('GET', '/calendar/calendars')).json);
    expect(list.items[0]?.isDefault).toBe(true);
    expect(list.items.map((c) => c.id)).toContain(dense);
    const all = await events({ from: '2026-12-02T00:00:00Z', to: '2026-12-03T00:00:00Z' });
    expect(all.items.some((e) => e.calendarId === dense)).toBe(true);
  });

  it('refuses a malformed or unreasonable range', async () => {
    await refused(api('GET', '/calendar/events?from=2026-12-02T00:00:00Z'), 400, 'bad_request');
    await refused(
      api('GET', '/calendar/events?from=2026-12-02T00:00:00Z&to=2026-12-03T00:00:00Z&color=red'),
      400,
      'bad_request',
    );
    await refused(
      api('GET', '/calendar/events?from=2026-12-03T00:00:00Z&to=2026-12-02T00:00:00Z'),
      422,
      'validation_failed',
    );
    await refused(
      api('GET', '/calendar/events?from=2026-01-01T00:00:00Z&to=2028-01-01T00:00:00Z'),
      422,
      'validation_failed',
    );
    await refused(
      api(
        'GET',
        '/calendar/events?from=2026-12-02T00:00:00Z&to=2026-12-03T00:00:00Z&timeZone=Mars/Olympus',
      ),
      422,
      'validation_failed',
    );
    await refused(
      api('GET', '/calendar/events?from=2026-12-02T00:00:00Z&to=2026-12-03T00:00:00Z&limit=0'),
      422,
      'validation_failed',
    );
    await refused(api('GET', '/calendar/nothing-here'), 404, 'unknown_route');
  });
});

describe('who may read and write', () => {
  let team: string;
  let teamCalendar: string;
  let plain: string;

  beforeAll(async () => {
    const created = await api('POST', '/workspaces', { name: `Team ${scope}` });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    team = (created.json.workspace as { id: string }).id;
    await db.insert(workspaceMembers).values({ workspaceId: team, userId: BEN, role: 'viewer' });
    const database = await api('POST', '/databases', {
      workspaceId: team,
      name: 'Team calendar',
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'when', name: 'When', type: 'date' },
          { id: 'where', name: 'Location', type: 'text' },
          { id: 'guests', name: 'Guests', type: 'person' },
        ],
      },
    });
    expect(database.status, JSON.stringify(database.json)).toBe(201);
    teamCalendar = (database.json.database as { id: string }).id;
    expect(
      (await api('POST', `/databases/${teamCalendar}/views`, { name: 'Cal', type: 'calendar' }))
        .status,
    ).toBe(201);
    const other = await api('POST', '/databases', { workspaceId: team, name: 'Tasks' });
    plain = (other.json.database as { id: string }).id;
  });

  it('shows a member the workspace’s calendars with their role, and not a database that is not one', async () => {
    const list = calendarListSchema.parse(
      (await api('GET', `/calendar/calendars?workspaceId=${team}`, undefined, BEN)).json,
    );
    expect(list.items).toEqual([
      expect.objectContaining({
        id: teamCalendar,
        role: 'viewer',
        canEdit: false,
        isDefault: false,
        fields: expect.objectContaining({ when: 'when', location: 'where', attendees: 'guests' }),
      }),
    ]);
    await refused(api('GET', `/calendar/calendars/${plain}`), 422, 'not_a_calendar');
  });

  it('lets a viewer read events but not write them', async () => {
    const event = await createEvent({
      calendarId: teamCalendar,
      title: 'All hands',
      start: '2026-11-20T15:00:00Z',
      attendees: [BEN],
    });
    expect(event.attendees).toEqual([BEN]);
    const read = await api('GET', `/calendar/events/${event.rowId}`, undefined, BEN);
    expect(read.status).toBe(200);
    await refused(
      api('PATCH', `/calendar/events/${event.rowId}`, { title: 'Mine now' }, BEN),
      403,
      'forbidden',
    );
    await refused(
      api('DELETE', `/calendar/events/${event.rowId}`, undefined, BEN),
      403,
      'forbidden',
    );
    await refused(
      api(
        'POST',
        '/calendar/events',
        { calendarId: teamCalendar, title: 'x', start: '2026-11-20T15:00:00Z' },
        BEN,
      ),
      403,
      'forbidden',
    );
  });

  it('hides everything from someone outside the workspace', async () => {
    const event = await createEvent({
      calendarId: teamCalendar,
      title: 'Private',
      start: '2026-11-21T15:00:00Z',
    });
    await refused(api('GET', `/calendar/events/${event.rowId}`, undefined, EVE), 404, 'not_found');
    await refused(
      api('PATCH', `/calendar/events/${event.rowId}`, { title: 'x' }, EVE),
      404,
      'not_found',
    );
    await refused(
      api('GET', `/calendar/calendars/${teamCalendar}`, undefined, EVE),
      404,
      'not_found',
    );
    await refused(
      api(
        'GET',
        `/calendar/events?calendarIds=${teamCalendar}&from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z`,
        undefined,
        EVE,
      ),
      404,
      'not_found',
    );
    await refused(
      api('GET', `/calendar/calendars?workspaceId=${team}`, undefined, EVE),
      403,
      'forbidden',
    );
    // Eve's own personal calendar holds none of it.
    const own = await events({ from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' }, EVE);
    expect(own.items).toEqual([]);
  });
});

describe('iCalendar', () => {
  const feed = (summary: string) =>
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:feed-1@example.com',
      'DTSTART;TZID=Europe/Paris:20261204T090000',
      'DTEND;TZID=Europe/Paris:20261204T100000',
      `SUMMARY:${summary}`,
      'LOCATION:Paris',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:feed-2@example.com',
      'DTSTART;VALUE=DATE:20261205',
      'RRULE:FREQ=DAILY;COUNT=2',
      'SUMMARY:Holiday',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

  it('imports a document, and importing it again updates rather than doubles', async () => {
    const calendar = await personalCalendar();
    const first = await api('POST', `/calendar/calendars/${calendar.id}/import`, {
      ics: feed('Standup'),
    });
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(first.json).toEqual({ created: 2, updated: 0, skipped: 0, simplified: 0 });
    const again = await api('POST', `/calendar/calendars/${calendar.id}/import`, {
      ics: feed('Standup (renamed)'),
    });
    expect(again.json).toEqual({ created: 0, updated: 2, skipped: 0, simplified: 0 });

    const page = await events({
      calendarIds: calendar.id,
      from: '2026-12-04T00:00:00Z',
      to: '2026-12-07T00:00:00Z',
    });
    const imported = page.items.filter((e) => e.uid?.startsWith('feed-'));
    expect(imported.map((e) => [e.title, e.start])).toEqual([
      ['Standup (renamed)', '2026-12-04T08:00:00.000Z'],
      ['Holiday', '2026-12-05'],
      ['Holiday', '2026-12-06'],
    ]);
  });

  it('keeps an imported event deleted here deleted on the next import', async () => {
    const calendar = await personalCalendar();
    const page = await events({
      calendarIds: calendar.id,
      from: '2026-12-04T00:00:00Z',
      to: '2026-12-05T00:00:00Z',
    });
    const standup = page.items.find((e) => e.uid === 'feed-1@example.com');
    expect((await api('DELETE', `/calendar/events/${standup?.rowId}`)).status).toBe(204);
    const again = await api('POST', `/calendar/calendars/${calendar.id}/import`, {
      ics: feed('Standup'),
    });
    expect(again.json).toEqual({ created: 0, updated: 1, skipped: 1, simplified: 0 });
  });

  it('refuses what is not a calendar, and a URL that is not public', async () => {
    const calendar = await personalCalendar();
    await refused(
      api('POST', `/calendar/calendars/${calendar.id}/import`, { ics: 'hello' }),
      422,
      'validation_failed',
    );
    await refused(
      api('POST', `/calendar/calendars/${calendar.id}/import`, { url: 'http://127.0.0.1/cal.ics' }),
      422,
      'validation_failed',
    );
    await refused(
      api('POST', `/calendar/calendars/${calendar.id}/import`, {
        ics: feed('x'),
        url: 'https://a.example',
      }),
      422,
      'validation_failed',
    );
  });

  it('exports every event, a repeating one with its rule', async () => {
    const calendar = await personalCalendar();
    const res = await api('GET', `/calendar/calendars/${calendar.id}/export.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    expect(res.text).toContain('UID:feed-2@example.com\r\n');
    expect(res.text).toContain('RRULE:FREQ=DAILY;COUNT=2\r\n');
    expect(res.text).toContain('SUMMARY:Design review\r\n');
    expect(res.text).not.toContain('SUMMARY:Cancelled');
  });
});
