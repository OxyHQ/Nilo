/**
 * The filters of the quick find (`components/command-palette`), as Notion's:
 * titles only, who created the page, the teamspace it lives in and when it
 * was last edited. `GET /search` reads them (`apps/api/src/routes/search.ts`).
 */

/** When a page was last edited, counted back from today. */
export const EDITED_RANGES = ['today', 'week', 'month', 'year'] as const;
export type EditedRange = (typeof EDITED_RANGES)[number];

/** The private pages, as a teamspace filter. */
export const PRIVATE_TEAMSPACE = 'private';

export interface SearchFilters {
  titleOnly: boolean;
  /** Oxy user id of the creator. */
  createdBy: string | null;
  /** A teamspace id, or `PRIVATE_TEAMSPACE`. */
  teamspaceId: string | null;
  edited: EditedRange | null;
}

export const NO_SEARCH_FILTERS: SearchFilters = {
  titleOnly: false,
  createdBy: null,
  teamspaceId: null,
  edited: null,
};

/** Whether any filter is set. */
export function hasSearchFilters(filters: SearchFilters): boolean {
  return (
    filters.titleOnly ||
    filters.createdBy !== null ||
    filters.teamspaceId !== null ||
    filters.edited !== null
  );
}

/** Whether a filter narrows the pages by itself, with nothing typed (title only does not). */
export function filtersFindPages(filters: SearchFilters): boolean {
  return filters.createdBy !== null || filters.teamspaceId !== null || filters.edited !== null;
}

const DAYS: Record<EditedRange, number> = { today: 0, week: 7, month: 30, year: 365 };

/**
 * The start of a range: local midnight `DAYS` days back. Midnight, not the
 * instant, so the request (and its cache key) is the same all day.
 */
export function editedSince(range: EditedRange, now: Date): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - DAYS[range]);
  return start;
}

/** The query parameters of `GET /search` for `filters`. */
export function searchFilterParams(filters: SearchFilters, now: Date): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.titleOnly) params.titleOnly = 'true';
  if (filters.createdBy) params.createdBy = filters.createdBy;
  if (filters.teamspaceId) params.teamspaceId = filters.teamspaceId;
  if (filters.edited) params.editedAfter = editedSince(filters.edited, now).toISOString();
  return params;
}
