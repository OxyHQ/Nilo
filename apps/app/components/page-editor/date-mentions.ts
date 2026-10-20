/**
 * Date mentions (`@tomorrow`, `@3 mar`, `@el próximo viernes 15:00`): what
 * someone types after `@`, read as a calendar date and, when they give one, a
 * time of day — in English or Spanish. A mention stores the date as
 * `yyyy-mm-dd` and the time as `HH:MM` (24-hour), never an instant: a date
 * means the same day wherever it is read.
 */

/** A date someone wrote, and the time of day when they gave one. */
export interface MentionDate {
  /** `yyyy-mm-dd`. */
  date: string;
  /** `HH:MM`, 24-hour. */
  time?: string;
}

/** Calendar-only dates are constructed locally, never parsed as UTC instants. */
function calendarDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [year, month, day] = iso.split('-').map(Number);
  return dateOf(year as number, (month as number) - 1, day as number);
}

/** The local date `year`-`month`(0-based)-`day`, or null when there is no such day. */
function dateOf(year: number, month: number, day: number): Date | null {
  const date = new Date(0);
  date.setFullYear(year, month, day);
  date.setHours(12, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : null;
}

const isTime = (time: string | undefined): time is string =>
  typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

/** One formatter per locale and use: a page draws every date mention it holds on each render. */
function formatterOf(
  cache: Map<string, Intl.DateTimeFormat>,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let format = cache.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    cache.set(locale, format);
  }
  return format;
}
const dayFormats = new Map<string, Intl.DateTimeFormat>();
const clockFormats = new Map<string, Intl.DateTimeFormat>();

