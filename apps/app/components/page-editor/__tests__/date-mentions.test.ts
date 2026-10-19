import {
  dateMentionMatches,
  formatMentionDate,
  parseMentionDate,
  parseMentionDateTime,
} from '../date-mentions';
import { mentionSearchResults } from '../mention-search';
const friday = new Date(2026, 9, 16, 23, 45);
it.each([
  ['today', '2026-10-16'],
  ['hoy', '2026-10-16'],
  ['tomorrow', '2026-10-17'],
  ['MAÑANA', '2026-10-17'],
  ['yesterday', '2026-10-15'],
  ['ayer', '2026-10-15'],
  ['friday', '2026-10-23'],
  ['next friday', '2026-10-23'],
  ['viernes', '2026-10-23'],
  ['el próximo viernes', '2026-10-23'],
  ['viernes siguiente', '2026-10-23'],
  ['  next   monday ', '2026-10-19'],
  ['miércoles', '2026-10-21'],
  ['sábado', '2026-10-17'],
  ['2024-02-29', '2024-02-29'],
  ['2026-10-16', '2026-10-16'],
  // Day first, as written in Spanish and most of the world.
  ['10/12/2026', '2026-12-10'],
  ['3/4/2027', '2027-04-03'],
  ['03-04-27', '2027-04-03'],
  ['24.12', '2026-12-24'],
  // Month first only where day first is no date.
  ['12/25/2026', '2026-12-25'],
  // Day and month by name, either way round, in either language.
  ['3 mar', '2026-03-03'],
  ['3 march 2027', '2027-03-03'],
  ['mar 3', '2026-03-03'],
  ['March 3rd, 2027', '2027-03-03'],
  ['3 de marzo', '2026-03-03'],
  ['3 de marzo de 2027', '2027-03-03'],
  ['14 dic', '2026-12-14'],
  ['sept 9', '2026-09-09'],
  // In, within and ago.
  ['in 3 days', '2026-10-19'],
  ['in 1 day', '2026-10-17'],
  ['in 2 weeks', '2026-10-30'],
  ['in 1 month', '2026-11-16'],
  ['en 3 días', '2026-10-19'],
  ['dentro de 2 semanas', '2026-10-30'],
  ['en 1 mes', '2026-11-16'],
  ['3 days ago', '2026-10-13'],
  ['hace 3 días', '2026-10-13'],
  ['pasado mañana', '2026-10-18'],
  ['this friday', '2026-10-23'],
  ['viernes que viene', '2026-10-23'],
])('parses %s as a calendar date', (input, expected) =>
  expect(parseMentionDate(input, friday)).toBe(expected),
);
it.each([
  ['3pm', { date: '2026-10-16', time: '15:00' }],
  ['3:30 pm', { date: '2026-10-16', time: '15:30' }],
  ['12am', { date: '2026-10-16', time: '00:00' }],
  ['12 p.m.', { date: '2026-10-16', time: '12:00' }],
  ['15:00', { date: '2026-10-16', time: '15:00' }],
  ['9h', { date: '2026-10-16', time: '09:00' }],
  ['tomorrow 3pm', { date: '2026-10-17', time: '15:00' }],
  ['next friday at 9:15am', { date: '2026-10-23', time: '09:15' }],
  ['mañana a las 15:00', { date: '2026-10-17', time: '15:00' }],
  ['el próximo viernes a las 18:30', { date: '2026-10-23', time: '18:30' }],
  ['3 mar 10:00', { date: '2026-03-03', time: '10:00' }],
  ['10/12/2026 8pm', { date: '2026-12-10', time: '20:00' }],
  ['in 3 days at 14:45', { date: '2026-10-19', time: '14:45' }],
])('parses %s as a date and a time of day', (input, expected) =>
  expect(parseMentionDateTime(input, friday)).toEqual(expected),
);
it('keeps a date without a time of day as only a date', () => {
  expect(parseMentionDateTime('tomorrow', friday)).toEqual({ date: '2026-10-17' });
  expect(parseMentionDate('tomorrow 3pm', friday)).toBe('2026-10-17');
});
it('ends a month early when it is shorter than the day it starts from', () => {
  expect(parseMentionDate('in 1 month', new Date(2026, 0, 31, 9))).toBe('2026-02-28');
});
it.each([
  '2025-02-29',
  '2026-02-30',
  '2026-13-01',
  '2026-00-12',
  '2026-10-00',
  '2026-1-01',
  '2026-01-01T00:00:00Z',
  '31/02/2026',
  '13/13/2026',
  '32 mar',
  'in days',
  '25pm',
  '24:00',
  'next',
  'today extra',
  '',
  'not a date',
])('rejects invalid or ambiguous input: %s', (input) =>
  expect(parseMentionDate(input, friday)).toBeNull(),
);
it('handles year, leap-day, and daylight-saving boundaries with local calendar arithmetic', () => {
  expect(parseMentionDate('mañana', new Date(2026, 11, 31, 23, 59))).toBe('2027-01-01');
  expect(parseMentionDate('ayer', new Date(2024, 2, 1, 0, 1))).toBe('2024-02-29');
  expect(parseMentionDate('tomorrow', new Date(2026, 2, 28, 23, 59))).toBe('2026-03-29');
  expect(parseMentionDate('tomorrow', new Date(2026, 9, 24, 23, 59))).toBe('2026-10-25');
});
it('suggests partial names in either language without duplicate dates or invalid ISO suggestions', () => {
  const dates = (text: string) => dateMentionMatches(text, friday).map(({ date }) => date);
  expect(dates('maña')).toEqual(['2026-10-17']);
  expect(dates('next fri')).toEqual(['2026-10-23']);
  expect(dates('2026-02-30')).toEqual([]);
  expect(dates('')).toEqual(['2026-10-16', '2026-10-17', '2026-10-15']);
  expect(dateMentionMatches('mañana 9am', friday)).toEqual([{ date: '2026-10-17', time: '09:00' }]);
});
it.each(['en', 'es'])(
  'inserts canonical date attributes with a localized %s label and Date group',
  (locale) => {
    const date = '2026-10-17';
    const result = mentionSearchResults({
      text: 'mañana',
      people: [],
      pages: [],
      labels: { people: 'People', pages: 'Pages', date: 'Fecha', untitled: 'Untitled' },
      locale,
      now: friday,
    });
    expect(result).toEqual([
      {
        id: `date:${date}`,
        group: 'Fecha',
        label: formatMentionDate(date, locale),
        attributes: { kind: 'date', date },
      },
    ]);
  },
);
it.each(['en', 'es'])('keeps the time of day a %s mention was given', (locale) => {
  const [item] = mentionSearchResults({
    text: 'tomorrow 3pm',
    people: [],
    pages: [],
    labels: { people: 'People', pages: 'Pages', date: 'Date', untitled: 'Untitled' },
    locale,
    now: friday,
  });
  expect(item).toEqual({
    id: 'date:2026-10-17T15:00',
    group: 'Date',
    label: formatMentionDate('2026-10-17', locale, '15:00'),
    attributes: { kind: 'date', date: '2026-10-17', time: '15:00' },
  });
});
it('formats a time of day after the date, and ignores one that is no time', () => {
  expect(formatMentionDate('2026-10-17', 'en', '15:00')).toMatch(/^October 17, 2026 3:00\sPM$/);
  expect(formatMentionDate('2026-10-17', 'es', '15:00')).toBe('17 de octubre de 2026 15:00');
  expect(formatMentionDate('2026-10-17', 'en', '25:00')).toBe('October 17, 2026');
});
it('formats dates in the selected language without shifting days', () => {
  expect(formatMentionDate('2026-10-17', 'en')).toBe('October 17, 2026');
  expect(formatMentionDate('2026-10-17', 'es')).toBe('17 de octubre de 2026');
  expect(formatMentionDate('2026-02-30', 'es')).toBeNull();
});
