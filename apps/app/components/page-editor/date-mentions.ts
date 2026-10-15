/** Calendar-only dates are constructed locally, never parsed as UTC instants. */
function calendarDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

export function formatMentionDate(iso: string, locale: string): string | null {
  const date = calendarDate(iso);
  return date
    ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(
        date,
      )
    : null;
}

const relativeDays: Record<string, number> = {
  today: 0,
  hoy: 0,
  tomorrow: 1,
  manana: 1,
  yesterday: -1,
  ayer: -1,
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
const normalize = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
const isoDate = (date: Date) =>
  `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** A bare weekday and “next weekday” both mean the next occurrence, strictly after today. */
export function parseMentionDate(text: string, now = new Date()): string | null {
  const query = normalize(text);
  if (/^\d{4}-\d{2}-\d{2}$/.test(query)) return calendarDate(query) ? query : null;
  let offset = relativeDays[query];
  if (offset === undefined) {
    const name = query
      .replace(/^(next |(?:el )?proximo |(?:el )?siguiente )/, '')
      .replace(/ (?:proximo|siguiente)$/, '');
    const weekday = weekdays.findIndex((names) => names.includes(name));
    if (weekday < 0) return null;
    offset = (weekday - now.getDay() + 7) % 7 || 7;
  }
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return isoDate(date);
}

export function dateMentionMatches(text: string, now = new Date()): string[] {
  const parsed = parseMentionDate(text, now);
  if (parsed) return [parsed];
  const query = normalize(text);
  if (/\d/.test(query)) return [];
  const candidates = query
    ? [
        ...Object.keys(relativeDays),
        ...weekdays.flat(),
        ...weekdays.flat().flatMap((day) => [`next ${day}`, `proximo ${day}`]),
      ]
    : ['today', 'tomorrow', 'yesterday'];
  return [
    ...new Set(
      candidates
        .filter((name) => name.startsWith(query))
        .map((name) => parseMentionDate(name, now))
        .filter((date): date is string => date !== null),
    ),
  ];
}
