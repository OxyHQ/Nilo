/**
 * Calendar subscriptions against PostgreSQL, through the real routes, with a
 * local ICS server standing in for Google, Outlook or iCloud: a subscription
 * fills a read-only calendar (repeating events with their EXDATEs, changed
 * and cancelled occurrences), refreshes upsert by UID and delete what the feed
 * dropped, a 304 or an unchanged body writes nothing, failures keep the
 * calendar and back off, the URL never comes back or reaches the database in
 * the clear, and the SSRF rules hold at the route.
 *
 * The fetch policy is widened for the fixture's loopback address only: every
 * other private address, and http anywhere else, stays refused.
 */
import { randomBytes } from 'node:crypto';
import http, { type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type CalendarEvent,
  calendarErrorBodySchema,
  calendarEventPageSchema,
  calendarListSchema,
  calendarSubscriptionListSchema,
  calendarSubscriptionSchema,
} from '@oxy.so/nilo-contracts';
import { eq } from 'drizzle-orm';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { calendarSubscriptions } from '../../db/schema/calendar-subscriptions.js';
import { databases } from '../../db/schema/databases.js';
import { pages } from '../../db/schema/pages.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';

const emitted: { room: string; event: string; payload: unknown }[] = [];
const logged: unknown[] = [];

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
vi.mock('../../socket.js', () => ({
  getIO: () => ({
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => emitted.push({ room, event, payload }),
    }),
  }),
}));
vi.mock('../../lib/notification-service.js', () => ({ sendNotification: vi.fn(async () => ({})) }));
vi.mock('../../lib/logger.js', () => {
  const record = (...args: unknown[]) => logged.push(args);
  return { log: { general: { info: record, warn: record, error: record, debug: record } } };
});
vi.mock('../../lib/safe-fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/safe-fetch.js')>();
  const fixture = (raw: string) => {
    try {
      return new URL(raw).hostname === '127.0.0.1';
    } catch {
      return false;
    }
  };
  const widened = (policy: import('../../lib/safe-fetch.js').FetchPolicy | undefined) => ({
    ...(policy ?? actual.DEFAULT_FETCH_POLICY),
    httpsOnly: false,
    allowPort: () => true,
    allowAddress: (address: string) => address === '127.0.0.1' || actual.isPublicAddress(address),
  });
  return {
    ...actual,
    checkUrl: (raw: string, policy?: import('../../lib/safe-fetch.js').FetchPolicy) =>
      actual.checkUrl(raw, fixture(raw) ? widened(policy) : policy),
    safeFetch: (raw: string, options: import('../../lib/safe-fetch.js').SafeFetchOptions = {}) =>
      actual.safeFetch(
        raw,
        fixture(raw) ? { ...options, policy: widened(options.policy) } : options,
      ),
  };
});

process.env.CALENDAR_FEED_KEY = randomBytes(32).toString('base64');

const { default: calendarRouter } = await import('../calendar.js');
const { default: databasesRouter } = await import('../databases.js');
const { default: pagesRouter } = await import('../pages.js');
const { refreshDueSubscriptions, claimSubscription, refreshSubscription } = await import(
  '../../lib/calendar/subscriptions.js'
);

let db: TestDatabase;
let server: Server;
let feedServer: Server;
let base: string;
let feedOrigin: string;
let previousUrl: string | undefined;

const scope = testScope('calendar-subscriptions');
const ADA = `${scope}-ada`;
const BEN = `${scope}-ben`;
const SECRET_PATH = '/calendar/ical/ada%40example.com/private-7f3a9c/basic.ics';

/** What the fixture serves, by path: a body, an ETag, or a status. */
const feeds = new Map<string, { body?: string; etag?: string; status?: number; type?: string }>();
const requests: { path: string; headers: IncomingHttpHeaders }[] = [];

