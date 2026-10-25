/**
 * `/calendar`: calendars and their events, for Nilo and for other Oxy apps
 * (Astro first) through `@oxy.so/nilo` (`docs/calendar.md`). Contract:
 * `@oxy.so/nilo-contracts` `calendar.ts`.
 *
 * A calendar is a database whose own calendar view sits on a date property
 * (`lib/calendar/recognition.ts`); an event is one of its rows. Reads follow
 * the database's access rule, writes the row's, and every write goes through
 * the same row path as `PATCH /pages/:id` and `POST /databases/:id/rows`
 * (`lib/databases/row-writes.ts`): history, activity, two-way relations,
 * `assigned` notifications and the database's live room all follow.
 *
 * Errors are Oxy's conventional `{ error: { code, message, details? } }`.
 */
import {
  CALENDAR_IMPORT_MAX_BYTES,
  CALENDAR_IMPORT_MAX_EVENTS,
  CALENDAR_MAX_IDS,
  CALENDAR_MAX_RANGE_DAYS,
  CALENDAR_SUBSCRIPTION_MANUAL_REFRESH_SECONDS,
  CALENDAR_SUBSCRIPTIONS_MAX,
  type CalendarErrorCode,
  type CalendarEventPage,
  type CalendarImportResult,
  type CalendarList,
  type CalendarRole,
  calendarEventCreateSchema,
  calendarEventsQuerySchema,
  calendarEventUpdateSchema,
  calendarImportRequestSchema,
  calendarListQuerySchema,
  type CalendarSubscriptionList,
  calendarSubscriptionCreateSchema,
  calendarSubscriptionListQuerySchema,
  calendarSubscriptionUpdateSchema,
} from '@oxy.so/nilo-contracts';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { announceChange } from '../collab/live-rooms.js';
import { getDb, type PgHandle } from '../db/client.js';
import {
  type CalendarSubscriptionRow,
  calendarSubscriptions,
} from '../db/schema/calendar-subscriptions.js';
import { databaseViews } from '../db/schema/databases.js';
import { pages } from '../db/schema/pages.js';
import { hasRole } from '../db/schema/workspaces.js';
import {
  type EventWrite,
  EventWriteError,
  eventOf,
  eventProperties,
  mergedTime,
  readEventTime,
  rowExceptionsText,
  type CalendarSource,
  toCalendar,
} from '../lib/calendar/events.js';
import { feedFingerprint, feedKeys, sealFeedUrl } from '../lib/calendar/feed-secret.js';
import { eventsToIcs, looksLikeIcs, parseIcs } from '../lib/calendar/ics.js';
import {
  cursorFingerprint,
  decodeEventsCursor,
  encodeEventsCursor,
  listEvents,
} from '../lib/calendar/query.js';
import { recogniseCalendar } from '../lib/calendar/recognition.js';
import {
  claimSubscription,
  fetchFeed,
  listSubscriptions,
  normalizeFeedUrl,
  refreshSubscription,
  toSubscription,
} from '../lib/calendar/subscriptions.js';
import { DAY_MS, isTimeZone, localDayNumber } from '../lib/calendar/zoned-time.js';
import { invalidReference } from '../lib/databases/property-references.js';
import {
  insertRow,
  parseRowProperties,
  rowWritten,
  writePage,
} from '../lib/databases/row-writes.js';
import {
  createSubscribedCalendarDatabase,
  ensureCalendarDatabase,
} from '../lib/databases/system.js';
import { log } from '../lib/logger.js';
import {
  baseRole,
  loadViewer,
  readOnlyCapped,
  resolveDatabaseRole,
  resolvePageAccess,
} from '../lib/page-access.js';
import { rateLimit } from '../lib/rate-limit.js';
import { safeFetch, UnsafeUrlError } from '../lib/safe-fetch.js';
import { authenticateToken } from '../middleware/auth.js';
import { ensurePersonalWorkspaceFor } from '../middleware/workspace.js';
import {
  type DatabaseRecord,
  deleteDatabase,
  findDatabaseById,
  listDatabasesByWorkspace,
  listViewsByDatabase,
  updateDatabase,
} from '../repositories/databases.js';
import {
  deleteDatabaseRows,
  findPageById,
  type PageRow,
  recordTombstones,
} from '../repositories/pages.js';
import {
  findLiveWorkspaceById,
  findMembership,
  type WorkspaceRow,
} from '../repositories/workspaces.js';

const router = Router();
router.use(authenticateToken);

const STATUS: Record<CalendarErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  unknown_route: 404,
  gone: 410,
  conflict: 409,
  validation_failed: 422,
  rate_limited: 429,
  internal_error: 500,
  service_unavailable: 503,
  not_a_calendar: 422,
  locked: 423,
  import_unreachable: 422,
};

