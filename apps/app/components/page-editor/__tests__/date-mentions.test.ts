import { dateMentionMatches, formatMentionDate, parseMentionDate } from '../date-mentions';
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
])('parses %s as a calendar date', (input, expected) =>
  expect(parseMentionDate(input, friday)).toBe(expected),
);
it.each([
  '2025-02-29',
  '2026-02-30',
  '2026-13-01',
  '2026-00-12',
  '2026-10-00',
  '2026-1-01',
  '2026-01-01T00:00:00Z',
  '10/12/2026',
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
  expect(dateMentionMatches('maña', friday)).toEqual(['2026-10-17']);
  expect(dateMentionMatches('next fri', friday)).toEqual(['2026-10-23']);
  expect(dateMentionMatches('2026-02-30', friday)).toEqual([]);
  expect(dateMentionMatches('', friday)).toEqual(['2026-10-16', '2026-10-17', '2026-10-15']);
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
it('formats dates in the selected language without shifting days', () => {
  expect(formatMentionDate('2026-10-17', 'en')).toBe('October 17, 2026');
  expect(formatMentionDate('2026-10-17', 'es')).toBe('17 de octubre de 2026');
  expect(formatMentionDate('2026-02-30', 'es')).toBeNull();
});
