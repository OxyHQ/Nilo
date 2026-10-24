/**
 * Calendar: the contract of `/calendar`, Nilo's API for calendars and their
 * events (`docs/calendar.md`).
 *
 * A calendar is a Nilo database whose rows are events: the event's time is a
 * date property of the database, so the same rows show in Nilo's own calendar
 * view. Every personal workspace can have one default calendar, the `calendar`
 * system database, made on first use.
 *
 * Responses follow Oxy's API conventions: no envelope, lists are
 * `{ items, nextCursor }`, every error is `{ error: { code, message, details? } }`.
 */
import { z } from 'zod';

/** Every error code `/calendar` answers with. Renaming one is a breaking change. */
export const CALENDAR_ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'unknown_route',
  'gone',
  'conflict',
  'validation_failed',
  'rate_limited',
  'internal_error',
  'service_unavailable',
  /** The database exists but is not a calendar: it has no calendar view on a date property. */
  'not_a_calendar',
  /** The event's page, or the row, is locked against edits. */
  'locked',
  /** An ICS import's URL could not be fetched, or did not answer with a calendar. */
  'import_unreachable',
] as const;
export type CalendarErrorCode = (typeof CALENDAR_ERROR_CODES)[number];

export const calendarErrorCodeSchema = z.enum(CALENDAR_ERROR_CODES);

export const calendarErrorBodySchema = z.object({
  error: z.object({
    code: calendarErrorCodeSchema,
    message: z.string(),
    details: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  }),
});
export type CalendarErrorBody = z.infer<typeof calendarErrorBodySchema>;

/** The colours an event can take: the options of a select property, in Nilo's palette. */
export const CALENDAR_COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export type CalendarColor = (typeof CALENDAR_COLORS)[number];

export const CALENDAR_ROLES = ['viewer', 'commenter', 'editor', 'admin', 'owner'] as const;
export type CalendarRole = (typeof CALENDAR_ROLES)[number];

/** How many events a page holds at most, and when `limit` is absent. */
export const CALENDAR_EVENTS_MAX_LIMIT = 1000;
export const CALENDAR_EVENTS_DEFAULT_LIMIT = 250;
/** The longest range one events request may ask for. */
export const CALENDAR_MAX_RANGE_DAYS = 400;
/** The most calendars one events request may name. */
export const CALENDAR_MAX_IDS = 50;
/** The most events one ICS import writes. */
export const CALENDAR_IMPORT_MAX_EVENTS = 2000;
/** The largest ICS document an import reads. */
export const CALENDAR_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day, `YYYY-MM-DD`, that exists. */
export function isIsoDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

const isoInstantSchema = z.string().datetime({ offset: true });

/** An ISO-8601 instant with its offset (`Z` or `±hh:mm`). */
export function isIsoInstant(value: string): boolean {
  return isoInstantSchema.safeParse(value).success;
}

/** Which property of the database holds each field of an event; null when it has none. */
export const calendarFieldsSchema = z.object({
  /** The date property that is the event's time: its start, end and whether it has a time. */
  when: z.string(),
  location: z.string().nullable(),
  url: z.string().nullable(),
  description: z.string().nullable(),
  /** A person property: the event's attendees, as Oxy user ids. */
  attendees: z.string().nullable(),
  /** A select property whose options colour the events. */
  color: z.string().nullable(),
  /** A text property holding the event's repeat rule (an RRULE). */
  recurrence: z.string().nullable(),
  /** A text property holding the event's iCalendar UID, which imports match on. */
  uid: z.string().nullable(),
});
export type CalendarFields = z.infer<typeof calendarFieldsSchema>;

export const calendarColorOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.enum(CALENDAR_COLORS),
});
export type CalendarColorOption = z.infer<typeof calendarColorOptionSchema>;

export const calendarSchema = z.object({
  /** The database's id. */
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  /** The personal workspace's own calendar, where events go when no calendar is named. */
  isDefault: z.boolean(),
  /** The caller's role on the database. */
  role: z.enum(CALENDAR_ROLES),
  /** Whether the caller may create, change and delete its events. */
  canEdit: z.boolean(),
  fields: calendarFieldsSchema,
  /** The colours its events can take (the colour property's options), in order. */
  colors: z.array(calendarColorOptionSchema),
  updatedAt: z.string(),
});
export type Calendar = z.infer<typeof calendarSchema>;

