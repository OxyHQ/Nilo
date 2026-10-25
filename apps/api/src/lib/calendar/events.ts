/**
 * A calendar's rows as events, and an event write as the row's properties.
 *
 * The time is the calendar's date property as Nilo stores it
 * (`property-values.ts`, `docs/databases.md`): `{ start, end, includeTime }`.
 * Without a time it names days — midnight UTC of each, the end inclusive, as
 * the app's date picker writes them — and the API speaks of them as
 * iCalendar does, `YYYY-MM-DD` with an exclusive end. With a time it holds
 * UTC instants, and an event with no end ends when it starts.
 */
import {
  type Calendar,
  type CalendarColorOption,
  type CalendarEvent,
  type CalendarFields,
  type CalendarRole,
  eventTimeIssues,
} from '@oxy.so/nilo-contracts';
import type { DatabaseProperty, SelectColor } from '../../db/schema/databases.js';
import type { PageProperties } from '../../db/schema/pages.js';
import { hasRole } from '../../db/schema/workspaces.js';
import type { DatabaseRecord } from '../../repositories/databases.js';
import type { PageRow } from '../../repositories/pages.js';
import { NAME_PROPERTY_ID } from '../databases/schema-defaults.js';
import { CALENDAR_PROPERTY } from '../databases/system.js';
import { normalizeRepeatRule, RepeatRuleError } from './recurrence.js';
import { DAY_MS, type DayNumber, dayNumberOfIso, isoOfDayNumber } from './zoned-time.js';

