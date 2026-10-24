import type { CalendarEvent } from '@oxy.so/nilo-contracts';
import { describe, expect, it } from 'vitest';
import { createNiloClient } from './client';
import {
  NiloApiError,
  NiloNetworkError,
  NiloResponseError,
  NiloTimeoutError,
  NiloValidationError,
} from './errors';

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(answer: (sent: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request: Sent = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    sent.push(request);
    return answer(request);
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'row-1',
  rowId: 'row-1',
  calendarId: 'cal-1',
  workspaceId: 'ws-1',
  title: 'Standup',
  icon: null,
  allDay: false,
  start: '2026-11-03T09:00:00.000Z',
  end: '2026-11-03T09:15:00.000Z',
  location: null,
  url: null,
  description: null,
  attendees: [],
  color: null,
  recurrence: null,
  seriesStart: null,
  uid: null,
  createdBy: 'u1',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const calendar = {
  id: 'cal-1',
  workspaceId: 'ws-1',
  name: 'Calendar',
  icon: '📅',
  isDefault: true,
  role: 'admin',
  canEdit: true,
  fields: {
    when: 'event_when',
    location: 'event_location',
    url: 'event_url',
    description: 'event_description',
    attendees: 'event_attendees',
    color: 'event_color',
    recurrence: 'event_repeat',
    uid: 'event_uid',
  },
  colors: [{ id: 'blue', name: 'Blue', color: 'blue' }],
  updatedAt: '2026-10-01T00:00:00.000Z',
};

describe('the session', () => {
  it('sends the token getAccessToken gives, asked for on every request', async () => {
    const { fetch, sent } = fakeFetch(() => json({ items: [calendar], nextCursor: null }));
    let n = 0;
    const nilo = createNiloClient({
      baseURL: 'https://api.nilo.test/',
      fetch,
      getAccessToken: async () => `token-${++n}`,
    });
    await nilo.calendar.listCalendars();
    await nilo.calendar.listCalendars({ workspaceId: 'ws-2' });
    expect(sent.map((s) => s.headers.authorization)).toEqual(['Bearer token-1', 'Bearer token-2']);
    expect(sent.map((s) => s.url)).toEqual([
      'https://api.nilo.test/calendar/calendars',
      'https://api.nilo.test/calendar/calendars?workspaceId=ws-2',
    ]);
  });

  it('adds no Authorization of its own when the fetch is a linked client’s', async () => {
    const { fetch, sent } = fakeFetch(() =>
      json({
        workspace: {
          id: 'ws-1',
          name: 'Ada',
          avatar: null,
          ownerId: 'u1',
          isPersonal: true,
          role: 'owner',
          createdAt: 'x',
        },
      }),
    );
    const nilo = createNiloClient({ baseURL: 'https://api.nilo.test', fetch });
    const workspace = await nilo.workspaces.personal();
    expect(workspace).toMatchObject({ id: 'ws-1', isPersonal: true, createdAt: 'x' });
    expect(sent[0]?.headers.authorization).toBeUndefined();
  });

  it('needs a base URL', () => {
    expect(() => createNiloClient({ baseURL: '' })).toThrow(NiloValidationError);
  });
});

describe('events', () => {
  it('asks for a range with a stable query, calendar ids as one list', async () => {
    const { fetch, sent } = fakeFetch(() => json({ items: [event()], nextCursor: null }));
    const nilo = createNiloClient({ baseURL: 'https://api.nilo.test', fetch });
    const page = await nilo.calendar.listEvents({
      to: '2026-12-01T00:00:00Z',
      from: '2026-11-01T00:00:00Z',
      calendarIds: ['b', 'a'],
      timeZone: 'Europe/Berlin',
    });
    expect(page.items[0]?.title).toBe('Standup');
    expect(sent[0]?.url).toBe(
      'https://api.nilo.test/calendar/events?calendarIds=b%2Ca&from=2026-11-01T00%3A00%3A00Z&timeZone=Europe%2FBerlin&to=2026-12-01T00%3A00%3A00Z',
    );
  });

  it('refuses a malformed range before sending it', async () => {
    const { fetch, sent } = fakeFetch(() => json({}));
    const nilo = createNiloClient({ baseURL: 'https://api.nilo.test', fetch });
    await expect(
      nilo.calendar.listEvents({ from: 'yesterday', to: '2026-12-01T00:00:00Z' }),
    ).rejects.toMatchObject({ name: 'NiloValidationError', field: 'from' });
    await expect(
      nilo.calendar.createEvent({ title: 'x', allDay: true, start: '2026-11-03T09:00:00Z' }),
    ).rejects.toBeInstanceOf(NiloValidationError);
    await expect(nilo.calendar.getEvent('..')).rejects.toBeInstanceOf(NiloValidationError);
    expect(sent).toEqual([]);
  });

  it('walks every page and stops on a repeated cursor', async () => {
    const pages = [
      { items: [event({ id: 'a' })], nextCursor: 'c1' },
      { items: [event({ id: 'b' })], nextCursor: 'c2' },
      { items: [event({ id: 'c' })], nextCursor: null },
    ];
    const { fetch, sent } = fakeFetch(() => json(pages.shift()));
    const nilo = createNiloClient({ baseURL: 'https://api.nilo.test', fetch });
    const ids: string[] = [];
    for await (const e of nilo.calendar.iterateEvents({
      from: '2026-11-01T00:00:00Z',
      to: '2026-12-01T00:00:00Z',
    })) {
      ids.push(e.id);
    }
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(sent.map((s) => new URL(s.url).searchParams.get('cursor'))).toEqual([null, 'c1', 'c2']);

    const looping = fakeFetch(() => json({ items: [], nextCursor: 'same' }));
    const loop = createNiloClient({ baseURL: 'https://api.nilo.test', fetch: looping.fetch });
    await expect(async () => {
      for await (const _ of loop.calendar.iterateEvents({
        from: '2026-11-01T00:00:00Z',
        to: '2026-12-01T00:00:00Z',
      })) {
        // drained
      }
    }).rejects.toBeInstanceOf(NiloResponseError);
  });

  it('creates, updates and deletes by row id', async () => {
    const { fetch, sent } = fakeFetch((s) =>
      s.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : json(event(), s.method === 'POST' ? 201 : 200),
    );
    const nilo = createNiloClient({ baseURL: 'https://api.nilo.test', fetch });
    await nilo.calendar.createEvent({ title: 'Standup', start: '2026-11-03T09:00:00Z' });
    await nilo.calendar.updateEvent('row-1', { start: '2026-11-04T09:00:00Z' });
    await nilo.calendar.deleteEvent('row-1');
    expect(sent.map((s) => [s.method, new URL(s.url).pathname, s.body])).toEqual([
      ['POST', '/calendar/events', { title: 'Standup', start: '2026-11-03T09:00:00Z' }],
      ['PATCH', '/calendar/events/row-1', { start: '2026-11-04T09:00:00Z' }],
      ['DELETE', '/calendar/events/row-1', undefined],
    ]);
  });

  it('reads an export as text', async () => {
    const { fetch, sent } = fakeFetch(
      () => new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', { status: 200 }),
    );
    const nilo = createNiloClient({ baseURL: 'https://api.nilo.test', fetch });
    expect(await nilo.calendar.exportIcs('cal-1')).toContain('BEGIN:VCALENDAR');
    expect(sent[0]?.headers.accept).toBe('text/calendar');
  });
});

describe('failures', () => {
  it('maps Nilo’s error body to a typed error', async () => {
    const { fetch } = fakeFetch(() =>
      json(
        {
          error: { code: 'rate_limited', message: 'Slow down', details: { retryAfterSeconds: 3 } },
        },
        429,
        { 'retry-after': '3' },
      ),
    );
    const nilo = createNiloClient({ baseURL: 'https://api.nilo.test', fetch });
    const error = await nilo.calendar.listCalendars().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NiloApiError);
    expect(error).toMatchObject({ code: 'rate_limited', status: 429, retryAfterSeconds: 3 });
  });

  it('falls back on the status for a body Nilo did not write', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'Unauthorized' }, 401));
    const nilo = createNiloClient({ baseURL: 'https://api.nilo.test', fetch });
    await expect(nilo.workspaces.personal()).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
      message: 'Unauthorized',
    });
    const proxy = fakeFetch(() => new Response('<html>bad gateway</html>', { status: 502 }));
    const behindProxy = createNiloClient({ baseURL: 'https://api.nilo.test', fetch: proxy.fetch });
    await expect(behindProxy.calendar.listCalendars()).rejects.toMatchObject({
      code: 'internal_error',
      status: 502,
    });
  });

  it('refuses an answer that does not match the contract', async () => {
    const { fetch } = fakeFetch(() => json({ items: [{ id: 1 }], nextCursor: null }));
    const nilo = createNiloClient({ baseURL: 'https://api.nilo.test', fetch });
    await expect(nilo.calendar.listCalendars()).rejects.toBeInstanceOf(NiloResponseError);
  });

  it('tells a timeout from a network failure', async () => {
    const hanging = fakeFetch(
      (s) =>
        new Promise<Response>((_, reject) => {
          void s;
          setTimeout(() => reject(new Error('aborted')), 50);
        }),
    );
    const slow = createNiloClient({
      baseURL: 'https://api.nilo.test',
      fetch: hanging.fetch,
      timeoutMs: 5,
    });
    await expect(slow.calendar.listCalendars()).rejects.toBeInstanceOf(NiloTimeoutError);
    const down = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    const offline = createNiloClient({ baseURL: 'https://api.nilo.test', fetch: down.fetch });
    await expect(offline.calendar.listCalendars()).rejects.toBeInstanceOf(NiloNetworkError);
  });
});
