import { matchesSearch } from '../search-picker-dialog';

it('matches a label whatever its case and accents, as a mention search does', () => {
  expect(matchesSearch('Café Notes', 'cafe')).toBe(true);
  expect(matchesSearch('Resume', ' RÉSUMÉ ')).toBe(true);
  expect(matchesSearch('Roadmap', '')).toBe(true);
  expect(matchesSearch('Roadmap', 'plan')).toBe(false);
});
