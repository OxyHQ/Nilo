/**
 * Calendar subscriptions: a calendar kept in step with an outside iCalendar
 * feed (`docs/calendar.md`, `db/schema/calendar-subscriptions.ts`).
 *
 * A refresh fetches the feed (https only, every hop checked as `safeFetch`
 * does, bounded in size and time, never with a credential), conditionally
 * when the feed gave validators, and applies a document that changed: events
 * are matched on their UID, a series keeps its EXDATEs and the occurrences
 * its overrides replace as exceptions, an override is an event of its own,
 * and an event gone from the feed is deleted. The calendar is read-only to
 * everyone (`databases.read_only`), so what the feed says is what it holds.
 *
 * Every API task sweeps the due subscriptions once a minute; a refresh holds
 * `refreshing_until`, so no two tasks (or a task and a request) refresh one at
 * once. A feed is read again after its `Cache-Control` max-age, within
 * [`MIN_REFRESH_MS`, `MAX_REFRESH_MS`], `DEFAULT_REFRESH_MS` without one;
 * failures back off from `MIN_REFRESH_MS`, doubling, to `MAX_REFRESH_MS`.
 */
import { createHash } from 'node:crypto';
import {
  CALENDAR_IMPORT_MAX_BYTES,
  CALENDAR_IMPORT_MAX_EVENTS,
  type CalendarFields,
  type CalendarSubscription,
  type CalendarSubscriptionError,
} from '@oxy.so/nilo-contracts';
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { announceChange } from '../../collab/live-rooms.js';
import { getDb, type PgHandle } from '../../db/client.js';
import {
  type CalendarSubscriptionRow,
  calendarSubscriptions,
} from '../../db/schema/calendar-subscriptions.js';
import { databases } from '../../db/schema/databases.js';
import { type PageProperties, pages } from '../../db/schema/pages.js';
import { type DatabaseRecord, findDatabaseById } from '../../repositories/databases.js';
import { type PageRow, recordTombstones } from '../../repositories/pages.js';
import { insertRow, parseRowProperties, writePage } from '../databases/row-writes.js';
import { CALENDAR_PROPERTY } from '../databases/system.js';
import { log } from '../logger.js';
import {
  checkUrl,
  DEFAULT_FETCH_POLICY,
  type FetchPolicy,
  safeFetch,
  UnsafeUrlError,
} from '../safe-fetch.js';
import { type CalendarSource, EventWriteError, eventProperties } from './events.js';
import { feedKeys, openFeedUrl } from './feed-secret.js';
import { type ImportedEvent, looksLikeIcs, type ParsedIcs, parseIcs } from './ics.js';
import { formatExceptions } from './recurrence.js';

export const MIN_REFRESH_MS = 15 * 60 * 1000;
export const DEFAULT_REFRESH_MS = 30 * 60 * 1000;
export const MAX_REFRESH_MS = 24 * 60 * 60 * 1000;
/** How long a refresh may hold a subscription before another task may take it. */
export const REFRESH_LEASE_MS = 5 * 60 * 1000;
/** How often each API task looks for due subscriptions, and how many it takes at once. */
export const SWEEP_INTERVAL_MS = 60 * 1000;
const SWEEP_BATCH = 5;
const FEED_TIMEOUT_MS = 20_000;

/** Where a feed may be fetched from: public addresses, over https, on its default port. */
export const FEED_POLICY: FetchPolicy = {
  ...DEFAULT_FETCH_POLICY,
  httpsOnly: true,
  allowPort: (port) => port === '' || port === '443',
};

const USER_AGENT = 'Nilo-Calendar/1.0 (+https://nilo.so)';

/** The calendar fields of a subscribed calendar: the fixed ids its schema has. */
const SUBSCRIBED_FIELDS: CalendarFields = {
  when: CALENDAR_PROPERTY.when,
  location: CALENDAR_PROPERTY.location,
  url: CALENDAR_PROPERTY.url,
  description: CALENDAR_PROPERTY.description,
  attendees: null,
  color: null,
  recurrence: CALENDAR_PROPERTY.recurrence,
  uid: CALENDAR_PROPERTY.uid,
};

/**
 * The URL a subscription fetches: `webcal://`/`webcals://` read as `https://`,
 * and only a public https URL on its default port; throws `UnsafeUrlError`.
 */
