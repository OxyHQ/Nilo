/**
 * The events of some calendars overlapping a window, by start, paged.
 *
 * Single events are found, ordered and paged in PostgreSQL over the rows'
 * `properties`: each calendar's date property is read where it is (a CASE on
 * the row's database), its start and end with the same reading the views use
 * (`dateMs`), and the window applied to days for all-day events and to
 * instants otherwise. Repeating events are the rows starting before the
 * window ends that hold a repeat rule; their occurrences are expanded in JS
 * (`recurrence.ts`) and merged in. Both are ordered by the same key — the
 * start instant, or the local midnight of an all-day event's day — then by
 * row id, which is what the keyset cursor holds.
 */
import { createHash } from 'node:crypto';
import { and, eq, getTableColumns, inArray, type SQL, sql } from 'drizzle-orm';
import type { PgHandle } from '../../db/client.js';
import { pages } from '../../db/schema/pages.js';
import type { PageRow } from '../../repositories/pages.js';
import { dateMs } from '../databases/view-query.js';
import {
  type CalendarSource,
  readEventTime,
  rowExceptionsText,
  rowRecurrence,
  rowSeriesZone,
  spanOf,
} from './events.js';
import {
  expandSeries,
  isException,
  parseExceptions,
  parseRepeatRule,
  type RepeatRule,
  RepeatRuleError,
  type Window,
} from './recurrence.js';
import { DAY_MS, startOfLocalDay } from './zoned-time.js';

/** A rule Nilo cannot read (written before a change, or by hand) shows its first occurrence. */
const ONCE: RepeatRule = {
  freq: 'DAILY',
  interval: 1,
  count: 1,
  until: null,
  byDay: [],
  byMonthDay: [],
};

/** The most repeating series one request expands. */
export const MAX_SERIES = 2000;

export interface EventsCursor {
  /** The order key of the last event returned. */
  key: number;
  rowId: string;
}

export interface EventEntry {
  source: CalendarSource;
  row: PageRow;
  /** For an occurrence of a repeating event: its start (a day, or ms). */
  occurrence?: number;
  key: number;
}

/** What a cursor is bound to: the same calendars, window and zone. */
export function cursorFingerprint(input: {
  calendarIds: readonly string[];
  window: Window;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        [...input.calendarIds].sort(),
        input.window.fromMs,
        input.window.toMs,
        input.window.timeZone,
      ]),
    )
    .digest('base64url')
    .slice(0, 16);
}

export function encodeEventsCursor(cursor: EventsCursor, fingerprint: string): string {
  return Buffer.from(JSON.stringify({ f: fingerprint, k: cursor.key, r: cursor.rowId })).toString(
    'base64url',
  );
}

/** The cursor, or null when it is not one the API issued for this list. */
export function decodeEventsCursor(raw: string, fingerprint: string): EventsCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (parsed.f !== fingerprint) return null;
    if (typeof parsed.k !== 'number' || !Number.isFinite(parsed.k)) return null;
    if (typeof parsed.r !== 'string' || parsed.r === '') return null;
    return { key: parsed.k, rowId: parsed.r };
  } catch {
    return null;
  }
}

const after = (a: { key: number; rowId: string }, b: EventsCursor | null) =>
  !b || a.key > b.key || (a.key === b.key && a.rowId > b.rowId);

const compareEntries = (a: EventEntry, b: EventEntry) =>
  a.key - b.key || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0);

/** `CASE pages.database_id WHEN <calendar> THEN <expr for it> END`. */
function perCalendar(sources: readonly CalendarSource[], expr: (s: CalendarSource) => SQL): SQL {
  const branches = sources.map((s) => sql`when ${s.database.id}::text then ${expr(s)}`);
  return sql`(case ${pages.databaseId} ${sql.join(branches, sql` `)} end)`;
}

/** The order key of an event: its start, or the local midnight of its first day. */
export function eventKey(time: ReturnType<typeof readEventTime>, timeZone: string): number {
  if (!time) return Number.NaN;
  const { start } = spanOf(time);
  return time.allDay ? startOfLocalDay(start, timeZone) : start;
}

/**
 * The page of events after `cursor`: at most `limit`, and whether more follow.
 */