export const calendarListSchema = z.object({
  items: z.array(calendarSchema),
  nextCursor: z.null(),
});
export type CalendarList = z.infer<typeof calendarListSchema>;

/**
 * One event, or one occurrence of a repeating one.
 *
 * - `allDay`: `start` and `end` are days (`YYYY-MM-DD`) and `end` is
 *   EXCLUSIVE, as in iCalendar: a one-day event on the 3rd ends on the 4th.
 * - otherwise: ISO-8601 UTC instants; `end` equals `start` for an event with
 *   no end.
 *
 * Writes address the row (`rowId`); an occurrence's `id` is only for lists.
 */
export const calendarEventSchema = z.object({
  /** The row id for a single event; `<rowId>:<start>` for an occurrence of a repeating one. */
  id: z.string(),
  /** The database row (a page) the event is: what PATCH and DELETE address. */
  rowId: z.string(),
  calendarId: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  allDay: z.boolean(),
  start: z.string(),
  end: z.string(),
  location: z.string().nullable(),
  url: z.string().nullable(),
  description: z.string().nullable(),
  /** Oxy user ids. */
  attendees: z.array(z.string()),
  color: calendarColorOptionSchema.nullable(),
  /** The series' repeat rule (an RRULE without its `RRULE:` prefix); null for a single event. */
  recurrence: z.string().nullable(),
  /** The start of the series' first occurrence, for an occurrence; null for a single event. */
  seriesStart: z.string().nullable(),
  uid: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const calendarEventPageSchema = z.object({
  items: z.array(calendarEventSchema),
  nextCursor: z.string().nullable(),
});
export type CalendarEventPage = z.infer<typeof calendarEventPageSchema>;

const idListSchema = z
  .string()
  .transform((raw) => [...new Set(raw.split(',').filter((id) => id.length > 0))]);

/** `GET /calendar/calendars`: a workspace's calendars, the caller's personal workspace's by default. */
export const calendarListQuerySchema = z
  .object({
    workspaceId: z.string().min(1).optional(),
  })
  .strict();
export type CalendarListQuery = z.input<typeof calendarListQuerySchema>;

/**
 * `GET /calendar/events`: the events and occurrences overlapping `[from, to)`,
 * by start (then row id), paged by `cursor`. `calendarIds` (comma-separated)
 * narrows to those calendars; absent, every calendar of the workspace
 * (`workspaceId`, the personal one by default) the caller can read.
 * `timeZone` (IANA, default UTC) decides which days `from`/`to` cover for
 * all-day events, and the wall-clock time a repeating event keeps.
 */
export const calendarEventsQuerySchema = z
  .object({
    from: isoInstantSchema,
    to: isoInstantSchema,
    calendarIds: idListSchema.optional(),
    workspaceId: z.string().min(1).optional(),
    timeZone: z.string().min(1).max(100).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CALENDAR_EVENTS_MAX_LIMIT)
      .default(CALENDAR_EVENTS_DEFAULT_LIMIT),
    cursor: z.string().min(1).max(1000).optional(),
  })
  .strict();
export type CalendarEventsQuery = z.input<typeof calendarEventsQuerySchema>;

const eventFields = {
  title: z.string().max(2000),
  icon: z.string().max(200).nullable(),
  allDay: z.boolean(),
  /** A day (`YYYY-MM-DD`) when `allDay`, else an ISO instant with its offset. */
  start: z.string(),
  /** Exclusive for an all-day event; null or absent for none (one day, or no end). */
  end: z.string().nullable(),
  location: z.string().max(2000).nullable(),
  url: z.string().max(2000).nullable(),
  description: z.string().max(50_000).nullable(),
  attendees: z.array(z.string().min(1).max(200)).max(200),
  /** The id of one of the calendar's `colors`, or null for none. */
  colorId: z.string().max(200).nullable(),
  /** An RRULE (`FREQ=WEEKLY;BYDAY=MO,WE`); null for a single event. `docs/calendar.md` lists what is supported. */
  recurrence: z.string().max(500).nullable(),
  uid: z.string().max(500).nullable(),
};

/** Days or instants, as `allDay` says: the check both writes share. */
export function eventTimeIssues(input: {
  allDay: boolean;
  start?: string;
  end?: string | null;
}): { path: 'start' | 'end'; message: string }[] {
  const ok = input.allDay ? isIsoDay : isIsoInstant;
  const shape = input.allDay ? 'a day (YYYY-MM-DD)' : 'an ISO-8601 instant with its offset';
  const issues: { path: 'start' | 'end'; message: string }[] = [];
  if (input.start !== undefined && !ok(input.start)) {
    issues.push({ path: 'start', message: `start must be ${shape}` });
  }
  if (input.end !== undefined && input.end !== null && !ok(input.end)) {
    issues.push({ path: 'end', message: `end must be ${shape}` });
  }
  return issues;
}

/** `POST /calendar/events`: a new event, in `calendarId` (the personal default calendar when absent). */
export const calendarEventCreateSchema = z
  .object({
    calendarId: z.string().min(1).optional(),
    title: eventFields.title,
    icon: eventFields.icon.optional(),
    allDay: eventFields.allDay.default(false),
    start: eventFields.start,
    end: eventFields.end.optional(),
    location: eventFields.location.optional(),
    url: eventFields.url.optional(),
    description: eventFields.description.optional(),
    attendees: eventFields.attendees.optional(),
    colorId: eventFields.colorId.optional(),
    recurrence: eventFields.recurrence.optional(),
    uid: eventFields.uid.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    const time = { allDay: input.allDay ?? false, start: input.start, end: input.end };
    for (const issue of eventTimeIssues(time)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.path], message: issue.message });
    }
  });