export function normalizeFeedUrl(raw: string, policy: FetchPolicy = FEED_POLICY): URL {
  const mapped = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  const url = checkUrl(mapped, policy);
  url.hash = '';
  return url;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export interface FeedValidators {
  etag: string | null;
  lastModified: string | null;
}

export type FeedFetch =
  | { kind: 'unchanged'; validators: FeedValidators; maxAgeMs: number | null }
  | { kind: 'document'; body: string; validators: FeedValidators; maxAgeMs: number | null }
  | { kind: 'failed'; error: CalendarSubscriptionError; httpStatus: number | null };

const header = (value: string | string[] | undefined): string | null => {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim() ?? '';
  return trimmed === '' || trimmed.length > 500 ? null : trimmed;
};

/** How long the feed says its answer stays fresh (`Cache-Control: max-age`, else `Expires`). */
export function freshForMs(headers: Record<string, string | string[] | undefined>): number | null {
  const cacheControl = header(headers['cache-control'])?.toLowerCase() ?? '';
  const maxAge = /(?:^|[,\s])max-age=(\d+)/.exec(cacheControl);
  if (maxAge) return Number(maxAge[1]) * 1000;
  const expires = header(headers.expires);
  const date = header(headers.date);
  if (expires) {
    const until = Date.parse(expires);
    const now = date ? Date.parse(date) : Date.now();
    if (!Number.isNaN(until) && !Number.isNaN(now)) return Math.max(0, until - now);
  }
  return null;
}

/** When to read a feed again after a success. */
export function nextRefreshDelay(maxAgeMs: number | null): number {
  const wanted = maxAgeMs === null || maxAgeMs === 0 ? DEFAULT_REFRESH_MS : maxAgeMs;
  return Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, wanted));
}

/** When to try again after `failures` failures in a row. */
export function failureDelay(failures: number): number {
  const doublings = Math.min(Math.max(0, failures - 1), 16);
  return Math.min(MAX_REFRESH_MS, MIN_REFRESH_MS * 2 ** doublings);
}

/** GET the feed, conditionally when validators are known. Never throws. */
export async function fetchFeed(
  url: string,
  validators: FeedValidators,
  policy: FetchPolicy = FEED_POLICY,
): Promise<FeedFetch> {
  const headers: Record<string, string> = {
    accept: 'text/calendar, text/plain;q=0.5, */*;q=0.1',
    'user-agent': USER_AGENT,
  };
  if (validators.etag) headers['if-none-match'] = validators.etag;
  if (validators.lastModified) headers['if-modified-since'] = validators.lastModified;
  try {
    const res = await safeFetch(url, {
      policy,
      headers,
      timeoutMs: FEED_TIMEOUT_MS,
      maxBytes: CALENDAR_IMPORT_MAX_BYTES,
      maxRedirects: 5,
    });
    const next: FeedValidators = {
      etag: header(res.headers.etag),
      lastModified: header(res.headers['last-modified']),
    };
    const maxAgeMs = freshForMs(res.headers);
    if (res.status === 304) {
      return {
        kind: 'unchanged',
        validators: {
          etag: next.etag ?? validators.etag,
          lastModified: next.lastModified ?? validators.lastModified,
        },
        maxAgeMs,
      };
    }
    if (res.status < 200 || res.status >= 300) {
      return { kind: 'failed', error: 'http_error', httpStatus: res.status };
    }
    if (res.truncated) {
      return {
        kind: 'failed',
        error: res.bytes.length >= CALENDAR_IMPORT_MAX_BYTES ? 'too_large' : 'unreachable',
        httpStatus: res.status,
      };
    }
    if (!looksLikeIcs(res.body)) {
      return { kind: 'failed', error: 'not_a_calendar', httpStatus: res.status };
    }
    return { kind: 'document', body: res.body, validators: next, maxAgeMs };
  } catch (err: unknown) {
    if (err instanceof UnsafeUrlError) {
      return { kind: 'failed', error: 'unsafe_url', httpStatus: null };
    }
    return { kind: 'failed', error: 'unreachable', httpStatus: null };
  }
}

// ---------------------------------------------------------------------------
// Applying a document
// ---------------------------------------------------------------------------

