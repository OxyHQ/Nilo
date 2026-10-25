/**
 * iCalendar (RFC 5545): a calendar's events written as an `.ics` document,
 * and the VEVENTs of one read for an import or a subscription.
 *
 * Export writes each row once, a repeating one with its RRULE (and EXDATEs,
 * when it has exceptions). Reading keeps what Nilo can hold: summary,
 * description, location, URL, the time (a day, a UTC time, a time in a named
 * zone, or a floating time read in the zone the request names), DTEND or
 * DURATION, an RRULE Nilo supports and the series' EXDATEs; a repeating event
 * with another rule keeps its first occurrence. Cancelled events are skipped.
 * A change to one occurrence (a VEVENT with RECURRENCE-ID) is read apart, as
 * an override: an import skips it, a subscription removes that occurrence
 * from its series and, unless it was cancelled, holds it as an event of its own.
 */
import { createHash } from 'node:crypto';
import type { CalendarEvent } from '@oxy.so/nilo-contracts';
import { normalizeRepeatRule, RepeatRuleError } from './recurrence.js';
import { DAY_MS, dayNumberOfIso, instantOf, isoOfDayNumber, isTimeZone } from './zoned-time.js';

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const escapeText = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** A content line folded at 75 octets, never inside a UTF-8 sequence. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    const limit = out.length === 0 ? 75 : 74;
    if (octets + size > limit) {
      out.push(current);
      current = '';
      octets = 0;
    }
    current += char;
    octets += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

const utcStamp = (iso: string) => `${iso.replace(/[-:]/g, '').replace(/\.\d+/, '').slice(0, 15)}Z`;
const dayStamp = (day: string) => day.replace(/-/g, '');

/** The UID a row is exported under: its own (an imported event's), else one from its id. */
export const exportUid = (event: Pick<CalendarEvent, 'uid' | 'rowId'>) =>
  event.uid ?? `${event.rowId}@nilo.so`;

