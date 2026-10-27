/**
 * `createNiloClient`: Nilo's API for another Oxy app, with the caller's Oxy
 * session.
 *
 * The session stays the host app's. Pass the origin-bound `fetch` of a linked
 * client (`oxyServices.createLinkedClient({ baseURL }).fetch`, from
 * `@oxy.so/core`): it carries the session's bearer token and refreshes it on
 * a 401, as every Oxy app's backend client does. Or pass `getAccessToken`,
 * called before every request and never kept. The client holds no token.
 *
 * Every response is checked against `@oxy.so/nilo-contracts` before it is
 * returned, and every input before it is sent.
 */
import {
  type Calendar,
  type CalendarEvent,
  type CalendarEventCreate,
  type CalendarEventPage,
  type CalendarEventsQuery,
  type CalendarEventUpdate,
  type CalendarImportRequest,
  type CalendarImportResult,
  CALENDAR_ERROR_CODES,
  type CalendarErrorCode,
  calendarErrorBodySchema,
  calendarEventCreateSchema,
  calendarEventPageSchema,
  calendarEventSchema,
  calendarEventsQuerySchema,
  calendarEventUpdateSchema,
  calendarImportRequestSchema,
  calendarImportResultSchema,
  calendarListSchema,
  calendarSchema,
  type CalendarSubscription,
  type CalendarSubscriptionCreate,
  calendarSubscriptionCreateSchema,
  calendarSubscriptionListSchema,
  calendarSubscriptionSchema,
  type CalendarSubscriptionUpdate,
  calendarSubscriptionUpdateSchema,
  type NiloWorkspace,
  niloWorkspaceSchema,
} from '@oxy.so/nilo-contracts';
import { z } from 'zod';
import {
  NiloApiError,
  NiloNetworkError,
  NiloResponseError,
  NiloTimeoutError,
  NiloValidationError,
} from './errors';

export type NiloFetch = typeof globalThis.fetch;

export type NiloAccessTokenGetter = () =>
  | string
  | null
  | undefined
  | Promise<string | null | undefined>;