export interface ApplyResult {
  created: number;
  updated: number;
  deleted: number;
  /** Events the calendar holds now (a series once, an override once). */
  events: number;
  simplified: number;
}

/** Equal as JSON values, whatever the order of their keys (jsonb reorders them). */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  }
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  return (
    ak.length === bk.length &&
    ak.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

interface DesiredRow {
  title: string;
  merge: PageProperties;
}

/** The key a row is matched on: the event's UID, or `<UID>#<occurrence>` for an override. */
const overrideKey = (uid: string, recurrenceId: string) => `${uid}#${recurrenceId}`;

function desiredRow(
  source: CalendarSource,
  key: string,
  event: ImportedEvent,
  exceptions: readonly string[],
): DesiredRow {
  const { properties } = eventProperties(source, {
    title: event.title,
    time: { allDay: event.allDay, start: event.start, end: event.end },
    location: event.location,
    description: event.description,
    url: event.url,
    recurrence: event.recurrence,
    uid: key,
  });
  properties[CALENDAR_PROPERTY.exceptions] = {
    text: event.recurrence ? formatExceptions(exceptions) : '',
  };
  const parsed = parseRowProperties(source.database.propertiesSchema, properties);
  if ('refusal' in parsed)
    throw new Error(`Subscribed calendar refused ${parsed.refusal.propertyId}`);
  return { title: event.title, merge: parsed.merge };
}

/** What a document asks the calendar to hold, by row key; an event Nilo cannot store is left out. */
function desiredRows(source: CalendarSource, parsed: ParsedIcs): Map<string, DesiredRow> {
  const replaced = new Map<string, string[]>();
  for (const override of parsed.overrides) {
    const list = replaced.get(override.uid) ?? [];
    list.push(override.recurrenceId);
    replaced.set(override.uid, list);
  }
  const rows = new Map<string, DesiredRow>();
  const keep = (key: string, event: ImportedEvent, exceptions: readonly string[]) => {
    try {
      rows.set(key, desiredRow(source, key, event, exceptions));
    } catch (err: unknown) {
      if (!(err instanceof EventWriteError)) throw err;
    }
  };
  for (const event of parsed.events) {
    keep(event.uid, event, [...event.exceptions, ...(replaced.get(event.uid) ?? [])]);
  }
  for (const override of parsed.overrides) {
    if (!override.event) continue;
    const key = overrideKey(override.uid, override.recurrenceId);
    keep(key, { ...override.event, recurrence: null }, []);
  }
  return rows;
}

const uidOfRow = (row: Pick<PageRow, 'properties'>) => {
  const value = row.properties[CALENDAR_PROPERTY.uid] as { text?: unknown } | undefined;
  return typeof value?.text === 'string' ? value.text : '';
};

/**
 * The calendar made to hold what `parsed` says, in one transaction: rows
 * created, changed (only those that differ) and deleted (those the feed no
 * longer has, and any duplicate of a key).
 */
export async function applyFeed(
  handle: PgHandle,
  database: DatabaseRecord,
  ownerId: string,
  parsed: ParsedIcs,
): Promise<ApplyResult> {
  const source: CalendarSource = { database, fields: SUBSCRIBED_FIELDS, role: 'owner' };
  const desired = desiredRows(source, parsed);
  const result: ApplyResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    events: desired.size,
    simplified: parsed.events.filter((e) => e.simplified).length,
  };
  await handle.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(pages)
      .where(and(eq(pages.databaseId, database.id), eq(pages.template, false)))
      .orderBy(pages.createdAt, pages.id);
    const byKey = new Map<string, PageRow>();
    const stale: string[] = [];
    for (const row of existing) {
      const key = uidOfRow(row);
      if (!desired.has(key) || byKey.has(key)) stale.push(row.id);
      else byKey.set(key, row);
    }
    for (const [key, want] of desired) {
      const row = byKey.get(key);
      if (!row) {
        await insertRow(tx, database, { ownerId, title: want.title, properties: want.merge });
        result.created += 1;
        continue;
      }
      const differs =
        row.archived ||
        row.title !== want.title ||
        Object.entries(want.merge).some(([id, value]) => !sameJson(row.properties[id], value));
      if (!differs) continue;
      await writePage(
        tx,
        row,
        {
          title: want.title,
          lastEditedBy: ownerId,
          mergeProperties: want.merge,
          ...(row.archived && { archived: false, archivedWith: null }),
        },
        { rowDatabase: database, movesTrash: false },
      );
      result.updated += 1;
    }
    if (stale.length > 0) {
      const deleted = await tx
        .delete(pages)
        .where(and(inArray(pages.id, stale), eq(pages.databaseId, database.id)))
        .returning({ id: pages.id, databaseId: pages.databaseId });
      await recordTombstones(tx, deleted);
      result.deleted = deleted.length;
    }
  });
  if (result.created + result.updated + result.deleted > 0) {
    announceChange({ workspaceId: database.workspaceId, databaseId: database.id });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Refreshing
// ---------------------------------------------------------------------------

/** Take a subscription for one refresh; null when another holds it. */
export async function claimSubscription(
  handle: PgHandle,
  databaseId: string,
  now: Date = new Date(),
): Promise<CalendarSubscriptionRow | null> {
  const [row] = await handle
    .update(calendarSubscriptions)
    .set({ refreshingUntil: new Date(now.getTime() + REFRESH_LEASE_MS) })
    .where(
      and(
        eq(calendarSubscriptions.databaseId, databaseId),
        or(
          isNull(calendarSubscriptions.refreshingUntil),
          lte(calendarSubscriptions.refreshingUntil, now),
        ),
      ),
    )
    .returning();
  return row ?? null;
}

/** Take up to `limit` due subscriptions no one holds, the most overdue first. */
export async function claimDueSubscriptions(
  handle: PgHandle,
  now: Date = new Date(),
  limit: number = SWEEP_BATCH,
): Promise<CalendarSubscriptionRow[]> {
  const due = handle
    .select({ id: calendarSubscriptions.databaseId })
    .from(calendarSubscriptions)
    .where(
      and(
        lte(calendarSubscriptions.nextRefreshAt, now),
        or(
          isNull(calendarSubscriptions.refreshingUntil),
          lte(calendarSubscriptions.refreshingUntil, now),
        ),
      ),
    )
    .orderBy(calendarSubscriptions.nextRefreshAt)
    .limit(limit)
    .for('update', { skipLocked: true });
  return handle
    .update(calendarSubscriptions)
    .set({ refreshingUntil: new Date(now.getTime() + REFRESH_LEASE_MS) })
    .where(inArray(calendarSubscriptions.databaseId, due))
    .returning();
}

export interface RefreshOptions {
  now?: Date;
  policy?: FetchPolicy;
  /** A fetch already made (the one that validated a new subscription). */
  fetched?: FeedFetch;
}

/**
 * Refresh a subscription this caller holds (`claimSubscription`), record the
 * outcome and let it go. Never throws for the feed's sake: a failure is the
 * subscription's status.
 */
export async function refreshSubscription(
  handle: PgHandle,
  subscription: CalendarSubscriptionRow,
  options: RefreshOptions = {},
): Promise<CalendarSubscriptionRow> {
  const now = options.now ?? new Date();
  const finish = async (patch: Partial<typeof calendarSubscriptions.$inferInsert>) => {
    const [row] = await handle
      .update(calendarSubscriptions)
      .set({ ...patch, lastAttemptAt: now, refreshingUntil: null })
      .where(eq(calendarSubscriptions.databaseId, subscription.databaseId))
      .returning();
    return row ?? subscription;
  };
  const fail = (error: CalendarSubscriptionError, httpStatus: number | null) => {
    const failures = subscription.consecutiveFailures + 1;
    return finish({
      status: 'failing',
      lastError: error,
      lastHttpStatus: httpStatus,
      consecutiveFailures: failures,
      nextRefreshAt: new Date(now.getTime() + failureDelay(failures)),
    });
  };
  try {
    const database = await findDatabaseById(handle, subscription.databaseId);
    if (!database) return subscription;
    const fetched =
      options.fetched ??
      (await fetchFeed(
        openFeedUrl(subscription.urlSealed),
        { etag: subscription.etag, lastModified: subscription.lastModified },
        options.policy,
      ));
    if (fetched.kind === 'failed') return await fail(fetched.error, fetched.httpStatus);
    const succeeded = {
      status: 'ok' as const,
      lastError: null,
      lastHttpStatus: null,
      consecutiveFailures: 0,
      lastSuccessAt: now,
      etag: fetched.validators.etag,
      lastModified: fetched.validators.lastModified,
      nextRefreshAt: new Date(now.getTime() + nextRefreshDelay(fetched.maxAgeMs)),
    };
    if (fetched.kind === 'unchanged') return await finish(succeeded);
    const contentHash = createHash('sha256').update(fetched.body).digest('base64url');
    if (contentHash === subscription.contentHash) {
      return await finish(succeeded);
    }
    const parsed = parseIcs(fetched.body, subscription.timeZone);
    if (parsed.events.length + parsed.overrides.length > CALENDAR_IMPORT_MAX_EVENTS) {
      return await fail('too_many_events', null);
    }
    const applied = await applyFeed(handle, database, subscription.ownerId, parsed);
    return await finish({
      ...succeeded,
      contentHash,
      eventCount: applied.events,
      simplifiedCount: applied.simplified,
      ...(applied.created + applied.updated + applied.deleted > 0 && { lastChangeAt: now }),
    });
  } catch (err: unknown) {
    log.general.error(
      { err, calendarId: subscription.databaseId },
      'Calendar subscription refresh failed',
    );
    return fail('internal', null).catch(() => subscription);
  }
}

/** Refresh the due subscriptions this task can take; returns how many it refreshed. */
export async function refreshDueSubscriptions(
  handle: PgHandle,
  options: Omit<RefreshOptions, 'fetched'> = {},
): Promise<number> {
  const claimed = await claimDueSubscriptions(handle, options.now ?? new Date());
  for (const subscription of claimed) {
    await refreshSubscription(handle, subscription, options);
  }
  return claimed.length;
}

// ---------------------------------------------------------------------------
// The API's view of a subscription
// ---------------------------------------------------------------------------

const iso = (value: Date | null) => (value ? new Date(value).toISOString() : null);

export function toSubscription(
  row: CalendarSubscriptionRow,
  database: Pick<DatabaseRecord, 'name'>,
): CalendarSubscription {
  return {
    id: row.databaseId,
    calendarId: row.databaseId,
    workspaceId: row.workspaceId,
    name: database.name,
    host: row.urlHost,
    status: row.status,
    lastError: row.lastError ?? null,
    lastHttpStatus: row.lastHttpStatus ?? null,
    eventCount: row.eventCount,
    simplified: row.simplifiedCount,
    timeZone: row.timeZone,
    lastAttemptAt: iso(row.lastAttemptAt),
    lastSuccessAt: iso(row.lastSuccessAt),
    lastChangeAt: iso(row.lastChangeAt),
    nextRefreshAt: new Date(row.nextRefreshAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/** The subscriptions of `ownerId`, each with its calendar's name, oldest first. */
export async function listSubscriptions(
  handle: PgHandle,
  ownerId: string,
  workspaceId?: string,
): Promise<CalendarSubscription[]> {
  const rows = await handle
    .select({ subscription: calendarSubscriptions, name: databases.name })
    .from(calendarSubscriptions)
    .innerJoin(databases, eq(databases.id, calendarSubscriptions.databaseId))
    .where(
      and(
        eq(calendarSubscriptions.ownerId, ownerId),
        workspaceId ? eq(calendarSubscriptions.workspaceId, workspaceId) : sql`true`,
      ),
    )
    .orderBy(calendarSubscriptions.createdAt, calendarSubscriptions.databaseId);
  return rows.map((r) => toSubscription(r.subscription, { name: r.name }));
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setInterval> | null = null;
let sweeping = false;

/**
 * Start refreshing due subscriptions in this process; idempotent. False where
 * it does not run: without `CALENDAR_FEED_KEY`, or with
 * `CALENDAR_SUBSCRIPTIONS_WORKER_ENABLED=false`.
 */
export function startCalendarSubscriptionSweep(): boolean {
  if (process.env.CALENDAR_SUBSCRIPTIONS_WORKER_ENABLED?.trim().toLowerCase() === 'false') {
    return false;
  }
  if (!feedKeys()) return false;
  if (timer) return true;
  timer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    refreshDueSubscriptions(getDb())
      .catch((err: unknown) => log.general.error({ err }, 'Calendar subscription sweep failed'))
      .finally(() => {
        sweeping = false;
      });
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  return true;
}

export function stopCalendarSubscriptionSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