export type CalendarEventCreate = z.input<typeof calendarEventCreateSchema>;

/**
 * `PATCH /calendar/events/:rowId`: the fields sent change, the others stay.
 * `start` alone moves the event and keeps its length; changing `allDay` needs
 * `start` (and `end`, for a range) in the new form.
 */
export const calendarEventUpdateSchema = z
  .object({
    title: eventFields.title.optional(),
    icon: eventFields.icon.optional(),
    allDay: eventFields.allDay.optional(),
    start: eventFields.start.optional(),
    end: eventFields.end.optional(),
    location: eventFields.location.optional(),
    url: eventFields.url.optional(),
    description: eventFields.description.optional(),
    attendees: eventFields.attendees.optional(),
    colorId: eventFields.colorId.optional(),
    recurrence: eventFields.recurrence.optional(),
    uid: eventFields.uid.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, { message: 'At least one field is required' });
export type CalendarEventUpdate = z.input<typeof calendarEventUpdateSchema>;

/**
 * `POST /calendar/calendars/:id/import`: an iCalendar document, sent (`ics`)
 * or fetched from a public `https`/`webcal` URL (`url`). Events are matched on
 * their UID, so importing the same feed again updates what it imported before.
 * `timeZone` is the zone of floating times (with neither `Z` nor `TZID`).
 */
export const calendarImportRequestSchema = z
  .object({
    ics: z.string().min(1).max(CALENDAR_IMPORT_MAX_BYTES).optional(),
    url: z.string().min(1).max(2000).optional(),
    timeZone: z.string().min(1).max(100).optional(),
  })
  .strict()
  .refine((input) => (input.ics === undefined) !== (input.url === undefined), {
    message: 'Send exactly one of ics and url',
  });
export type CalendarImportRequest = z.input<typeof calendarImportRequestSchema>;

export const calendarImportResultSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  /** Events left out: cancelled, without a start, or changes to one occurrence of a series. */
  skipped: z.number().int(),
  /** Repeating events whose rule Nilo does not support, imported as their first occurrence. */
  simplified: z.number().int(),
});
export type CalendarImportResult = z.infer<typeof calendarImportResultSchema>;

/** `GET /workspaces/personal`, as far as a calendar client reads it. */
export const niloWorkspaceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    avatar: z.string().nullable(),
    ownerId: z.string(),
    isPersonal: z.boolean(),
    role: z.enum(CALENDAR_ROLES).nullable(),
  })
  .passthrough();
export type NiloWorkspace = z.infer<typeof niloWorkspaceSchema>;