/** A refusal: thrown anywhere below a route, answered by `answerError`. */
class CalendarError extends Error {
  constructor(
    readonly code: CalendarErrorCode,
    message: string,
    readonly details?: Record<string, string | number | boolean | null>,
  ) {
    super(message);
  }
}

function send(res: Response, error: CalendarError): void {
  res.status(STATUS[error.code]).json({
    error: {
      code: error.code,
      message: error.message,
      ...(error.details && { details: error.details }),
    },
  });
}

/**
 * A malformed request (an unknown or repeated parameter, a wrong type, a
 * missing field) is `bad_request`; well-formed values refused are
 * `validation_failed`.
 */
function fromZod(error: z.ZodError): CalendarError {
  const issue = error.issues[0];
  const malformed = error.issues.some(
    (i) => i.code === 'unrecognized_keys' || i.code === 'invalid_type',
  );
  return new CalendarError(
    malformed ? 'bad_request' : 'validation_failed',
    issue?.message ?? 'Invalid request',
    issue && issue.path.length > 0 ? { field: issue.path.join('.') } : undefined,
  );
}

function answerError(res: Response, error: unknown, what: string): void {
  if (error instanceof CalendarError) {
    send(res, error);
  } else if (error instanceof z.ZodError) {
    send(res, fromZod(error));
  } else if (error instanceof EventWriteError) {
    send(res, new CalendarError('validation_failed', error.message, { field: error.field }));
  } else {
    log.general.error({ err: error }, `Calendar: failed to ${what}`);
    send(res, new CalendarError('internal_error', `Failed to ${what}`));
  }
}

const userOf = (req: Request): string => {
  const id = req.user?.id;
  if (!id) throw new CalendarError('unauthorized', 'Sign in to use calendars');
  return id;
};

// ---------------------------------------------------------------------------
// Calendars
// ---------------------------------------------------------------------------

/**
 * The workspace a request means: the caller's personal one when it names
 * none (its calendar made on first use), else one they are a member of.
 */
async function workspaceFor(
  handle: PgHandle,
  userId: string,
  workspaceId: string | undefined,
): Promise<WorkspaceRow> {
  if (!workspaceId) {
    const personal = await ensurePersonalWorkspaceFor(userId);
    await ensureCalendarDatabase(handle, personal);
    return personal;
  }
  const workspace = await findLiveWorkspaceById(handle, workspaceId);
  if (!workspace) throw new CalendarError('not_found', 'Workspace not found');
  if (!(await findMembership(handle, workspace.id, userId))) {
    throw new CalendarError('forbidden', 'Not a member of this workspace');
  }
  if (workspace.isPersonal && workspace.ownerId === userId) {
    await ensureCalendarDatabase(handle, workspace);
  }
  return workspace;
}

/** The calendars of a workspace the caller can read: the default first, then by name. */
async function calendarsOf(
  handle: PgHandle,
  workspace: WorkspaceRow,
  userId: string,
): Promise<CalendarSource[]> {
  const databases = await listDatabasesByWorkspace(handle, {
    workspaceId: workspace.id,
    includeArchived: false,
  });
  if (databases.length === 0) return [];
  const views = await handle
    .select({
      databaseId: databaseViews.databaseId,
      type: databaseViews.type,
      blockId: databaseViews.blockId,
      config: databaseViews.config,
      order: databaseViews.order,
    })
    .from(databaseViews)
    .where(
      and(
        inArray(
          databaseViews.databaseId,
          databases.map((d) => d.id),
        ),
        eq(databaseViews.type, 'calendar'),
        isNull(databaseViews.blockId),
      ),
    );
  const viewer = await loadViewer(handle, workspace.id, userId);
  const sources: CalendarSource[] = [];
  for (const database of databases) {
    const fields = recogniseCalendar(
      database,
      views.filter((v) => v.databaseId === database.id),
    );
    if (!fields) continue;
    const role = readOnlyCapped(
      database.parentPageId
        ? ((await resolvePageAccess(handle, userId, database.parentPageId))?.role ?? null)
        : baseRole(viewer, { teamspaceId: database.teamspaceId, ownerId: database.ownerId }).role,
      database.readOnly,
    );
    if (role) sources.push({ database, fields, role: role as CalendarRole });
  }
  return sources.sort(
    (a, b) =>
      Number(b.database.systemKey === 'calendar') - Number(a.database.systemKey === 'calendar') ||
      a.database.name.localeCompare(b.database.name),
  );
}

/** One calendar the caller can read; `not_found` when they cannot, `not_a_calendar` when it is not one. */
async function loadCalendar(
  handle: PgHandle,
  userId: string,
  databaseId: string,
  database?: DatabaseRecord | null,
): Promise<CalendarSource> {
  const found = database ?? (await findDatabaseById(handle, databaseId));
  if (!found || found.archived) throw new CalendarError('not_found', 'Calendar not found');
  const role = await resolveDatabaseRole(handle, userId, found);
  if (!role) throw new CalendarError('not_found', 'Calendar not found');
  const fields = recogniseCalendar(found, await listViewsByDatabase(handle, found.id));
  if (!fields) {
    throw new CalendarError(
      'not_a_calendar',
      'This database has no calendar view on a date property',
    );
  }
  return { database: found, fields, role: role as CalendarRole };
}