export function formatMentionDate(iso: string, locale: string, time?: string): string | null {
  const date = calendarDate(iso);
  if (!date) return null;
  const day = formatterOf(dayFormats, locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
  if (!isTime(time)) return day;
  const [hours, minutes] = time.split(':').map(Number);
  date.setHours(hours as number, minutes as number, 0, 0);
  const clock = formatterOf(clockFormats, locale, { hour: 'numeric', minute: '2-digit' }).format(
    date,
  );
  return `${day} ${clock}`;
}

const relativeDays: Record<string, number> = {
  today: 0,
  hoy: 0,
  tomorrow: 1,
  manana: 1,
  yesterday: -1,
  ayer: -1,
  'pasado manana': 2,
  anteayer: -2,
};
const weekdays = [
  ['sunday', 'domingo'],
  ['monday', 'lunes'],
  ['tuesday', 'martes'],
  ['wednesday', 'miercoles'],
  ['thursday', 'jueves'],
  ['friday', 'viernes'],
  ['saturday', 'sabado'],
];
/** Each month's names and abbreviations, English and Spanish, accents removed. */
const months = [
  ['january', 'jan', 'enero', 'ene'],
  ['february', 'feb', 'febrero'],
  ['march', 'mar', 'marzo'],
  ['april', 'apr', 'abril', 'abr'],
  ['may', 'mayo'],
  ['june', 'jun', 'junio'],
  ['july', 'jul', 'julio'],
  ['august', 'aug', 'agosto', 'ago'],
  ['september', 'sep', 'sept', 'septiembre', 'setiembre'],
  ['october', 'oct', 'octubre'],
  ['november', 'nov', 'noviembre'],
  ['december', 'dec', 'diciembre', 'dic'],
];
const monthIndex = (name: string) => months.findIndex((names) => names.includes(name));
const MONTH = months.flat().join('|');
// Day and month, either way round, with an optional year: "3 mar", "3 de marzo de 2027",
// "march 3rd", "mar 3, 2027".
const DAY_MONTH = new RegExp(
  `^(\\d{1,2})(?:st|nd|rd|th)?(?: de)? (${MONTH})\\.?(?:,?(?: de)? (\\d{4}))?$`,
);
const MONTH_DAY = new RegExp(`^(${MONTH})\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?$`);

const normalize = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
const isoDate = (date: Date) =>
  `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function shifted(now: Date, days: number, monthsAhead = 0): string {
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);
  if (monthsAhead !== 0) {
    // The same day of the month, or the month's last when it is shorter.
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + monthsAhead);
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, last));
  }
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

/**
 * A time of day at the end of what was typed: `3pm`, `3:30 pm`, `15:00`,
 * `at 3pm`, `a las 15:00`, `15h`. Returns what is left before it.
 */
function splitTime(query: string): { rest: string; time?: string } | null {
  const match =
    /(?:^|\s)(?:(?:at|a las?|@)\s+)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.?\s?m\.?|p\.?\s?m\.?|h)?$/.exec(
      query,
    );
  if (!match) return { rest: query };
  const [whole, h, m, suffix] = match;
  // A bare number with neither minutes nor a suffix is a day ("3 mar", "in 3"), not a time.
  if (m === undefined && suffix === undefined) return { rest: query };
  let hours = Number(h);
  const meridiem = suffix?.replace(/[.\s]/g, '');
  if (meridiem === 'am' || meridiem === 'pm') {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === 'pm' ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  const rest = query.slice(0, query.length - whole.length).trim();
  return { rest, time: `${String(hours).padStart(2, '0')}:${m ?? '00'}` };
}

/** The date part alone: `tomorrow`, `next friday`, `in 3 days`, `3 mar 2027`, `10/12/2026`. */
function parseDay(query: string, now: Date): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(query)) return calendarDate(query) ? query : null;

  const relative = relativeDays[query];
  if (relative !== undefined) return shifted(now, relative);

  // In / within / ago: "in 3 days", "en 2 semanas", "dentro de 1 mes", "3 days ago", "hace 3 dias".
  const ahead =
    /^(?:in|en|dentro de) (\d{1,3}) (days?|weeks?|months?|dias?|semanas?|mes|meses)$/.exec(query);
  const ago =
    /^(?:(\d{1,3}) (days?|weeks?|months?) ago|hace (\d{1,3}) (dias?|semanas?|mes|meses))$/.exec(
      query,
    );
  if (ahead || ago) {
    const count = Number(ahead?.[1] ?? ago?.[1] ?? ago?.[3]) * (ahead ? 1 : -1);
    const unit = (ahead?.[2] ?? ago?.[2] ?? ago?.[4]) as string;
    if (/^(months?|mes|meses)$/.test(unit)) return shifted(now, 0, count);
    return shifted(now, /^(weeks?|semanas?)$/.test(unit) ? count * 7 : count);
  }

  // A weekday, bare or "next" / "this" one: the next occurrence, strictly after today.
  const name = query
    .replace(/^(next |this |(?:el )?proximo |(?:el )?siguiente |este )/, '')
    .replace(/ (?:proximo|siguiente|que viene)$/, '');
  const weekday = weekdays.findIndex((names) => names.includes(name));
  if (weekday >= 0) return shifted(now, (weekday - now.getDay() + 7) % 7 || 7);

  // Day and month, either way round (`DAY_MONTH`, `MONTH_DAY`).
  const dayMonth = DAY_MONTH.exec(query);
  const monthDay = MONTH_DAY.exec(query);
  if (dayMonth || monthDay) {
    const day = Number(dayMonth ? dayMonth[1] : monthDay?.[2]);
    const month = monthIndex((dayMonth ? dayMonth[2] : monthDay?.[1]) as string);
    const year = Number((dayMonth ? dayMonth[3] : monthDay?.[3]) ?? now.getFullYear());
    const date = dateOf(year, month, day);
    return date ? isoDate(date) : null;
  }

  // Numeric: day first ("10/12/2026" is 10 December), unless only month first can be
  // a date ("12/25/2026"). The year may be left out (this year) or given as two digits.
  const numeric = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(query);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const yearText = numeric[3];
    const year = yearText
      ? yearText.length === 2
        ? 2000 + Number(yearText)
        : Number(yearText)
      : now.getFullYear();
    const [day, month] = b > 12 && a <= 12 ? [b, a] : [a, b];
    const date = dateOf(year, month - 1, day);
    return date ? isoDate(date) : null;
  }
  return null;
}

/** What was typed as a date, and its time of day when one is given; null when it is neither. */
export function parseMentionDateTime(text: string, now = new Date()): MentionDate | null {
  const query = normalize(text);
  if (!query) return null;
  const split = splitTime(query);
  if (!split) return null;
  const { rest, time } = split;
  // A time alone is today at that time.
  const date = rest ? parseDay(rest, now) : time ? shifted(now, 0) : null;
  if (!date) return null;
  return time ? { date, time } : { date };
}

/** The calendar date of what was typed (any time given is left out), or null. */
export function parseMentionDate(text: string, now = new Date()): string | null {
  return parseMentionDateTime(text, now)?.date ?? null;
}

/** Every day a name says, to offer those starting with what was typed. */
const NAMED_DAYS = [
  ...Object.keys(relativeDays),
  ...weekdays.flat(),
  ...weekdays.flat().flatMap((day) => [`next ${day}`, `proximo ${day}`]),
];

/** Dates to offer for what has been typed so far: the one it names, or names that start with it. */
export function dateMentionMatches(text: string, now = new Date()): MentionDate[] {
  const parsed = parseMentionDateTime(text, now);
  if (parsed) return [parsed];
  const query = normalize(text);
  if (/\d/.test(query)) return [];
  const candidates = query ? NAMED_DAYS : ['today', 'tomorrow', 'yesterday'];
  const seen = new Set<string>();
  const found: MentionDate[] = [];
  for (const name of candidates) {
    if (!name.startsWith(query)) continue;
    const date = parseMentionDate(name, now);
    if (date && !seen.has(date)) {
      seen.add(date);
      found.push({ date });
    }
  }
  return found;
}