const vevent = (lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
const vcalendar = (name: string, events: string[][]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fixture//EN',
    `X-WR-CALNAME:${name}`,
    ...events.flat(),
    'END:VCALENDAR',
  ].join('\r\n');

const STANDUP = vevent([
  'UID:standup@example.com',
  'DTSTART;TZID=Europe/Paris:20261102T090000',
  'DTEND;TZID=Europe/Paris:20261102T091500',
  'RRULE:FREQ=WEEKLY;BYDAY=MO',
  'EXDATE;TZID=Europe/Paris:20261116T090000',
  'SUMMARY:Standup',
]);
const STANDUP_MOVED = vevent([
  'UID:standup@example.com',
  'RECURRENCE-ID;TZID=Europe/Paris:20261109T090000',
  'DTSTART;TZID=Europe/Paris:20261109T110000',
  'DTEND;TZID=Europe/Paris:20261109T111500',
  'SUMMARY:Standup (moved)',
  'LOCATION:Room 2',
]);
const STANDUP_CANCELLED = vevent([
  'UID:standup@example.com',
  'RECURRENCE-ID;TZID=Europe/Paris:20261123T090000',
  'DTSTART;TZID=Europe/Paris:20261123T090000',
  'STATUS:CANCELLED',
]);
const REVIEW = vevent([
  'UID:review@example.com',
  'DTSTART:20261105T140000Z',
  'DTEND:20261105T150000Z',
  'SUMMARY:Design review',
  'URL:https://meet.example.com/abc',
]);
const OFFSITE = vevent([
  'UID:offsite@example.com',
  'DTSTART;VALUE=DATE:20261112',
  'DTEND;VALUE=DATE:20261114',
  'SUMMARY:Offsite',
]);

const WORK = vcalendar('Work', [STANDUP, STANDUP_MOVED, STANDUP_CANCELLED, REVIEW, OFFSITE]);

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

async function eventsOf(calendarId: string, from: string, to: string, timeZone = 'Europe/Paris') {
  const params = new URLSearchParams({ from, to, calendarIds: calendarId, timeZone });
  const res = await api('GET', `/calendar/events?${params}`);
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return calendarEventPageSchema.parse(res.json).items;
}

const NOVEMBER = ['2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'] as const;
const brief = (e: CalendarEvent) => `${e.start} ${e.title}`;

/** Let the next manual refresh through: the last attempt was over a minute ago. */
async function aMinuteLater(calendarId: string) {
  await db
    .update(calendarSubscriptions)
    .set({ lastAttemptAt: new Date(Date.now() - 2 * 60 * 1000) })
    .where(eq(calendarSubscriptions.databaseId, calendarId));
}

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const app = express();
  app.use(express.json());
  app.use('/calendar', calendarRouter);
  app.use('/databases', databasesRouter);
  app.use('/pages', pagesRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  feedServer = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] as string;
    requests.push({ path, headers: req.headers });
    if (path === '/to-metadata') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }
    const feed = feeds.get(path);
    if (!feed) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (feed.status) {
      res.writeHead(feed.status);
      res.end();
      return;
    }
    if (feed.etag && req.headers['if-none-match'] === feed.etag) {
      res.writeHead(304, { etag: feed.etag });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': feed.type ?? 'text/calendar; charset=utf-8',
      ...(feed.etag && { etag: feed.etag }),
    });
    res.end(feed.body ?? '');
  });
  feedServer.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => feedServer.once('listening', resolve));
  feedOrigin = `http://127.0.0.1:${(feedServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => feedServer.close(() => resolve()));
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousUrl;
});

describe('calendar subscriptions', () => {
  let calendarId = '';

  it('is unavailable without CALENDAR_FEED_KEY', async () => {
    const key = process.env.CALENDAR_FEED_KEY;
    process.env.CALENDAR_FEED_KEY = '';
    try {
      await refused(
        api('POST', '/calendar/subscriptions', { url: `${feedOrigin}${SECRET_PATH}` }),
        503,
        'service_unavailable',
      );
    } finally {
      process.env.CALENDAR_FEED_KEY = key;
    }
  });

  it('subscribes: the feed fills a read-only calendar named after it', async () => {
    feeds.set(SECRET_PATH, { body: WORK, etag: '"w1"' });
    const res = await api('POST', '/calendar/subscriptions', {
      url: `${feedOrigin}${SECRET_PATH}`,
      timeZone: 'Europe/Paris',
    });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const subscription = calendarSubscriptionSchema.parse(res.json);
    calendarId = subscription.calendarId;
    expect(subscription).toMatchObject({
      id: calendarId,
      name: 'Work',
      host: '127.0.0.1',
      status: 'ok',
      lastError: null,
      eventCount: 4,
      simplified: 0,
      timeZone: 'Europe/Paris',
    });
    expect(res.text).not.toContain('private-7f3a9c');

    const [stored] = await db
      .select()
      .from(calendarSubscriptions)
      .where(eq(calendarSubscriptions.databaseId, calendarId));
    expect(stored?.urlSealed).not.toContain('private-7f3a9c');
    expect(stored?.urlSealed.startsWith('v1.')).toBe(true);
    expect(stored?.etag).toBe('"w1"');
    const [database] = await db.select().from(databases).where(eq(databases.id, calendarId));
    expect(database?.readOnly).toBe(true);
    expect(database?.teamspaceId).toBeNull();

    const list = calendarListSchema.parse((await api('GET', '/calendar/calendars')).json);
    expect(list.items.find((c) => c.id === calendarId)).toMatchObject({
      name: 'Work',
      subscribed: true,
      canEdit: false,
      role: 'viewer',
    });
    expect(list.items.find((c) => c.isDefault)?.subscribed).toBe(false);
  });

  it('shows the series without its EXDATE and cancelled occurrence, and the moved one where it went', async () => {
    const events = await eventsOf(calendarId, ...NOVEMBER);
    expect(events.map(brief)).toEqual([
      '2026-11-02T08:00:00.000Z Standup',
      '2026-11-05T14:00:00.000Z Design review',
      '2026-11-09T10:00:00.000Z Standup (moved)',
      '2026-11-12 Offsite',
      '2026-11-30T08:00:00.000Z Standup',
    ]);
    const moved = events.find((e) => e.title === 'Standup (moved)');
    expect(moved).toMatchObject({ location: 'Room 2', recurrence: null });
    expect(moved?.uid).toBe('standup@example.com#2026-11-09T08:00:00.000Z');
    expect(events.find((e) => e.title === 'Offsite')?.end).toBe('2026-11-14');
    expect(events.find((e) => e.title === 'Design review')?.url).toBe(
      'https://meet.example.com/abc',
    );
  });

  it("repeats a feed's series at its own zone's wall-clock time, whatever zone reads it", async () => {
    const spring = await eventsOf(
      calendarId,
      '2027-03-21T00:00:00Z',
      '2027-04-04T00:00:00Z',
      'UTC',
    );
    expect(spring.filter((e) => e.title === 'Standup').map((e) => e.start)).toEqual([
      '2027-03-22T08:00:00.000Z',
      '2027-03-29T07:00:00.000Z',
    ]);
    const november = await eventsOf(calendarId, ...NOVEMBER, 'America/New_York');
    expect(november.filter((e) => e.title === 'Standup').map((e) => e.start)).toEqual([
      '2026-11-02T08:00:00.000Z',
      '2026-11-30T08:00:00.000Z',
    ]);
  });

  it('is read-only through every route that writes', async () => {
    const [row] = await db.select().from(pages).where(eq(pages.databaseId, calendarId)).limit(1);
    const rowId = row?.id as string;
    await refused(
      api('POST', '/calendar/events', { calendarId, title: 'Mine', start: '2026-11-03T10:00:00Z' }),
      403,
      'forbidden',
    );
    await refused(
      api('PATCH', `/calendar/events/${rowId}`, { title: 'Renamed' }),
      403,
      'forbidden',
    );
    await refused(api('DELETE', `/calendar/events/${rowId}`), 403, 'forbidden');
    await refused(
      api('POST', `/calendar/calendars/${calendarId}/import`, { ics: WORK }),
      403,
      'forbidden',
    );
    expect((await api('PATCH', `/pages/${rowId}`, { title: 'Renamed' })).status).toBe(403);
    expect((await api('DELETE', `/pages/${rowId}`)).status).toBe(403);
    expect((await api('POST', `/databases/${calendarId}/rows`, { properties: {} })).status).toBe(
      403,
    );
    expect((await api('PATCH', `/databases/${calendarId}`, { name: 'Mine' })).status).toBe(403);
    expect((await api('DELETE', `/databases/${calendarId}`)).status).toBe(403);
    const read = await api('GET', `/databases/${calendarId}`);
    expect(read.status).toBe(200);
    const [unchanged] = await db.select().from(pages).where(eq(pages.id, rowId));
    expect(unchanged?.title).toBe(row?.title);
    expect(unchanged?.archived).toBe(false);
  });

  it('answers a refresh too soon after the last with rate_limited', async () => {
    const error = await refused(
      api('POST', `/calendar/subscriptions/${calendarId}/refresh`),
      429,
      'rate_limited',
    );
    expect(Number(error.details?.retryAfterSeconds)).toBeGreaterThan(0);
  });

  it('sends the ETag back and writes nothing on a 304', async () => {
    const before = await db.select().from(pages).where(eq(pages.databaseId, calendarId));
    const [was] = await db
      .select()
      .from(calendarSubscriptions)
      .where(eq(calendarSubscriptions.databaseId, calendarId));
    await aMinuteLater(calendarId);
    requests.length = 0;
    const res = await api('POST', `/calendar/subscriptions/${calendarId}/refresh`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers['if-none-match']).toBe('"w1"');
    const subscription = calendarSubscriptionSchema.parse(res.json);
    expect(subscription.status).toBe('ok');
    expect(subscription.lastChangeAt).toBe(was?.lastChangeAt?.toISOString());
    const after = await db.select().from(pages).where(eq(pages.databaseId, calendarId));
    expect(after.map((p) => [p.id, p.updatedAt.toISOString()]).sort()).toEqual(
      before.map((p) => [p.id, p.updatedAt.toISOString()]).sort(),
    );
  });

  it('writes nothing for an unchanged body from a feed with no validators', async () => {
    feeds.set(SECRET_PATH, { body: WORK });
    const before = await db.select().from(pages).where(eq(pages.databaseId, calendarId));
    await aMinuteLater(calendarId);
    const res = await api('POST', `/calendar/subscriptions/${calendarId}/refresh`);
    expect(res.status).toBe(200);
    const after = await db.select().from(pages).where(eq(pages.databaseId, calendarId));
    expect(after.map((p) => p.updatedAt.toISOString()).sort()).toEqual(
      before.map((p) => p.updatedAt.toISOString()).sort(),
    );
  });

  it('upserts by UID, deletes what the feed dropped, and tells the live room', async () => {
    const reviewRow = (await db.select().from(pages).where(eq(pages.databaseId, calendarId))).find(
      (p) => p.title === 'Design review',
    );
    const standupRow = (await db.select().from(pages).where(eq(pages.databaseId, calendarId))).find(
      (p) => p.title === 'Standup',
    );
    feeds.set(SECRET_PATH, {
      etag: '"w2"',
      body: vcalendar('Work', [
        vevent([
          'UID:standup@example.com',
          'DTSTART;TZID=Europe/Paris:20261102T093000',
          'DTEND;TZID=Europe/Paris:20261102T094500',
          'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4',
          'EXDATE;TZID=Europe/Paris:20261109T093000',
          'SUMMARY:Standup',
        ]),
        OFFSITE,
        vevent(['UID:launch@example.com', 'DTSTART:20261120T170000Z', 'SUMMARY:Launch']),
      ]),
    });
    emitted.length = 0;
    await aMinuteLater(calendarId);
    const res = await api('POST', `/calendar/subscriptions/${calendarId}/refresh`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(calendarSubscriptionSchema.parse(res.json)).toMatchObject({
      status: 'ok',
      eventCount: 3,
    });

    const events = await eventsOf(calendarId, ...NOVEMBER);
    expect(events.map(brief)).toEqual([
      '2026-11-02T08:30:00.000Z Standup',
      '2026-11-12 Offsite',
      '2026-11-16T08:30:00.000Z Standup',
      '2026-11-20T17:00:00.000Z Launch',
      '2026-11-23T08:30:00.000Z Standup',
    ]);
    const rows = await db.select().from(pages).where(eq(pages.databaseId, calendarId));
    expect(rows.find((p) => p.id === reviewRow?.id)).toBeUndefined();
    expect(rows.find((p) => p.title === 'Standup')?.id).toBe(standupRow?.id);
    expect(rows.some((p) => p.title === 'Standup (moved)')).toBe(false);

    await vi.waitFor(() =>
      expect(emitted).toContainEqual({
        room: `database:${calendarId}`,
        event: 'database:changed',
        payload: { databaseId: calendarId },
      }),
    );
  });

  it('applies nothing from a feed cut short, keeping every event', async () => {
    feeds.set(SECRET_PATH, {
      body: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:launch@example.com\r\n',
    });
    await aMinuteLater(calendarId);
    const res = await api('POST', `/calendar/subscriptions/${calendarId}/refresh`);
    expect(calendarSubscriptionSchema.parse(res.json)).toMatchObject({
      status: 'failing',
      lastError: 'incomplete',
      eventCount: 3,
    });
    expect(await eventsOf(calendarId, ...NOVEMBER)).toHaveLength(5);
  });

  it('writes nothing from a refresh whose lease another refresh has taken', async () => {
    feeds.set(SECRET_PATH, { body: vcalendar('Work', [OFFSITE]) });
    await db
      .update(calendarSubscriptions)
      .set({ refreshingUntil: null })
      .where(eq(calendarSubscriptions.databaseId, calendarId));
    const stale = await claimSubscription(db, calendarId, new Date(Date.now() - 60 * 60 * 1000));
    expect(stale).not.toBeNull();
    const current = await claimSubscription(db, calendarId);
    expect(current).not.toBeNull();
    await refreshSubscription(db, stale as NonNullable<typeof stale>);
    expect(await eventsOf(calendarId, ...NOVEMBER)).toHaveLength(5);
    const [row] = await db
      .select()
      .from(calendarSubscriptions)
      .where(eq(calendarSubscriptions.databaseId, calendarId));
    expect(row?.refreshingUntil?.getTime()).toBe(current?.refreshingUntil?.getTime());
    await db
      .update(calendarSubscriptions)
      .set({ refreshingUntil: null })
      .where(eq(calendarSubscriptions.databaseId, calendarId));
  });

  it('keeps the calendar and backs off, doubling, when the feed fails', async () => {
    feeds.set(SECRET_PATH, { status: 500 });
    await aMinuteLater(calendarId);
    const before = Date.now();
    const res = await api('POST', `/calendar/subscriptions/${calendarId}/refresh`);
    expect(res.status).toBe(200);
    const subscription = calendarSubscriptionSchema.parse(res.json);
    expect(subscription).toMatchObject({
      status: 'failing',
      lastError: 'http_error',
      lastHttpStatus: 500,
      eventCount: 3,
    });
    const next = Date.parse(subscription.nextRefreshAt) - before;
    // The second failure in a row (the cut feed was the first): 15 minutes, doubled.
    expect(next).toBeGreaterThan(29 * 60 * 1000);
    expect(next).toBeLessThan(31 * 60 * 1000);
    expect(await eventsOf(calendarId, ...NOVEMBER)).toHaveLength(5);
  });

  it('is refreshed by the sweep when due, one task at a time', async () => {
    feeds.set(SECRET_PATH, { body: WORK, etag: '"w3"' });
    await db
      .update(calendarSubscriptions)
      .set({ nextRefreshAt: new Date(Date.now() - 1000), refreshingUntil: null })
      .where(eq(calendarSubscriptions.databaseId, calendarId));
    const held = await claimSubscription(db, calendarId);
    expect(held).not.toBeNull();
    expect(await claimSubscription(db, calendarId)).toBeNull();
    await db
      .update(calendarSubscriptions)
      .set({ refreshingUntil: null })
      .where(eq(calendarSubscriptions.databaseId, calendarId));
    expect(await refreshDueSubscriptions(db)).toBeGreaterThanOrEqual(1);
    const [row] = await db
      .select()
      .from(calendarSubscriptions)
      .where(eq(calendarSubscriptions.databaseId, calendarId));
    expect(row).toMatchObject({ status: 'ok', etag: '"w3"', refreshingUntil: null });
    expect(row?.nextRefreshAt.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
    expect((await eventsOf(calendarId, ...NOVEMBER)).map((e) => e.title)).toContain(
      'Standup (moved)',
    );
  });

  it('refuses a second subscription to the same feed', async () => {
    const error = await refused(
      api('POST', '/calendar/subscriptions', { url: `${feedOrigin}${SECRET_PATH}` }),
      409,
      'conflict',
    );
    expect(error.details?.calendarId).toBe(calendarId);
  });

  it('refuses URLs Nilo does not fetch, before and after redirects', async () => {
    for (const url of [
      'https://169.254.169.254/latest/meta-data/',
      'https://10.0.0.4/feed.ics',
      'https://localhost/feed.ics',
      'http://calendar.example.com/feed.ics',
      'https://calendar.example.com:8443/feed.ics',
      'https://ada:pw@calendar.example.com/feed.ics',
    ]) {
      const error = await refused(
        api('POST', '/calendar/subscriptions', { url }),
        422,
        'validation_failed',
      );
      expect(error.details?.field, url).toBe('url');
    }
    const error = await refused(
      api('POST', '/calendar/subscriptions', { url: `${feedOrigin}/to-metadata` }),
      422,
      'validation_failed',
    );
    expect(error.details?.field).toBe('url');
  });

  it('refuses a URL that does not answer with a calendar, making nothing', async () => {
    feeds.set('/page.html', { body: '<html></html>', type: 'text/html' });
    const error = await refused(
      api('POST', '/calendar/subscriptions', { url: `${feedOrigin}/page.html` }),
      422,
      'import_unreachable',
    );
    expect(error.details?.reason).toBe('not_a_calendar');
    const mine = calendarSubscriptionListSchema.parse(
      (await api('GET', '/calendar/subscriptions')).json,
    );
    expect(mine.items.map((s) => s.id)).toEqual([calendarId]);
  });

  it("is the subscriber's alone: anyone else is told it does not exist", async () => {
    expect(
      calendarSubscriptionListSchema.parse(
        (await api('GET', '/calendar/subscriptions', undefined, BEN)).json,
      ).items,
    ).toEqual([]);
    await refused(
      api('GET', `/calendar/subscriptions/${calendarId}`, undefined, BEN),
      404,
      'not_found',
    );
    await refused(
      api('POST', `/calendar/subscriptions/${calendarId}/refresh`, undefined, BEN),
      404,
      'not_found',
    );
    await refused(
      api('DELETE', `/calendar/subscriptions/${calendarId}`, undefined, BEN),
      404,
      'not_found',
    );
    await refused(
      api('GET', `/calendar/calendars/${calendarId}`, undefined, BEN),
      404,
      'not_found',
    );
  });

  it('renames the calendar', async () => {
    const res = await api('PATCH', `/calendar/subscriptions/${calendarId}`, {
      name: 'Work (Google)',
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(calendarSubscriptionSchema.parse(res.json).name).toBe('Work (Google)');
    const calendar = await api('GET', `/calendar/calendars/${calendarId}`);
    expect(calendar.json.name).toBe('Work (Google)');
  });

  it('exports the series with its exceptions', async () => {
    const res = await api('GET', `/calendar/calendars/${calendarId}/export.ics`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('EXDATE:20261109T080000Z,20261116T080000Z,20261123T080000Z');
  });

  it('never logged the URL', () => {
    expect(JSON.stringify(logged)).not.toContain('private-7f3a9c');
  });

  it('unsubscribes: the calendar and its events are deleted', async () => {
    expect((await api('DELETE', `/calendar/subscriptions/${calendarId}`)).status).toBe(204);
    expect(await db.select().from(databases).where(eq(databases.id, calendarId))).toEqual([]);
    expect(await db.select().from(pages).where(eq(pages.databaseId, calendarId))).toEqual([]);
    expect(
      await db
        .select()
        .from(calendarSubscriptions)
        .where(eq(calendarSubscriptions.databaseId, calendarId)),
    ).toEqual([]);
    await refused(api('GET', `/calendar/subscriptions/${calendarId}`), 404, 'not_found');
  });
});