const requireEditor = (source: CalendarSource) => {
  if (source.database.readOnly) {
    throw new CalendarError(
      'forbidden',
      'This calendar is a subscription to another calendar: it is read-only',
    );
  }
  if (!hasRole(source.role, 'editor')) {
    throw new CalendarError('forbidden', 'Editing this calendar needs edit access');
  }
};

/** GET /calendar/calendars?workspaceId — the calendars the caller can read. */
router.get('/calendars', async (req: Request, res: Response) => {
  try {
    const userId = userOf(req);
    const query = calendarListQuerySchema.parse(req.query);
    const handle = getDb();
    const workspace = await workspaceFor(handle, userId, query.workspaceId);
    const body: CalendarList = {
      items: (await calendarsOf(handle, workspace, userId)).map(toCalendar),
      nextCursor: null,
    };
    res.json(body);
  } catch (error: unknown) {
    answerError(res, error, 'list calendars');
  }
});

const idSchema = z.object({ id: z.string().min(1).max(100) }).strict();

/** GET /calendar/calendars/:id — one calendar. */
router.get('/calendars/:id', async (req: Request, res: Response) => {
  try {
    const userId = userOf(req);
    const { id } = idSchema.parse(req.params);
    res.json(toCalendar(await loadCalendar(getDb(), userId, id)));
  } catch (error: unknown) {
    answerError(res, error, 'read a calendar');
  }
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** GET /calendar/events?from&to[&calendarIds][&workspaceId][&timeZone][&limit][&cursor] */
router.get('/events', async (req: Request, res: Response) => {
  try {
    const userId = userOf(req);
    const query = calendarEventsQuerySchema.parse(req.query);
    const timeZone = query.timeZone ?? 'UTC';
    if (!isTimeZone(timeZone)) {
      throw new CalendarError('validation_failed', 'Unknown time zone', { field: 'timeZone' });
    }
    const fromMs = Date.parse(query.from);
    const toMs = Date.parse(query.to);
    if (toMs <= fromMs) {
      throw new CalendarError('validation_failed', 'to must be after from', { field: 'to' });
    }
    if (toMs - fromMs > CALENDAR_MAX_RANGE_DAYS * DAY_MS) {
      throw new CalendarError(
        'validation_failed',
        `A range spans at most ${CALENDAR_MAX_RANGE_DAYS} days`,
        { field: 'to' },
      );
    }
    if (query.calendarIds && query.calendarIds.length > CALENDAR_MAX_IDS) {
      throw new CalendarError('validation_failed', `At most ${CALENDAR_MAX_IDS} calendars`, {
        field: 'calendarIds',
      });
    }
    if (query.calendarIds && query.workspaceId) {
      throw new CalendarError('bad_request', 'Send calendarIds or workspaceId, not both');
    }
    const handle = getDb();
    const sources = query.calendarIds?.length
      ? await Promise.all(query.calendarIds.map((id) => loadCalendar(handle, userId, id)))
      : await calendarsOf(handle, await workspaceFor(handle, userId, query.workspaceId), userId);
    const window = {
      fromMs,
      toMs,
      firstDay: localDayNumber(fromMs, timeZone),
      endDay: localDayNumber(toMs - 1, timeZone) + 1,
      timeZone,
    };
    const fingerprint = cursorFingerprint({
      calendarIds: query.calendarIds?.length
        ? query.calendarIds
        : [`workspace:${query.workspaceId ?? 'personal'}`],
      window,
    });
    const cursor = query.cursor ? decodeEventsCursor(query.cursor, fingerprint) : null;
    if (query.cursor && !cursor) {
      throw new CalendarError('bad_request', 'The cursor is not one this list issued', {
        field: 'cursor',
      });
    }
    const { entries, more } = await listEvents(handle, {
      sources,
      window,
      limit: query.limit,
      cursor,
    });
    const items = entries.flatMap((e) => eventOf(e.source, e.row, e.occurrence) ?? []);
    const last = entries[entries.length - 1];
    const body: CalendarEventPage = {
      items,
      nextCursor:
        more && last
          ? encodeEventsCursor({ key: last.key, rowId: last.row.id }, fingerprint)
          : null,
    };
    res.json(body);
  } catch (error: unknown) {
    answerError(res, error, 'list events');
  }
});

/** The default calendar of the caller's personal workspace. */
async function defaultCalendar(handle: PgHandle, userId: string): Promise<CalendarSource> {
  const personal = await ensurePersonalWorkspaceFor(userId);
  const database = await ensureCalendarDatabase(handle, personal);
  return loadCalendar(handle, userId, database.id, database);
}

/** The values a write sets, checked as `PATCH /pages/:id` checks them. */
async function rowWrite(
  handle: PgHandle,
  source: CalendarSource,
  write: EventWrite,
  previous: PageRow['properties'] = {},
) {
  const { title, icon, properties } = eventProperties(source, write);
  const parsed = parseRowProperties(source.database.propertiesSchema, properties);
  if ('refusal' in parsed) {
    throw new CalendarError('validation_failed', parsed.refusal.error, {
      field: parsed.refusal.propertyId,
    });
  }
  const invalid = await invalidReference(handle, source.database, parsed.merge, previous);
  if (invalid) {
    const field =
      invalid.propertyId === source.fields.attendees
        ? 'attendees'
        : invalid.propertyId === source.fields.color
          ? 'colorId'
          : invalid.propertyId;
    throw new CalendarError('validation_failed', invalid.error, { field, reason: invalid.code });
  }
  return { title: parsed.name ?? title, icon, merge: parsed.merge };
}

/** POST /calendar/events — a new event, in `calendarId` or the personal default calendar. */
router.post('/events', async (req: Request, res: Response) => {
  try {
    const userId = userOf(req);
    const body = calendarEventCreateSchema.parse(req.body ?? {});
    const handle = getDb();
    const source = body.calendarId
      ? await loadCalendar(handle, userId, body.calendarId)
      : await defaultCalendar(handle, userId);
    requireEditor(source);
    const write = await rowWrite(handle, source, {
      title: body.title,
      icon: body.icon,
      time: { allDay: body.allDay, start: body.start, end: body.end },
      location: body.location,
      url: body.url,
      description: body.description,
      attendees: body.attendees,
      colorId: body.colorId,
      recurrence: body.recurrence,
      uid: body.uid,
    });
    const row = await insertRow(handle, source.database, {
      ownerId: userId,
      title: write.title ?? body.title,
      icon: write.icon ?? null,
      properties: write.merge,
    });
    rowWritten({
      database: source.database,
      row,
      before: {},
      actorId: userId,
      propertiesChanged: true,
    });
    res.status(201).json(eventOf(source, row));
  } catch (error: unknown) {
    answerError(res, error, 'create an event');
  }
});

/**
 * The event row `rowId` names, with its calendar and the caller's role on
 * the row itself (a row can be shared, or restricted, on its own).
 */
async function loadEventRow(
  handle: PgHandle,
  userId: string,
  rowId: string,
  minRole: 'viewer' | 'editor',
): Promise<{ row: PageRow; source: CalendarSource }> {
  const row = await findPageById(handle, rowId);
  if (!row?.databaseId || row.template) throw new CalendarError('not_found', 'Event not found');
  const access = await resolvePageAccess(handle, userId, row.id);
  if (!access) throw new CalendarError('not_found', 'Event not found');
  const source = await loadCalendar(handle, userId, row.databaseId).catch((err: unknown) => {
    if (err instanceof CalendarError && err.code === 'not_found') {
      throw new CalendarError('not_found', 'Event not found');
    }
    throw err;
  });
  if (!hasRole(access.role, minRole)) {
    throw new CalendarError(
      'forbidden',
      source.database.readOnly
        ? 'This event is in a subscribed calendar: it is read-only'
        : 'Editing this event needs edit access',
    );
  }
  if (row.archived) throw new CalendarError('gone', 'The event is in the trash');
  return { row, source: { ...source, role: access.role as CalendarRole } };
}

const rowIdSchema = z.object({ rowId: z.string().min(1).max(100) }).strict();

/** GET /calendar/events/:rowId — the event (a repeating one as its series). */
router.get('/events/:rowId', async (req: Request, res: Response) => {
  try {
    const userId = userOf(req);
    const { rowId } = rowIdSchema.parse(req.params);
    const { row, source } = await loadEventRow(getDb(), userId, rowId, 'viewer');
    const event = eventOf(source, row);
    if (!event) throw new CalendarError('not_found', 'This row has no date: it is not an event');
    res.json(event);
  } catch (error: unknown) {
    answerError(res, error, 'read an event');
  }
});

/** PATCH /calendar/events/:rowId — the fields sent change (a repeating event's whole series). */
router.patch('/events/:rowId', async (req: Request, res: Response) => {
  try {
    const userId = userOf(req);
    const { rowId } = rowIdSchema.parse(req.params);
    const body = calendarEventUpdateSchema.parse(req.body ?? {});
    const handle = getDb();
    const { row, source } = await loadEventRow(handle, userId, rowId, 'editor');
    if (row.locked) throw new CalendarError('locked', 'The event is locked');
    const current = readEventTime(row.properties[source.fields.when]);
    let time: EventWrite['time'];
    if (current) {
      time = mergedTime(current, body);
    } else if (body.start !== undefined) {
      time = { allDay: body.allDay ?? false, start: body.start, end: body.end };
    } else if (body.allDay !== undefined || body.end !== undefined) {
      throw new CalendarError('validation_failed', 'This event has no time yet: send start', {
        field: 'start',
      });
    }
    const write = await rowWrite(
      handle,
      source,
      {
        title: body.title,
        icon: body.icon,
        time,
        location: body.location,
        url: body.url,
        description: body.description,
        attendees: body.attendees,
        colorId: body.colorId,
        recurrence: body.recurrence,
        uid: body.uid,
      },
      row.properties,
    );
    const updated = await writePage(
      handle,
      row,
      {
        ...(write.title !== undefined && { title: write.title }),
        ...(write.icon !== undefined && { icon: write.icon }),
        lastEditedBy: userId,
        mergeProperties: write.merge,
      },
      { rowDatabase: source.database, movesTrash: false },
    );
    if (!updated) throw new CalendarError('not_found', 'Event not found');
    rowWritten({
      database: source.database,
      row: updated,
      before: row.properties,
      actorId: userId,
      propertiesChanged: true,
      workspace: write.title !== undefined || write.icon !== undefined,
    });
    res.json(eventOf(source, updated));
  } catch (error: unknown) {
    answerError(res, error, 'update an event');
  }
});

/** DELETE /calendar/events/:rowId — into the trash with its subpages, as deleting the page does. */
router.delete('/events/:rowId', async (req: Request, res: Response) => {
  try {
    const userId = userOf(req);
    const { rowId } = rowIdSchema.parse(req.params);
    const handle = getDb();
    const { row, source } = await loadEventRow(handle, userId, rowId, 'editor').catch(
      (err: unknown) => {
        if (err instanceof CalendarError && err.code === 'gone') return { row: null, source: null };
        throw err;
      },
    );
    if (row && source) {
      const archived = await writePage(
        handle,
        row,
        { archived: true, archivedWith: null, lastEditedBy: userId },
        { rowDatabase: null, movesTrash: true },
      );
      if (archived) {
        rowWritten({
          database: source.database,
          row: archived,
          before: row.properties,
          actorId: userId,
          propertiesChanged: false,
          workspace: true,
        });
      }
    }
    res.status(204).end();
  } catch (error: unknown) {
    answerError(res, error, 'delete an event');
  }
});

// ---------------------------------------------------------------------------
// iCalendar
// ---------------------------------------------------------------------------

/** The most events an export writes. */
const MAX_EXPORT_EVENTS = 10_000;

/** GET /calendar/calendars/:id/export.ics — every event, a repeating one with its rule. */
router.get('/calendars/:id/export.ics', async (req: Request, res: Response) => {
  try {
    const userId = userOf(req);
    const { id } = idSchema.parse(req.params);
    const handle = getDb();
    const source = await loadCalendar(handle, userId, id);
    const rows = await handle
      .select()
      .from(pages)
      .where(
        and(
          eq(pages.databaseId, source.database.id),
          eq(pages.archived, false),
          eq(pages.template, false),
        ),
      )
      .orderBy(pages.createdAt, pages.id)
      .limit(MAX_EXPORT_EVENTS);
    const events = rows.flatMap((row) => eventOf(source, row) ?? []);
    const exceptions = new Map(
      rows.map((row) => [row.id, rowExceptionsText(source, row)?.split(',') ?? []]),
    );
    const name = source.database.name || 'Calendar';
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${name.replace(/[^\w .-]/g, '_')}.ics"`,
    );
    res.send(eventsToIcs(name, events, (rowId) => exceptions.get(rowId) ?? []));
  } catch (error: unknown) {
    answerError(res, error, 'export a calendar');
  }
});

const importLimit = rateLimit('calendar-import', { max: 30, windowMs: 60 * 60 * 1000 });

/** The document an import reads: sent, or fetched from a public URL. */
async function importDocument(body: { ics?: string; url?: string }): Promise<string> {
  if (body.ics !== undefined) {
    if (!looksLikeIcs(body.ics)) {
      throw new CalendarError('validation_failed', 'ics is not an iCalendar document', {
        field: 'ics',
      });
    }
    return body.ics;
  }
  const url = (body.url as string).replace(/^webcals?:\/\//i, 'https://');
  try {
    const fetched = await safeFetch(url, {
      maxBytes: CALENDAR_IMPORT_MAX_BYTES,
      timeoutMs: 15_000,
      headers: { accept: 'text/calendar, */*;q=0.5' },
    });
    if (fetched.status < 200 || fetched.status >= 300 || !looksLikeIcs(fetched.body)) {
      throw new CalendarError('import_unreachable', 'The URL did not answer with a calendar', {
        status: fetched.status,
      });
    }
    if (fetched.truncated) {
      throw new CalendarError('validation_failed', 'The calendar is too large to import', {
        field: 'url',
      });
    }
    return fetched.body;
  } catch (err: unknown) {
    if (err instanceof CalendarError) throw err;
    if (err instanceof UnsafeUrlError) {
      throw new CalendarError('validation_failed', err.message, { field: 'url' });
    }
    throw new CalendarError('import_unreachable', 'The URL could not be fetched');
  }
}

/**
 * POST /calendar/calendars/:id/import { ics | url, timeZone? } — the
 * document's events written as rows, matched on their UID: importing the same
 * feed again updates what it imported before rather than doubling it.
 */
router.post('/calendars/:id/import', importLimit, async (req: Request, res: Response) => {
  try {
    const userId = userOf(req);
    const { id } = idSchema.parse(req.params);
    const body = calendarImportRequestSchema.parse(req.body ?? {});
    const timeZone = body.timeZone ?? 'UTC';
    if (!isTimeZone(timeZone)) {
      throw new CalendarError('validation_failed', 'Unknown time zone', { field: 'timeZone' });
    }
    const handle = getDb();
    const source = await loadCalendar(handle, userId, id);
    requireEditor(source);
    const uidProperty = source.fields.uid;
    if (!uidProperty) {
      throw new CalendarError(
        'validation_failed',
        'This calendar has no iCal UID property to match imported events on',
        { field: 'uid' },
      );
    }
    const parsed = parseIcs(await importDocument(body), timeZone);
    if (parsed.events.length > CALENDAR_IMPORT_MAX_EVENTS) {
      throw new CalendarError(
        'validation_failed',
        `A calendar of at most ${CALENDAR_IMPORT_MAX_EVENTS} events can be imported`,
      );
    }
    const uids = parsed.events.map((e) => e.uid);
    const existing =
      uids.length === 0
        ? []
        : await handle
            .select()
            .from(pages)
            .where(
              and(
                eq(pages.databaseId, source.database.id),
                eq(pages.template, false),
                inArray(sql<string>`${pages.properties} -> ${uidProperty}::text ->> 'text'`, uids),
              ),
            );
    const rowOfUid = new Map(
      existing.map((row) => [(row.properties[uidProperty] as { text?: string })?.text, row]),
    );

    const result: CalendarImportResult = {
      created: 0,
      updated: 0,
      skipped: parsed.skipped,
      simplified: 0,
    };
    const has = (field: keyof CalendarSource['fields']) => source.fields[field] !== null;
    for (const event of parsed.events) {
      const current = rowOfUid.get(event.uid);
      // Deleted here after an earlier import: it stays deleted.
      if (current?.archived) {
        result.skipped += 1;
        continue;
      }
      const keepsRule = event.recurrence !== null && has('recurrence');
      if (event.simplified || (event.recurrence !== null && !keepsRule)) result.simplified += 1;
      const write = await rowWrite(
        handle,
        source,
        {
          title: event.title,
          time: { allDay: event.allDay, start: event.start, end: event.end },
          ...(has('location') && { location: event.location }),
          ...(has('description') && { description: event.description }),
          ...(has('url') && { url: event.url }),
          ...(has('recurrence') && { recurrence: keepsRule ? event.recurrence : null }),
          uid: event.uid,
        },
        current?.properties,
      );
      if (current) {
        await writePage(
          handle,
          current,
          { title: write.title ?? event.title, lastEditedBy: userId, mergeProperties: write.merge },
          { rowDatabase: source.database, movesTrash: false },
        );
        result.updated += 1;
      } else {
        await insertRow(handle, source.database, {
          ownerId: userId,
          title: write.title ?? event.title,
          properties: write.merge,
        });
        result.created += 1;
      }
    }
    announceChange({ workspaceId: source.database.workspaceId, databaseId: source.database.id });
    res.json(result);
  } catch (error: unknown) {
    answerError(res, error, 'import a calendar');
  }
});

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

const subscribeLimit = rateLimit('calendar-subscribe', { max: 20, windowMs: 60 * 60 * 1000 });
const subscriptionRefreshLimit = rateLimit('calendar-subscription-refresh', {
  max: 60,
  windowMs: 60 * 60 * 1000,
});

/** Subscriptions need `CALENDAR_FEED_KEY`, which seals their URLs. */
function requireFeedKey(): void {
  if (!feedKeys()) {
    throw new CalendarError(
      'service_unavailable',
      'Calendar subscriptions are not available on this server',
    );
  }
}

/** The caller's subscription `id` with its calendar; `not_found` when it is not theirs. */
async function ownSubscription(
  handle: PgHandle,
  userId: string,
  id: string,
): Promise<{ row: CalendarSubscriptionRow; database: DatabaseRecord }> {
  const [row] = await handle
    .select()
    .from(calendarSubscriptions)
    .where(and(eq(calendarSubscriptions.databaseId, id), eq(calendarSubscriptions.ownerId, userId)))
    .limit(1);
  const database = row ? await findDatabaseById(handle, row.databaseId) : null;
  if (!row || !database) throw new CalendarError('not_found', 'Subscription not found');
  return { row, database };
}

const FEED_FAILURES: Partial<Record<string, string>> = {
  unreachable: 'The calendar could not be reached',
  http_error: 'The calendar’s server refused the request',
  not_a_calendar: 'The URL did not answer with a calendar',
  too_large: 'The calendar is too large to subscribe to',
};

/** GET /calendar/subscriptions?workspaceId — the caller's subscriptions. */
router.get('/subscriptions', async (req: Request, res: Response) => {
  try {
    const userId = userOf(req);
    const query = calendarSubscriptionListQuerySchema.parse(req.query);
    const body: CalendarSubscriptionList = {
      items: await listSubscriptions(getDb(), userId, query.workspaceId),
      nextCursor: null,
    };
    res.json(body);
  } catch (error: unknown) {
    answerError(res, error, 'list calendar subscriptions');
  }
});

/**
 * POST /calendar/subscriptions { url, name?, workspaceId?, timeZone? } — a
 * new calendar kept in step with the feed at `url`. The feed is fetched here,
 * so a URL that does not answer with a calendar is refused at once, and the
 * calendar is filled before the answer (201 with the subscription).
 */
router.post('/subscriptions', subscribeLimit, async (req: Request, res: Response) => {
  try {
    const userId = userOf(req);
    const body = calendarSubscriptionCreateSchema.parse(req.body ?? {});
    requireFeedKey();
    const timeZone = body.timeZone ?? 'UTC';
    if (!isTimeZone(timeZone)) {
      throw new CalendarError('validation_failed', 'Unknown time zone', { field: 'timeZone' });
    }
    let url: URL;
    try {
      url = normalizeFeedUrl(body.url);
    } catch (err: unknown) {
      if (err instanceof UnsafeUrlError) {
        throw new CalendarError('validation_failed', err.message, { field: 'url' });
      }
      throw err;
    }
    const handle = getDb();
    const workspace = body.workspaceId
      ? await findLiveWorkspaceById(handle, body.workspaceId)
      : await ensurePersonalWorkspaceFor(userId);
    if (!workspace) throw new CalendarError('not_found', 'Workspace not found');
    const membership = await findMembership(handle, workspace.id, userId);
    if (!membership) throw new CalendarError('forbidden', 'Not a member of this workspace');
    if (!hasRole(membership.role, 'editor')) {
      throw new CalendarError('forbidden', 'Adding a calendar to this workspace needs edit access');
    }
    const [held] = await handle
      .select({ n: count() })
      .from(calendarSubscriptions)
      .where(eq(calendarSubscriptions.ownerId, userId));
    if (Number(held?.n ?? 0) >= CALENDAR_SUBSCRIPTIONS_MAX) {
      throw new CalendarError(
        'validation_failed',
        `At most ${CALENDAR_SUBSCRIPTIONS_MAX} calendar subscriptions`,
        { field: 'url' },
      );
    }
    const href = url.toString();
    const fingerprint = feedFingerprint(href);
    const [twin] = await handle
      .select({ id: calendarSubscriptions.databaseId })
      .from(calendarSubscriptions)
      .where(
        and(
          eq(calendarSubscriptions.ownerId, userId),
          eq(calendarSubscriptions.urlFingerprint, fingerprint),
        ),
      )
      .limit(1);
    if (twin) {
      throw new CalendarError('conflict', 'You are already subscribed to this calendar', {
        calendarId: twin.id,
      });
    }

    const fetched = await fetchFeed(href, { etag: null, lastModified: null });
    if (fetched.kind === 'failed') {
      if (fetched.error === 'unsafe_url') {
        throw new CalendarError(
          'validation_failed',
          'The URL leads somewhere Nilo does not fetch calendars from',
          { field: 'url' },
        );
      }
      throw new CalendarError(
        'import_unreachable',
        FEED_FAILURES[fetched.error] ?? 'The calendar could not be read',
        { reason: fetched.error, status: fetched.httpStatus },
      );
    }
    if (fetched.kind !== 'document') {
      throw new CalendarError('import_unreachable', 'The URL did not answer with a calendar');
    }
    const parsed = parseIcs(fetched.body, timeZone);
    if (parsed.events.length + parsed.overrides.length > CALENDAR_IMPORT_MAX_EVENTS) {
      throw new CalendarError(
        'validation_failed',
        `A calendar of at most ${CALENDAR_IMPORT_MAX_EVENTS} events can be subscribed to`,
        { field: 'url' },
      );
    }

    const created = await handle.transaction(async (tx) => {
      const database = await createSubscribedCalendarDatabase(tx, {
        workspaceId: workspace.id,
        ownerId: userId,
        name: body.name ?? parsed.name ?? url.hostname,
      });
      const [row] = await tx
        .insert(calendarSubscriptions)
        .values({
          databaseId: database.id,
          workspaceId: workspace.id,
          ownerId: userId,
          urlSealed: sealFeedUrl(href),
          urlFingerprint: fingerprint,
          urlHost: url.hostname,
          timeZone,
          refreshingUntil: new Date(Date.now() + 5 * 60 * 1000),
        })
        .onConflictDoNothing({
          target: [calendarSubscriptions.ownerId, calendarSubscriptions.urlFingerprint],
        })
        .returning();
      if (!row) {
        throw new CalendarError('conflict', 'You are already subscribed to this calendar');
      }
      return { database, row };
    });
    announceChange({ workspaceId: workspace.id });
    const refreshed = await refreshSubscription(handle, created.row, { fetched });
    res.status(201).json(toSubscription(refreshed, created.database));
  } catch (error: unknown) {
    answerError(res, error, 'subscribe to a calendar');
  }
});

/** GET /calendar/subscriptions/:id — one of the caller's subscriptions. */
router.get('/subscriptions/:id', async (req: Request, res: Response) => {
  try {
    const userId = userOf(req);
    const { id } = idSchema.parse(req.params);
    const { row, database } = await ownSubscription(getDb(), userId, id);
    res.json(toSubscription(row, database));
  } catch (error: unknown) {
    answerError(res, error, 'read a calendar subscription');
  }
});

/** PATCH /calendar/subscriptions/:id { name } — rename the subscribed calendar. */
router.patch('/subscriptions/:id', async (req: Request, res: Response) => {
  try {
    const userId = userOf(req);
    const { id } = idSchema.parse(req.params);
    const body = calendarSubscriptionUpdateSchema.parse(req.body ?? {});
    const handle = getDb();
    const { row } = await ownSubscription(handle, userId, id);
    const database = await updateDatabase(handle, row.databaseId, { name: body.name });
    if (!database) throw new CalendarError('not_found', 'Subscription not found');
    announceChange({ workspaceId: database.workspaceId, databaseId: database.id });
    res.json(toSubscription(row, database));
  } catch (error: unknown) {
    answerError(res, error, 'rename a calendar subscription');
  }
});

/**
 * POST /calendar/subscriptions/:id/refresh — read the feed now (at most once
 * a minute), answering with the subscription as the refresh left it: a feed
 * that failed is its `status`, not an error.
 */
router.post(
  '/subscriptions/:id/refresh',
  subscriptionRefreshLimit,
  async (req: Request, res: Response) => {
    try {
      const userId = userOf(req);
      const { id } = idSchema.parse(req.params);
      requireFeedKey();
      const handle = getDb();
      const { row, database } = await ownSubscription(handle, userId, id);
      const sinceMs = row.lastAttemptAt
        ? Date.now() - new Date(row.lastAttemptAt).getTime()
        : Number.POSITIVE_INFINITY;
      const waitMs = CALENDAR_SUBSCRIPTION_MANUAL_REFRESH_SECONDS * 1000 - sinceMs;
      if (waitMs > 0) {
        const retryAfterSeconds = Math.ceil(waitMs / 1000);
        res.setHeader('Retry-After', String(retryAfterSeconds));
        throw new CalendarError('rate_limited', 'This calendar was refreshed a moment ago', {
          retryAfterSeconds,
        });
      }
      const claimed = await claimSubscription(handle, row.databaseId);
      if (!claimed) throw new CalendarError('conflict', 'This calendar is being refreshed');
      res.json(toSubscription(await refreshSubscription(handle, claimed), database));
    } catch (error: unknown) {
      answerError(res, error, 'refresh a calendar subscription');
    }
  },
);

/** DELETE /calendar/subscriptions/:id — unsubscribe: the calendar and its events are deleted. */
router.delete('/subscriptions/:id', async (req: Request, res: Response) => {
  try {
    const userId = userOf(req);
    const { id } = idSchema.parse(req.params);
    const handle = getDb();
    const { row } = await ownSubscription(handle, userId, id);
    await handle.transaction(async (tx) => {
      const rows = await tx
        .select({ id: pages.id, databaseId: pages.databaseId })
        .from(pages)
        .where(eq(pages.databaseId, row.databaseId));
      await deleteDatabaseRows(tx, row.databaseId);
      await recordTombstones(tx, rows);
      await deleteDatabase(tx, row.databaseId);
    });
    announceChange({ workspaceId: row.workspaceId, databaseId: row.databaseId });
    res.status(204).end();
  } catch (error: unknown) {
    answerError(res, error, 'delete a calendar subscription');
  }
});

/** Anything else under `/calendar`: `unknown_route`, which the SDK reads as a version mismatch. */
router.use((_req: Request, res: Response) => {
  send(res, new CalendarError('unknown_route', 'No such calendar route'));
});

export default router;