export async function listEvents(
  handle: PgHandle,
  input: {
    sources: readonly CalendarSource[];
    window: Window;
    limit: number;
    cursor: EventsCursor | null;
  },
): Promise<{ entries: EventEntry[]; more: boolean }> {
  const { sources, window, limit, cursor } = input;
  if (sources.length === 0) return { entries: [], more: false };
  const bySource = new Map(sources.map((s) => [s.database.id, s]));

  const when = perCalendar(sources, (s) => sql`${pages.properties} -> ${s.fields.when}::text`);
  const repeat = perCalendar(sources, (s) =>
    s.fields.recurrence
      ? sql`nullif(btrim(${pages.properties} -> ${s.fields.recurrence}::text ->> 'text'), '')`
      : sql`null::text`,
  );
  const startMs = dateMs(sql`${when} -> 'start'`);
  const endMs = sql`greatest(coalesce(${dateMs(sql`${when} -> 'end'`)}, ${startMs}), ${startMs})`;
  const allDay = sql`(coalesce(${when} -> 'includeTime', 'false'::jsonb) <> 'true'::jsonb)`;
  const startDay = sql`floor(${startMs} / ${DAY_MS}::float8)`;
  const endDay = sql`(floor(${endMs} / ${DAY_MS}::float8) + 1)`;
  const localMidnight = sql`((date '1970-01-01' + ${startDay}::int)::timestamp at time zone ${window.timeZone}::text)`;
  const key = sql<number>`(case when ${allDay}
    then floor(extract(epoch from ${localMidnight}) * 1000)::float8
    else ${startMs} end)`;
  const overlaps = sql`(case when ${allDay}
    then ${startDay} < ${window.endDay}::float8 and ${endDay} > ${window.firstDay}::float8
    else ${startMs} < ${window.toMs}::float8
      and (${endMs} > ${window.fromMs}::float8 or ${startMs} >= ${window.fromMs}::float8) end)`;
  const startsBeforeEnd = sql`(case when ${allDay}
    then ${startDay} < ${window.endDay}::float8
    else ${startMs} < ${window.toMs}::float8 end)`;
  const live = and(
    inArray(
      pages.databaseId,
      sources.map((s) => s.database.id),
    ),
    eq(pages.archived, false),
    eq(pages.template, false),
    sql`${startMs} is not null`,
  );
  const afterCursor = cursor
    ? sql`(${key} > ${cursor.key}::float8 or (${key} = ${cursor.key}::float8 and ${pages.id} collate "C" > ${cursor.rowId}::text))`
    : sql`true`;

  const [single, repeating] = await Promise.all([
    handle
      .select({ ...getTableColumns(pages), sortKey: key })
      .from(pages)
      .where(and(live, sql`${repeat} is null`, overlaps, afterCursor))
      .orderBy(key, sql`${pages.id} collate "C"`)
      .limit(limit + 1),
    handle
      .select(getTableColumns(pages))
      .from(pages)
      .where(and(live, sql`${repeat} is not null`, startsBeforeEnd))
      .orderBy(key, sql`${pages.id} collate "C"`)
      .limit(MAX_SERIES),
  ]);

  const entries: EventEntry[] = single.map(({ sortKey, ...row }) => ({
    source: bySource.get(row.databaseId as string) as CalendarSource,
    row,
    key: Number(sortKey),
  }));

  for (const row of repeating) {
    const source = bySource.get(row.databaseId as string) as CalendarSource;
    const time = readEventTime(row.properties[source.fields.when]);
    const rule = rowRecurrence(source, row);
    if (!time || rule === null) continue;
    let parsed: ReturnType<typeof parseRepeatRule> | null = null;
    try {
      parsed = parseRepeatRule(rule);
    } catch (err: unknown) {
      if (!(err instanceof RepeatRuleError)) throw err;
    }
    const keyOf = (start: number) =>
      time.allDay ? startOfLocalDay(start, window.timeZone) : start;
    const exceptions = parseExceptions(rowExceptionsText(source, row));
    // A timed series from a feed repeats at its own zone's wall-clock time;
    // the window's instants are the same in any zone.
    const zone = (!time.allDay && rowSeriesZone(source, row)) || window.timeZone;
    const starts = expandSeries(
      { rule: parsed ?? ONCE, allDay: time.allDay, ...spanOf(time) },
      { ...window, timeZone: zone },
      limit + 1,
      (start) =>
        !(exceptions && isException(exceptions, time.allDay, start, zone)) &&
        after({ key: keyOf(start), rowId: row.id }, cursor),
    );
    for (const start of starts) {
      entries.push({ source, row, occurrence: start, key: keyOf(start) });
    }
  }

  entries.sort(compareEntries);
  return { entries: entries.slice(0, limit), more: entries.length > limit };
}