/** A calendar the caller can read: its database, where its fields are, and the caller's role. */
export interface CalendarSource {
  database: DatabaseRecord;
  fields: CalendarFields;
  role: CalendarRole;
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function propertyOf(source: CalendarSource, id: string | null): DatabaseProperty | null {
  if (!id) return null;
  return source.database.propertiesSchema.properties.find((p) => p.id === id) ?? null;
}

export function colorOptions(source: CalendarSource): CalendarColorOption[] {
  const property = propertyOf(source, source.fields.color);
  return (property?.config?.options ?? []).map((o) => ({
    id: o.id,
    name: o.name,
    color: o.color as SelectColor,
  }));
}

export function toCalendar(source: CalendarSource): Calendar {
  const { database } = source;
  return {
    id: database.id,
    workspaceId: database.workspaceId,
    name: database.name,
    icon: database.icon,
    isDefault: database.systemKey === 'calendar',
    role: source.role,
    canEdit: hasRole(source.role, 'editor'),
    fields: source.fields,
    colors: colorOptions(source),
    subscribed: database.readOnly,
    updatedAt: new Date(database.updatedAt).toISOString(),
  };
}

/** An event's time as stored, read: days for an all-day event, instants otherwise. */
export type EventTime = DaysTime | InstantsTime;

interface DaysTime {
  allDay: true;
  startDay: DayNumber;
  /** Exclusive. */
  endDay: DayNumber;
}

interface InstantsTime {
  allDay: false;
  startMs: number;
  endMs: number;
  hasEnd: boolean;
}

/** Whether `time` is in days (narrows where `strict` is off, as in this package). */
export const inDays = (time: EventTime): time is DaysTime => time.allDay === true;

const instantMs = (value: unknown): number | null => {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(ms) ? null : ms;
};

/** The time a stored date value holds, or null when it has no start. */
export function readEventTime(value: unknown): EventTime | null {
  const date = asObject(value);
  const startMs = instantMs(date?.start);
  if (startMs === null) return null;
  const endMs = instantMs(date?.end);
  if (date?.includeTime === true) {
    const end = endMs !== null && endMs >= startMs ? endMs : startMs;
    return { allDay: false, startMs, endMs: end, hasEnd: endMs !== null && endMs > startMs };
  }
  const startDay = Math.floor(startMs / DAY_MS);
  const lastDay = endMs === null ? startDay : Math.max(startDay, Math.floor(endMs / DAY_MS));
  return { allDay: true, startDay, endDay: lastDay + 1 };
}

/** Where a time starts and how long it lasts: in days when all-day, else in ms. */
export function spanOf(time: EventTime): { start: number; length: number } {
  if (inDays(time)) return { start: time.startDay, length: time.endDay - time.startDay };
  const instants = time as InstantsTime;
  return { start: instants.startMs, length: instants.endMs - instants.startMs };
}

/** The time as the API writes it: `YYYY-MM-DD` days, or ISO instants. */
export function wireTime(time: EventTime): { allDay: boolean; start: string; end: string } {
  return inDays(time)
    ? { allDay: true, start: isoOfDayNumber(time.startDay), end: isoOfDayNumber(time.endDay) }
    : {
        allDay: false,
        start: new Date((time as InstantsTime).startMs).toISOString(),
        end: new Date((time as InstantsTime).endMs).toISOString(),
      };
}

/** The same series moved to start at `start` (a day, or ms), keeping its length. */
export function occurrenceTime(series: EventTime, start: number): EventTime {
  if (inDays(series)) {
    return { allDay: true, startDay: start, endDay: start + (series.endDay - series.startDay) };
  }
  const instants = series as InstantsTime;
  return { ...instants, startMs: start, endMs: start + (instants.endMs - instants.startMs) };
}

function text(properties: PageProperties, id: string | null): string | null {
  if (!id) return null;
  const value = asObject(properties[id]);
  const raw =
    typeof value?.text === 'string'
      ? value.text
      : typeof value?.value === 'string'
        ? value.value
        : null;
  return raw === null || raw === '' ? null : raw;
}

function strings(properties: PageProperties, id: string | null, key: string): string[] {
  if (!id) return [];
  const list = asObject(properties[id])?.[key];
  return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * The exceptions a row's series holds (`CALENDAR_PROPERTY.exceptions`, a text
 * property only subscribed calendars have), as stored; null for none.
 */
export function rowExceptionsText(source: CalendarSource, row: PageRow): string | null {
  const has = source.database.propertiesSchema.properties.some(
    (p) => p.id === CALENDAR_PROPERTY.exceptions && p.type === 'text',
  );
  return has ? text(row.properties, CALENDAR_PROPERTY.exceptions) : null;
}

/** The repeat rule a row holds, or null for a single event. */
export function rowRecurrence(source: CalendarSource, row: PageRow): string | null {
  return text(row.properties, source.fields.recurrence);
}

/**
 * The event a row is, or one occurrence of it (`occurrence`: its start, a
 * day or ms). Null when the row has no time.
 */
export function eventOf(
  source: CalendarSource,
  row: PageRow,
  occurrence?: number,
): CalendarEvent | null {
  const series = readEventTime(row.properties[source.fields.when]);
  if (!series) return null;
  const recurrence = rowRecurrence(source, row);
  const time =
    recurrence !== null && occurrence !== undefined ? occurrenceTime(series, occurrence) : series;
  const wire = wireTime(time);
  const colorId = asObject(
    source.fields.color ? row.properties[source.fields.color] : null,
  )?.optionId;
  const color = colorOptions(source).find((o) => o.id === colorId) ?? null;
  const occurrenceOf = recurrence !== null && occurrence !== undefined;
  return {
    id: occurrenceOf ? `${row.id}:${wire.start}` : row.id,
    rowId: row.id,
    calendarId: source.database.id,
    workspaceId: row.workspaceId,
    title: row.title,
    icon: row.icon,
    allDay: wire.allDay,
    start: wire.start,
    end: wire.end,
    location: text(row.properties, source.fields.location),
    url: text(row.properties, source.fields.url),
    description: text(row.properties, source.fields.description),
    attendees: strings(row.properties, source.fields.attendees, 'userIds'),
    color,
    recurrence,
    seriesStart: occurrenceOf ? wireTime(series).start : null,
    uid: text(row.properties, source.fields.uid),
    createdBy: row.ownerId,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** A write the calendar refuses, with the field it is about (422 `validation_failed`). */
export class EventWriteError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
  }
}

/** An event's writable fields, as `POST` and `PATCH` send them (time already merged). */
export interface EventWrite {
  title?: string;
  icon?: string | null;
  time?: { allDay: boolean; start: string; end: string | null | undefined };
  location?: string | null;
  url?: string | null;
  description?: string | null;
  attendees?: string[];
  colorId?: string | null;
  recurrence?: string | null;
  uid?: string | null;
}

/** The date value for a time the API was sent; throws `EventWriteError`. */
export function storedTime(time: NonNullable<EventWrite['time']>): Record<string, unknown> {
  const issue = eventTimeIssues(time)[0];
  if (issue) throw new EventWriteError(issue.message, issue.path);
  if (time.allDay) {
    const startDay = dayNumberOfIso(time.start);
    const endDay = time.end ? dayNumberOfIso(time.end) : startDay + 1;
    if (endDay <= startDay) throw new EventWriteError('end must be after start', 'end');
    const day = (d: DayNumber) => `${isoOfDayNumber(d)}T00:00:00.000Z`;
    return {
      start: day(startDay),
      end: endDay - 1 > startDay ? day(endDay - 1) : null,
      includeTime: false,
    };
  }
  const startMs = Date.parse(time.start);
  const endMs = time.end ? Date.parse(time.end) : null;
  if (endMs !== null && endMs < startMs) {
    throw new EventWriteError('end must not be before start', 'end');
  }
  return {
    start: new Date(startMs).toISOString(),
    end: endMs === null || endMs === startMs ? null : new Date(endMs).toISOString(),
    includeTime: true,
  };
}

/**
 * The time a PATCH leaves the event with. `start` alone moves the event and
 * keeps its length; changing `allDay` needs `start` in the new form.
 */
export function mergedTime(
  current: EventTime,
  patch: { allDay?: boolean; start?: string; end?: string | null },
): NonNullable<EventWrite['time']> | undefined {
  if (patch.allDay === undefined && patch.start === undefined && patch.end === undefined) {
    return undefined;
  }
  const allDay = patch.allDay ?? current.allDay;
  if (allDay !== current.allDay) {
    if (patch.start === undefined) {
      throw new EventWriteError('Changing allDay needs start (and end) in the new form', 'start');
    }
    return { allDay, start: patch.start, end: patch.end };
  }
  const wire = wireTime(current);
  if (patch.start === undefined) return { allDay, start: wire.start, end: patch.end };
  if (patch.end !== undefined) return { allDay, start: patch.start, end: patch.end };
  const issue = eventTimeIssues({ allDay, start: patch.start })[0];
  if (issue) throw new EventWriteError(issue.message, issue.path);
  if (inDays(current)) {
    const length = current.endDay - current.startDay;
    return {
      allDay,
      start: patch.start,
      end: isoOfDayNumber(dayNumberOfIso(patch.start) + length),
    };
  }
  const instants = current as InstantsTime;
  if (!instants.hasEnd) return { allDay, start: patch.start, end: null };
  const length = instants.endMs - instants.startMs;
  return {
    allDay,
    start: patch.start,
    end: new Date(Date.parse(patch.start) + length).toISOString(),
  };
}

function requireField(source: CalendarSource, field: keyof CalendarFields, name: string): string {
  const id = source.fields[field];
  if (!id) throw new EventWriteError(`This calendar has no ${name} property`, field);
  return id;
}

/**
 * The row properties (and title) a write sets, as `PATCH /pages/:id` would
 * be sent them: a field the calendar has no property for is refused when it
 * holds a value and ignored when it clears one.
 */
export function eventProperties(
  source: CalendarSource,
  write: EventWrite,
): { title?: string; icon?: string | null; properties: Record<string, unknown> } {
  const properties: Record<string, unknown> = {};
  if (write.title !== undefined) properties[NAME_PROPERTY_ID] = { text: write.title };
  if (write.time) properties[source.fields.when] = storedTime(write.time);
  const setText = (field: keyof CalendarFields, name: string, value: string | null | undefined) => {
    if (value === undefined) return;
    if (value === null && !source.fields[field]) return;
    properties[requireField(source, field, name)] = { text: value ?? '' };
  };
  setText('location', 'location', write.location);
  setText('description', 'description', write.description);
  setText('uid', 'iCal UID', write.uid);
  if (write.url !== undefined && (write.url !== null || source.fields.url)) {
    properties[requireField(source, 'url', 'link')] = { value: write.url ?? '' };
  }
  if (write.attendees !== undefined && (write.attendees.length > 0 || source.fields.attendees)) {
    properties[requireField(source, 'attendees', 'attendees')] = {
      userIds: [...new Set(write.attendees)],
    };
  }
  if (write.colorId !== undefined && (write.colorId !== null || source.fields.color)) {
    const id = requireField(source, 'color', 'colour');
    if (write.colorId !== null && !colorOptions(source).some((o) => o.id === write.colorId)) {
      throw new EventWriteError('colorId is not one of the calendar’s colours', 'colorId');
    }
    properties[id] = { optionId: write.colorId };
  }
  if (write.recurrence !== undefined && (write.recurrence !== null || source.fields.recurrence)) {
    const id = requireField(source, 'recurrence', 'repeat');
    let rule = '';
    if (write.recurrence !== null && write.recurrence.trim() !== '') {
      try {
        rule = normalizeRepeatRule(write.recurrence);
      } catch (err: unknown) {
        if (err instanceof RepeatRuleError) throw new EventWriteError(err.message, 'recurrence');
        throw err;
      }
    }
    properties[id] = { text: rule };
  }
  return {
    ...(write.title !== undefined && { title: write.title }),
    ...(write.icon !== undefined && { icon: write.icon }),
    properties,
  };
}