export function eventsToIcs(
  calendarName: string,
  events: readonly CalendarEvent[],
  /** A series' exceptions (`YYYY-MM-DD` days or ISO instants), by row id. */
  exceptionsOf?: (rowId: string) => readonly string[],
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Oxy//Nilo//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  for (const event of events) {
    lines.push('BEGIN:VEVENT', `UID:${escapeText(exportUid(event))}`);
    lines.push(`DTSTAMP:${utcStamp(event.updatedAt)}`);
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dayStamp(event.start)}`);
      lines.push(`DTEND;VALUE=DATE:${dayStamp(event.end)}`);
    } else {
      lines.push(`DTSTART:${utcStamp(event.start)}`);
      if (event.end !== event.start) lines.push(`DTEND:${utcStamp(event.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.url) lines.push(`URL:${event.url.replace(/[\r\n]/g, '')}`);
    if (event.recurrence) lines.push(`RRULE:${event.recurrence}`);
    const exdates = exceptionsOf?.(event.rowId) ?? [];
    if (event.recurrence && exdates.length > 0) {
      const days = exdates.filter((e) => !e.includes('T')).map(dayStamp);
      const instants = exdates.filter((e) => e.includes('T')).map(utcStamp);
      if (event.allDay && days.length > 0) lines.push(`EXDATE;VALUE=DATE:${days.join(',')}`);
      if (!event.allDay && instants.length > 0) lines.push(`EXDATE:${instants.join(',')}`);
    }
    lines.push(`CREATED:${utcStamp(event.createdAt)}`);
    lines.push(`LAST-MODIFIED:${utcStamp(event.updatedAt)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** The document's content lines, unfolded. */
export function contentLines(ics: string): ContentLine[] {
  const physical = ics.replace(/\r\n?/g, '\n').split('\n');
  const logical: string[] = [];
  for (const line of physical) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && logical.length > 0) {
      logical[logical.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      logical.push(line);
    }
  }
  const out: ContentLine[] = [];
  for (const line of logical) {
    let i = 0;
    let quoted = false;
    for (; i < line.length; i += 1) {
      const c = line[i];
      if (c === '"') quoted = !quoted;
      else if (c === ':' && !quoted) break;
    }
    if (i >= line.length) continue;
    const head = line.slice(0, i);
    const value = line.slice(i + 1);
    const [rawName, ...rawParams] = head.split(';');
    const params: Record<string, string> = {};
    for (const param of rawParams) {
      const eq = param.indexOf('=');
      if (eq > 0) {
        params[param.slice(0, eq).toUpperCase()] = param.slice(eq + 1).replace(/^"|"$/g, '');
      }
    }
    out.push({ name: (rawName ?? '').toUpperCase(), params, value });
  }
  return out;
}

const unescapeText = (value: string) =>
  value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

/** A time read: a day, or an instant. */
type IcsTime = { day: string } | { ms: number };

function readTime(line: ContentLine, floatingZone: string): IcsTime | null {
  const value = line.value.trim();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date || line.params.VALUE === 'DATE') {
    if (!date) return null;
    const day = `${date[1]}-${date[2]}-${date[3]}`;
    const n = dayNumberOfIso(day);
    return Number.isNaN(n) || isoOfDayNumber(n) !== day ? null : { day };
  }
  const time = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!time) return null;
  const [y, mo, d, h, mi, s] = time.slice(1, 7).map(Number) as number[];
  if (time[7] === 'Z') {
    const ms = Date.UTC(y as number, (mo as number) - 1, d, h, mi, s);
    return Number.isNaN(ms) ? null : { ms };
  }
  const tzid = line.params.TZID;
  const zone = tzid && isTimeZone(tzid) ? tzid : floatingZone;
  const ms = instantOf(
    {
      year: y as number,
      month: mo as number,
      day: d as number,
      hour: h as number,
      minute: mi as number,
      second: s as number,
      millisecond: 0,
    },
    zone,
  );
  return Number.isNaN(ms) ? null : { ms };
}

/** An ISO-8601 duration (`P1DT2H`, `PT30M`, `P1W`) in ms; null when it is not one. */
export function durationMs(value: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim(),
  );
  if (!match || value.trim() === 'P' || value.trim().endsWith('T')) return null;
  const [, sign, w, d, h, m, s] = match;
  const ms =
    (Number(w ?? 0) * 7 * 24 * 3600 +
      Number(d ?? 0) * 24 * 3600 +
      Number(h ?? 0) * 3600 +
      Number(m ?? 0) * 60 +
      Number(s ?? 0)) *
    1000;
  return sign === '-' ? -ms : ms;
}

/** An event read from a document, in the API's write form. */
export interface ImportedEvent {
  uid: string;
  title: string;
  allDay: boolean;
  start: string;
  end: string | null;
  location: string | null;
  description: string | null;
  url: string | null;
  recurrence: string | null;
  /** It repeated by a rule Nilo does not support, and keeps its first occurrence. */
  simplified: boolean;
  /** The series' EXDATEs: `YYYY-MM-DD` days or ISO instants, ascending. */
  exceptions: string[];
}

/** A change to one occurrence of the series `uid`: the VEVENT with its RECURRENCE-ID. */
export interface ImportedOverride {
  uid: string;
  /** The occurrence it replaces: a `YYYY-MM-DD` day or an ISO instant. */
  recurrenceId: string;
  /** The occurrence as it now is; null when it was cancelled. */
  event: ImportedEvent | null;
}

export interface ParsedIcs {
  events: ImportedEvent[];
  /** Changes to single occurrences, by series UID and occurrence (the last one of each wins). */
  overrides: ImportedOverride[];
  /** VEVENTs not read as events: cancelled, without a start, or overrides. */
  skipped: number;
  /** The calendar's own name (`X-WR-CALNAME`), when it gives one. */
  name: string | null;
}

/** A time as the API and the exceptions write it: a `YYYY-MM-DD` day or an ISO instant. */
const timeToken = (time: IcsTime) => ('day' in time ? time.day : new Date(time.ms).toISOString());

/** The times an EXDATE line lists, each read with the line's parameters. */
function exceptionTimes(line: ContentLine, floatingZone: string): string[] {
  return line.value.split(',').flatMap((value) => {
    const time = readTime({ ...line, value }, floatingZone);
    return time ? [timeToken(time)] : [];
  });
}

const uidOf = (lines: ContentLine[], fallback: () => string) => {
  const line = lines.find((l) => l.name === 'UID');
  return line && line.value.trim() !== '' ? line.value.trim().slice(0, 500) : fallback();
};

function toOverride(lines: ContentLine[], floatingZone: string): ImportedOverride | null {
  const idLine = lines.find((l) => l.name === 'RECURRENCE-ID');
  const id = idLine ? readTime(idLine, floatingZone) : null;
  const uidLine = lines.find((l) => l.name === 'UID');
  if (!id || !uidLine || uidLine.value.trim() === '') return null;
  const uid = uidLine.value.trim().slice(0, 500);
  const cancelled =
    lines
      .find((l) => l.name === 'STATUS')
      ?.value.trim()
      .toUpperCase() === 'CANCELLED';
  const event = cancelled
    ? null
    : toEvent(
        lines.filter(
          (l) => l.name !== 'RECURRENCE-ID' && l.name !== 'RRULE' && l.name !== 'EXDATE',
        ),
        floatingZone,
      );
  if (!cancelled && !event) return null;
  return { uid, recurrenceId: timeToken(id), event };
}

function toEvent(lines: ContentLine[], floatingZone: string): ImportedEvent | null {
  const get = (name: string) => lines.find((l) => l.name === name);
  if (get('RECURRENCE-ID')) return null;
  if (get('STATUS')?.value.trim().toUpperCase() === 'CANCELLED') return null;
  const startLine = get('DTSTART');
  const start = startLine ? readTime(startLine, floatingZone) : null;
  if (!start) return null;
  const endLine = get('DTEND');
  let end = endLine ? readTime(endLine, floatingZone) : null;
  if (end && 'day' in end !== 'day' in start) end = null;
  const duration = get('DURATION');
  if (!end && duration) {
    const ms = durationMs(duration.value);
    if (ms !== null && ms > 0) {
      end =
        'day' in start
          ? {
              day: isoOfDayNumber(dayNumberOfIso(start.day) + Math.max(1, Math.round(ms / DAY_MS))),
            }
          : { ms: start.ms + ms };
    }
  }
  const summary = get('SUMMARY');
  const title = summary ? unescapeText(summary.value).slice(0, 2000) : '';
  let recurrence: string | null = null;
  let simplified = false;
  const rrule = get('RRULE');
  if (rrule) {
    try {
      recurrence = normalizeRepeatRule(rrule.value);
    } catch (err: unknown) {
      if (!(err instanceof RepeatRuleError)) throw err;
      simplified = true;
    }
  }
  const allDay = 'day' in start;
  const startWire = 'day' in start ? start.day : new Date(start.ms).toISOString();
  let endWire: string | null = null;
  if (end) {
    endWire = 'day' in end ? end.day : new Date(end.ms).toISOString();
    const valid =
      'day' in start && 'day' in end
        ? end.day > start.day
        : 'ms' in end && 'ms' in start && end.ms >= start.ms;
    if (!valid) endWire = null;
  }
  const uid = uidOf(
    lines,
    () =>
      `${createHash('sha256').update(`${startLine?.value}|${title}`).digest('hex').slice(0, 32)}@import`,
  );
  const exceptions =
    recurrence === null
      ? []
      : [
          ...new Set(
            lines
              .filter((l) => l.name === 'EXDATE')
              .flatMap((l) => exceptionTimes(l, floatingZone))
              .filter((token) => token.includes('T') !== allDay),
          ),
        ].sort();
  const text = (name: string, max: number) => {
    const line = get(name);
    const value = line ? unescapeText(line.value).trim() : '';
    return value === '' ? null : value.slice(0, max);
  };
  return {
    uid,
    title,
    allDay,
    start: startWire,
    end: endWire,
    location: text('LOCATION', 2000),
    description: text('DESCRIPTION', 50_000),
    url: text('URL', 2000),
    recurrence,
    simplified,
    exceptions,
  };
}

/**
 * The VEVENTs of a document, by UID (the last one of a UID wins), and how
 * many were skipped. `floatingZone` is the zone of times with neither `Z` nor
 * a known `TZID`.
 */
export function parseIcs(ics: string, floatingZone: string): ParsedIcs {
  const byUid = new Map<string, ImportedEvent>();
  const overrides = new Map<string, ImportedOverride>();
  let skipped = 0;
  let name: string | null = null;
  let current: ContentLine[] | null = null;
  let nested = 0;
  for (const line of contentLines(ics)) {
    if (!current && line.name === 'X-WR-CALNAME' && name === null) {
      const value = unescapeText(line.value).trim();
      name = value === '' ? null : value.slice(0, 200);
      continue;
    }
    if (line.name === 'BEGIN' && line.value.trim().toUpperCase() === 'VEVENT') {
      current = [];
      nested = 0;
      continue;
    }
    if (!current) continue;
    if (line.name === 'BEGIN') {
      nested += 1;
      continue;
    }
    if (line.name === 'END' && nested > 0) {
      nested -= 1;
      continue;
    }
    if (line.name === 'END' && line.value.trim().toUpperCase() === 'VEVENT') {
      if (current.some((l) => l.name === 'RECURRENCE-ID')) {
        const override = toOverride(current, floatingZone);
        if (override) overrides.set(`${override.uid}\n${override.recurrenceId}`, override);
        skipped += 1;
      } else {
        const event = toEvent(current, floatingZone);
        if (event) byUid.set(event.uid, event);
        else skipped += 1;
      }
      current = null;
      continue;
    }
    if (nested === 0) current.push(line);
  }
  return { events: [...byUid.values()], overrides: [...overrides.values()], skipped, name };
}

/** Whether a document looks like iCalendar at all. */
export const looksLikeIcs = (text: string) => /^\s*BEGIN:VCALENDAR/i.test(text);
