import {
  editedSince,
  filtersFindPages,
  hasSearchFilters,
  NO_SEARCH_FILTERS,
  searchFilterParams,
} from '../search-filters';

describe('the quick find filters', () => {
  const now = new Date(2026, 9, 20, 15, 30);

  it('send nothing when none is set', () => {
    expect(hasSearchFilters(NO_SEARCH_FILTERS)).toBe(false);
    expect(searchFilterParams(NO_SEARCH_FILTERS, now)).toEqual({});
  });

  it('become the parameters of GET /search', () => {
    const params = searchFilterParams(
      { titleOnly: true, createdBy: 'ada', teamspaceId: 'private', edited: 'week' },
      now,
    );
    expect(params).toEqual({
      titleOnly: 'true',
      createdBy: 'ada',
      teamspaceId: 'private',
      editedAfter: new Date(2026, 9, 13).toISOString(),
    });
  });

  it('count date ranges from local midnight, so a day asks the same thing', () => {
    expect(editedSince('today', now)).toEqual(new Date(2026, 9, 20));
    expect(editedSince('month', now)).toEqual(new Date(2026, 8, 20));
    expect(editedSince('year', new Date(2026, 9, 20, 23, 59))).toEqual(new Date(2025, 9, 20));
  });

  it('find pages without a query only when they narrow what pages there are', () => {
    const titleOnly = { ...NO_SEARCH_FILTERS, titleOnly: true };
    expect(hasSearchFilters(titleOnly)).toBe(true);
    expect(filtersFindPages(titleOnly)).toBe(false);
    expect(filtersFindPages({ ...NO_SEARCH_FILTERS, createdBy: 'ada' })).toBe(true);
    expect(filtersFindPages({ ...NO_SEARCH_FILTERS, edited: 'today' })).toBe(true);
  });
});
