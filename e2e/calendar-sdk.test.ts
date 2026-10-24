/**
 * End to end: `@oxy.so/nilo`, the SDK other Oxy apps (Astro first) use, against
 * the real `/calendar` and `/workspaces` routes on PostgreSQL. Every answer
 * the SDK returns has been parsed with the contract, so this holds the API,
 * the contract and the client to one another: the personal workspace and its
 * default calendar, an event's whole life, a repeating event walked page by
 * page, ICS in and out, and the typed errors.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../apps/api/src/db/__tests__/testDatabase.js';
import { closeDb } from '../apps/api/src/db/client.js';
import { workspaces } from '../apps/api/src/db/schema/workspaces.js';
import { createNiloClient, NiloApiError, type NiloClient } from '../packages/sdk/src/index';

vi.mock('../apps/api/src/middleware/auth.js', () => ({
  authenticateToken: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const header = req.header('authorization') ?? '';
    const id = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
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
vi.mock('../apps/api/src/lib/rate-limit.js', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../apps/api/src/socket.js', () => ({ getIO: () => null }));
vi.mock('../apps/api/src/lib/notification-service.js', () => ({
  sendNotification: vi.fn(async () => ({})),
}));
vi.mock('../apps/api/src/lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: calendarRouter } = await import('../apps/api/src/routes/calendar.js');
const { default: workspacesRouter } = await import('../apps/api/src/routes/workspaces.js');

let db: TestDatabase;
let server: Server;
let previousUrl: string | undefined;
let nilo: NiloClient;
let signedOut: NiloClient;

const scope = testScope('calendar-sdk');
const USER = `${scope}-user`;

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/calendar', calendarRouter);
  app.use('/workspaces', workspacesRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // The test's auth reads the bearer token as the user id: the SDK sends
  // whatever the host's session gives it, asked for on every request.
  nilo = createNiloClient({ baseURL, getAccessToken: () => USER });
  signedOut = createNiloClient({ baseURL, getAccessToken: () => null });
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

describe('a calendar client', () => {
  it('finds the personal workspace and its default calendar', async () => {
    const workspace = await nilo.workspaces.personal();
    expect(workspace).toMatchObject({ ownerId: USER, isPersonal: true, role: 'owner' });
    const calendars = await nilo.calendar.listCalendars();
    expect(calendars).toHaveLength(1);
    expect(calendars[0]).toMatchObject({
      workspaceId: workspace.id,
      isDefault: true,
      canEdit: true,
    });
    expect(await nilo.calendar.getCalendar(calendars[0]?.id as string)).toEqual(calendars[0]);
  });

  it('creates, reads, moves and deletes an event', async () => {
    const created = await nilo.calendar.createEvent({
      title: 'Dentist',
      start: '2026-11-12T15:00:00+01:00',
      end: '2026-11-12T15:45:00+01:00',
      location: 'Main St 1',
      colorId: 'red',
    });
    expect(created).toMatchObject({
      start: '2026-11-12T14:00:00.000Z',
      end: '2026-11-12T14:45:00.000Z',
      color: { id: 'red', color: 'red' },
    });
    const moved = await nilo.calendar.updateEvent(created.rowId, {
      start: '2026-11-13T09:00:00Z',
    });
    expect(moved).toMatchObject({
      start: '2026-11-13T09:00:00.000Z',
      end: '2026-11-13T09:45:00.000Z',
    });
    expect((await nilo.calendar.getEvent(created.rowId)).location).toBe('Main St 1');
    await nilo.calendar.deleteEvent(created.rowId);
    await expect(nilo.calendar.getEvent(created.rowId)).rejects.toMatchObject({
      code: 'gone',
      status: 410,
    });
  });

  it('walks a repeating event’s occurrences page by page', async () => {
    const series = await nilo.calendar.createEvent({
      title: 'Gym',
      allDay: true,
      start: '2026-11-02',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO,TH',
    });
    const seen: string[] = [];
    for await (const event of nilo.calendar.iterateEvents({
      from: '2026-11-01T00:00:00Z',
      to: '2026-12-01T00:00:00Z',
      limit: 2,
    })) {
      if (event.rowId === series.rowId) seen.push(event.start);
    }
    expect(seen).toEqual([
      '2026-11-02',
      '2026-11-05',
      '2026-11-09',
      '2026-11-12',
      '2026-11-16',
      '2026-11-19',
      '2026-11-23',
      '2026-11-26',
      '2026-11-30',
    ]);
  });

  it('imports a feed and exports the calendar', async () => {
    const [calendar] = await nilo.calendar.listCalendars();
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:sdk-1@example.com',
      'DTSTART:20261120T100000Z',
      'DURATION:PT1H',
      'SUMMARY:From a feed',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(await nilo.calendar.importIcs(calendar?.id as string, { ics })).toEqual({
      created: 1,
      updated: 0,
      skipped: 0,
      simplified: 0,
    });
    const exported = await nilo.calendar.exportIcs(calendar?.id as string);
    expect(exported).toContain('UID:sdk-1@example.com');
    expect(exported).toContain('SUMMARY:Gym');
  });

  it('raises typed errors', async () => {
    const invalid = await nilo.calendar
      .listEvents({
        from: '2026-11-01T00:00:00Z',
        to: '2026-12-01T00:00:00Z',
        timeZone: 'Nowhere/Land',
      })
      .catch((e: unknown) => e);
    expect(invalid).toBeInstanceOf(NiloApiError);
    expect(invalid).toMatchObject({ code: 'validation_failed', details: { field: 'timeZone' } });
    await expect(signedOut.calendar.listCalendars()).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    });
    await expect(nilo.calendar.getEvent('no-such-row')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