export interface NiloClientOptions {
  /** The Nilo API's origin, e.g. `https://api.nilo.so`. There is no default. */
  baseURL: string;
  /**
   * The fetch to send requests with. Pass a linked client's `fetch` so the
   * session (and its refresh) stays in Oxy's SDK. Defaults to the global one.
   */
  fetch?: NiloFetch;
  /** The caller's Oxy access token, asked for before every request; for a plain `fetch`. */
  getAccessToken?: NiloAccessTokenGetter;
  /** Abort a request after this long. Default 30 s. */
  timeoutMs?: number;
  /** Extra headers on every request (never `Authorization`: that is the session's). */
  headers?: Readonly<Record<string, string>>;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/** `GET /calendar/events`'s query, with `calendarIds` as a list or comma-separated. */
export type EventsQuery = Omit<CalendarEventsQuery, 'calendarIds'> & {
  calendarIds?: readonly string[] | string;
};

type QueryValue = string | number | readonly string[] | undefined;

/** `a=1&b=x` with keys sorted and `undefined` left out; a list is one comma-joined value. */
export function serializeQuery(query: Readonly<Record<string, QueryValue>>): string {
  const parts: string[] = [];
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value === undefined) continue;
    const text = Array.isArray(value) ? value.join(',') : String(value);
    if (Array.isArray(value) && value.length === 0) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(text)}`);
  }
  return parts.join('&');
}

function segment(id: string, what: string): string {
  if (id === '' || id === '.' || id === '..') {
    throw new NiloValidationError(`${what} must be an id`, what);
  }
  return encodeURIComponent(id);
}

function checked<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new NiloValidationError(
    issue?.message ?? 'Invalid input',
    issue && issue.path.length > 0 ? issue.path.join('.') : null,
  );
}

const STATUS_CODES: Record<number, CalendarErrorCode> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  410: 'gone',
  422: 'validation_failed',
  423: 'locked',
  429: 'rate_limited',
  503: 'service_unavailable',
};

function retryAfter(headers: Headers): number | null {
  const value = headers.get('retry-after');
  if (value && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * The typed error for a non-2xx answer. Nilo's own error body decides the
 * code; a body Nilo did not write (a proxy, or one of the older routes that
 * answer `{ error: "text" }`) falls back on the status.
 */
function errorFor(status: number, headers: Headers, body: unknown): NiloApiError {
  const parsed = calendarErrorBodySchema.safeParse(body);
  if (parsed.success) {
    const { code, message, details } = parsed.data.error;
    return new NiloApiError(code, message, status, details ?? {}, retryAfter(headers));
  }
  const raw = (body as { error?: unknown } | null)?.error;
  const rawCode = (raw as { code?: unknown } | null)?.code;
  const code: CalendarErrorCode =
    typeof rawCode === 'string' && (CALENDAR_ERROR_CODES as readonly string[]).includes(rawCode)
      ? (rawCode as CalendarErrorCode)
      : (STATUS_CODES[status] ?? (status >= 500 ? 'internal_error' : 'bad_request'));
  const message = typeof raw === 'string' ? raw.slice(0, 200) : `Nilo answered ${status}`;
  return new NiloApiError(code, message, status, {}, retryAfter(headers));
}

function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end--;
  return url.slice(0, end);
}

export function createNiloClient(options: NiloClientOptions) {
  if (!options?.baseURL) throw new NiloValidationError('baseURL is required', 'baseURL');
  const baseURL = withoutTrailingSlashes(options.baseURL);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const fallback: NiloFetch | undefined = globalThis.fetch?.bind(globalThis);
  const maybeSend = options.fetch ?? fallback;
  if (!maybeSend) throw new NiloValidationError('No fetch is available: pass one', 'fetch');
  const send: NiloFetch = maybeSend;

  async function request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    init: {
      query?: Readonly<Record<string, QueryValue>>;
      body?: unknown;
      accept?: string;
    } & RequestOptions = {},
  ): Promise<{ status: number; text: string; json: unknown; headers: Headers }> {
    const query = init.query ? serializeQuery(init.query) : '';
    const url = `${baseURL}${path}${query ? `?${query}` : ''}`;
    const headers: Record<string, string> = {
      accept: init.accept ?? 'application/json',
      ...options.headers,
    };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    const token = options.getAccessToken ? await options.getAccessToken() : null;
    if (token) headers.authorization = `Bearer ${token}`;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    init.signal?.addEventListener('abort', onAbort, { once: true });
    let response: Response;
    let text: string;
    try {
      response = await send(url, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (err: unknown) {
      if (timedOut) throw new NiloTimeoutError(`Nilo did not answer within ${timeoutMs} ms`);
      throw new NiloNetworkError(
        init.signal?.aborted ? 'The request was aborted' : 'Nilo could not be reached',
        err,
      );
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', onAbort);
    }
    let json: unknown;
    try {
      json = text === '' ? undefined : JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (!response.ok) throw errorFor(response.status, response.headers, json);
    return { status: response.status, text, json, headers: response.headers };
  }

  function parse<T extends z.ZodTypeAny>(schema: T, answer: { status: number; json: unknown }) {
    const parsed = schema.safeParse(answer.json);
    if (!parsed.success) {
      throw new NiloResponseError(
        `Nilo's answer does not match the contract (${parsed.error.issues[0]?.path.join('.') || 'body'})`,
        answer.status,
      );
    }
    return parsed.data as z.output<T>;
  }

  const workspaces = {
    /** The caller's personal workspace, made on the spot when it does not exist yet. */
    async personal(opts: RequestOptions = {}): Promise<NiloWorkspace> {
      const answer = await request('GET', '/workspaces/personal', opts);
      return parse(z.object({ workspace: niloWorkspaceSchema }), answer).workspace;
    },
  };

  const calendar = {
    /**
     * The calendars of a workspace the caller can read, the personal
     * workspace's (its default calendar first, made on first use) when none is named.
     */
    async listCalendars(
      query: { workspaceId?: string } = {},
      opts: RequestOptions = {},
    ): Promise<Calendar[]> {
      const answer = await request('GET', '/calendar/calendars', { ...opts, query });
      return parse(calendarListSchema, answer).items;
    },

    async getCalendar(id: string, opts: RequestOptions = {}): Promise<Calendar> {
      const answer = await request('GET', `/calendar/calendars/${segment(id, 'id')}`, opts);
      return parse(calendarSchema, answer);
    },

    /** One page of the events overlapping `[from, to)`, by start. */
    async listEvents(query: EventsQuery, opts: RequestOptions = {}): Promise<CalendarEventPage> {
      const checkedQuery = checked(calendarEventsQuerySchema, {
        ...query,
        calendarIds:
          typeof query.calendarIds === 'string' || query.calendarIds === undefined
            ? query.calendarIds
            : query.calendarIds.join(','),
      });
      const answer = await request('GET', '/calendar/events', {
        ...opts,
        query: {
          from: checkedQuery.from,
          to: checkedQuery.to,
          calendarIds: checkedQuery.calendarIds,
          workspaceId: checkedQuery.workspaceId,
          timeZone: checkedQuery.timeZone,
          limit: query.limit === undefined ? undefined : checkedQuery.limit,
          cursor: checkedQuery.cursor,
        },
      });
      return parse(calendarEventPageSchema, answer);
    },

    /** Every event overlapping `[from, to)`, page after page. Throws if a cursor repeats. */
    async *iterateEvents(
      query: Omit<EventsQuery, 'cursor'>,
      opts: RequestOptions = {},
    ): AsyncGenerator<CalendarEvent, void, undefined> {
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await calendar.listEvents({ ...query, cursor }, opts);
        yield* page.items;
        if (page.nextCursor !== null && seen.has(page.nextCursor)) {
          throw new NiloResponseError('Nilo repeated a cursor', 200);
        }
        if (page.nextCursor !== null) seen.add(page.nextCursor);
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
    },

    /** An event as its series: what `rowId` names. */
    async getEvent(rowId: string, opts: RequestOptions = {}): Promise<CalendarEvent> {
      const answer = await request('GET', `/calendar/events/${segment(rowId, 'rowId')}`, opts);
      return parse(calendarEventSchema, answer);
    },

    /** A new event, in `calendarId` or the personal workspace's default calendar. */
    async createEvent(
      input: CalendarEventCreate,
      opts: RequestOptions = {},
    ): Promise<CalendarEvent> {
      checked(calendarEventCreateSchema, input);
      const answer = await request('POST', '/calendar/events', { ...opts, body: input });
      return parse(calendarEventSchema, answer);
    },

    /** Change the fields sent; a repeating event changes as a whole series. */
    async updateEvent(
      rowId: string,
      patch: CalendarEventUpdate,
      opts: RequestOptions = {},
    ): Promise<CalendarEvent> {
      checked(calendarEventUpdateSchema, patch);
      const answer = await request('PATCH', `/calendar/events/${segment(rowId, 'rowId')}`, {
        ...opts,
        body: patch,
      });
      return parse(calendarEventSchema, answer);
    },

    /** Into Nilo's trash; deleting an event already there succeeds too. */
    async deleteEvent(rowId: string, opts: RequestOptions = {}): Promise<void> {
      await request('DELETE', `/calendar/events/${segment(rowId, 'rowId')}`, opts);
    },

    /** The calendar as an iCalendar document. */
    async exportIcs(calendarId: string, opts: RequestOptions = {}): Promise<string> {
      const answer = await request(
        'GET',
        `/calendar/calendars/${segment(calendarId, 'calendarId')}/export.ics`,
        { ...opts, accept: 'text/calendar' },
      );
      return answer.text;
    },

    /** Events from an iCalendar document or a public feed URL, matched on their UID. */
    async importIcs(
      calendarId: string,
      input: CalendarImportRequest,
      opts: RequestOptions = {},
    ): Promise<CalendarImportResult> {
      checked(calendarImportRequestSchema, input);
      const answer = await request(
        'POST',
        `/calendar/calendars/${segment(calendarId, 'calendarId')}/import`,
        { ...opts, body: input },
      );
      return parse(calendarImportResultSchema, answer);
    },

    /** The caller's calendar subscriptions, in `workspaceId` when one is named. */
    async listSubscriptions(
      query: { workspaceId?: string } = {},
      opts: RequestOptions = {},
    ): Promise<CalendarSubscription[]> {
      const answer = await request('GET', '/calendar/subscriptions', { ...opts, query });
      return parse(calendarSubscriptionListSchema, answer).items;
    },

    async getSubscription(id: string, opts: RequestOptions = {}): Promise<CalendarSubscription> {
      const answer = await request('GET', `/calendar/subscriptions/${segment(id, 'id')}`, opts);
      return parse(calendarSubscriptionSchema, answer);
    },

    /**
     * Subscribe to a calendar's secret iCal URL (`https://` or `webcal://`):
     * a new read-only calendar Nilo keeps in step with it. The URL is never
     * given back.
     */
    async subscribe(
      input: CalendarSubscriptionCreate,
      opts: RequestOptions = {},
    ): Promise<CalendarSubscription> {
      checked(calendarSubscriptionCreateSchema, input);
      const answer = await request('POST', '/calendar/subscriptions', { ...opts, body: input });
      return parse(calendarSubscriptionSchema, answer);
    },

    async updateSubscription(
      id: string,
      patch: CalendarSubscriptionUpdate,
      opts: RequestOptions = {},
    ): Promise<CalendarSubscription> {
      checked(calendarSubscriptionUpdateSchema, patch);
      const answer = await request('PATCH', `/calendar/subscriptions/${segment(id, 'id')}`, {
        ...opts,
        body: patch,
      });
      return parse(calendarSubscriptionSchema, answer);
    },

    /** Read the feed now (at most once a minute); a feed that failed is the answer's `status`. */
    async refreshSubscription(
      id: string,
      opts: RequestOptions = {},
    ): Promise<CalendarSubscription> {
      const answer = await request(
        'POST',
        `/calendar/subscriptions/${segment(id, 'id')}/refresh`,
        opts,
      );
      return parse(calendarSubscriptionSchema, answer);
    },

    /** Unsubscribe: the subscribed calendar and its events are deleted. */
    async unsubscribe(id: string, opts: RequestOptions = {}): Promise<void> {
      await request('DELETE', `/calendar/subscriptions/${segment(id, 'id')}`, opts);
    },
  };

  return { workspaces, calendar };
}

export type NiloClient = ReturnType<typeof createNiloClient>;
