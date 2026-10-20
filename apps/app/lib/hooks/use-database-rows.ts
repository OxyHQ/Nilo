import {
  keepPreviousData,
  useInfiniteQuery,
  type InfiniteData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import axios from 'axios';
import { useOxy } from '@oxy.so/services/ui/client';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import { queryKeys } from './query-keys';
import { readerTimeZone } from '../time-zone';
import { useVisibleDatesStore } from '../stores/visible-dates-store';
import { useViewSearchStore } from '../stores/view-search-store';
import type {
  DatabaseViewType,
  DatabaseRow,
  DatabaseRowResponse,
  DatabaseRowsResponse,
  PropertyValue,
} from '../types/databases';
import type { Page, PageResponse } from '../types/pages';

/**
 * Backend serializes a database row as a Page payload extended with
 * `databaseId` and `properties`. The shapes are structurally identical
 * to `DatabaseRow` — but Zod-narrowed property values aren't expressible
 * on the Page type without coupling pages to databases. This helper does
 * the runtime-safe conversion in one place.
 */
export function pageToDatabaseRow(page: Page): DatabaseRow {
  return {
    id: page.id,
    workspaceId: page.workspaceId,
    parentId: page.parentId,
    databaseId: page.databaseId ?? null,
    title: page.title,
    icon: page.icon ?? null,
    cover: page.cover ?? null,
    ownerId: page.ownerId,
    archived: page.archived,
    order: page.order,
    properties: (page.properties ?? {}) as Record<string, PropertyValue>,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

interface CreateRowInput {
  templateId?: string;
  databaseId: string;
  title?: string;
  properties?: Record<string, PropertyValue | unknown>;
}

interface UpdateRowInput {
  databaseId: string;
  rowId: string;
  title?: string;
  icon?: string | null;
  cover?: string | null;
  archived?: boolean;
  properties?: Record<string, PropertyValue | unknown>;
}

interface DeleteRowInput {
  databaseId: string;
  rowId: string;
}

/**
 * A view's rows. Infinite queries refetch only the pages already loaded on
 * live invalidation. A calendar or a timeline reads every row of the dates it
 * shows (`useVisibleDatesStore`), and nothing before it says which; every other
 * view, a board too, pages its own load limit (`pageSize`, the API's default
 * when none is asked) at a time and loads more on demand.
 * A view searched in its toolbar (`useViewSearchStore`) reads the rows whose
 * title matches.
 */
export function useDatabaseRows(
  databaseId: string | undefined,
  viewId: string | null,
  type: DatabaseViewType = 'table',
) {
  const { isAuthenticated } = useOxy();
  const dated = type === 'calendar' || type === 'timeline';
  const dates = useVisibleDatesStore((state) =>
    dated && viewId ? (state.byView[viewId] ?? null) : null,
  );
  const search = useViewSearchStore((state) => (viewId ? (state.byView[viewId] ?? '') : ''));
  const query = useInfiniteQuery({
    queryKey: [
      ...queryKeys.databases.rows(databaseId ?? 'none', viewId),
      dated ? 'dates' : 'paged',
      ...(dated ? [dates] : []),
      ...(search ? [{ search }] : []),
    ],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<DatabaseRowsResponse> => {
      if (!databaseId) throw new Error('Database id required');
      let cursor = pageParam;
      let result: DatabaseRowsResponse | undefined;
      do {
        const { data }: { data: DatabaseRowsResponse } = await apiClient.get<DatabaseRowsResponse>(
          API_ROUTES.databases.listRows(databaseId),
          {
            signal,
            params: {
              ...(viewId && { viewId }),
              // A calendar or a timeline reads all its dates' rows, a hundred a request.
              ...(dated && { pageSize: '100' }),
              ...(cursor && { cursor }),
              ...(dates && { filter: JSON.stringify(dates) }),
              ...(search && { search }),
              // A view grouped by date groups a date with a time by its day here.
              ...(readerTimeZone() && { timeZone: readerTimeZone() }),
            },
          },
        );
        result = result ? { ...data, rows: [...result.rows, ...data.rows] } : data;
        cursor = data.cursor;
      } while (dated && cursor);
      return result;
    },
    getNextPageParam: (last) => last.cursor ?? undefined,
    // A calendar moved to another month, or a view searched for something
    // else, shows what it had until the next rows are read.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === databaseId &&
      previousQuery?.queryKey[3] === viewId &&
      (dated || search !== '' || (previousQuery?.queryKey.length ?? 0) > 5)
        ? previous
        : undefined,
    retry: (count, error) => {
      if (axios.isAxiosError(error) && [403, 404].includes(error.response?.status ?? 0))
        return false;
      return count < 2;
    },
    enabled: isAuthenticated && Boolean(databaseId) && (!dated || dates !== null),
  });
  const first = query.data?.pages[0];
  return {
    ...query,
    data: first ? { ...first, rows: uniqueRows(query.data?.pages ?? []) } : undefined,
  };
}

/**
 * The loaded pages' rows, each once (in each of its groups, in a grouped
 * view). A row edited between two page requests can move past the cursor and
 * come again on a later page, and a view sorted on a formula or rollup pages
 * by offset, where a row inserted moves another across the boundary.
 */
export function uniqueRows(pages: readonly DatabaseRowsResponse[]): DatabaseRow[] {
  const seen = new Set<string>();
  const rows: DatabaseRow[] = [];
  for (const page of pages) {
    for (const row of page.rows) {
      const key = row.groupKey === undefined ? row.id : JSON.stringify([row.id, row.groupKey]);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return rows;
}

type RowsCache = InfiniteData<DatabaseRowsResponse>;

/** One row with its computed values (formulas, rollups), whatever view it falls in. */
export function useDatabaseRow(databaseId: string | undefined, rowId: string) {
  const { isAuthenticated } = useOxy();
  return useQuery<DatabaseRow>({
    queryKey: databaseId ? queryKeys.databases.row(databaseId, rowId) : ['database', 'none', 'row'],
    queryFn: async () => {
      if (!databaseId) throw new Error('Database id required');
      const res = await apiClient.get<DatabaseRowResponse>(
        API_ROUTES.databases.getRow(databaseId, rowId),
      );
      return res.data.row;
    },
    enabled: isAuthenticated && Boolean(databaseId),
  });
}

/** The most rows one batch read names (`POST /databases/:id/rows/batch`). */
const MAX_BATCH_ROWS = 100;

/**
 * The rows `ids` of database `databaseId` with their computed values, read in
 * one request per hundred. A row missing from the result is not a live row of
 * that database.
 */
export async function readRelatedRows(
  databaseId: string,
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<DatabaseRow[]> {
  const chunks = Array.from({ length: Math.ceil(ids.length / MAX_BATCH_ROWS) }, (_, i) =>
    ids.slice(i * MAX_BATCH_ROWS, (i + 1) * MAX_BATCH_ROWS),
  );
  const responses = await Promise.all(
    chunks.map((chunk) =>
      apiClient.post<{ rows: DatabaseRow[] }>(
        API_ROUTES.databases.batchRows(databaseId),
        { ids: chunk },
        { signal },
      ),
    ),
  );
  return responses.flatMap((res) => res.data.rows);
}

/**
 * The rows `rowIds` of a database with their computed values, read together
 * (`readRelatedRows`): what a relation shows of the rows it points at, where
 * no view reads them for all its rows (`RelatedRowsProvider`).
 */
export function useRelatedRows(databaseId: string | undefined, rowIds: readonly string[]) {
  const { isAuthenticated } = useOxy();
  const ids = [...new Set(rowIds)].sort();
  return useQuery<DatabaseRow[]>({
    queryKey: databaseId
      ? queryKeys.databases.related(databaseId, ids)
      : ['database', 'none', 'related'],
    queryFn: async ({ signal }) => {
      if (!databaseId) throw new Error('Database id required');
      return readRelatedRows(databaseId, ids, signal);
    },
    enabled: isAuthenticated && Boolean(databaseId) && ids.length > 0,
  });
}

/** What a view read of one database its relations point at (`useRelatedRowSets`). */
export interface RelatedRowSet {
  /** The ids its rows' relations name. */
  requested: ReadonlySet<string>;
  /** Those read so far: the last set's while a new one is read. */
  readIds: ReadonlySet<string>;
  rows: ReadonlyMap<string, DatabaseRow>;
  isError: boolean;
}

/**
 * The rows `wanted` names, read together for each database (`readRelatedRows`):
 * every row a view's relations point at, by related database.
 */
export function useRelatedRowSets(
  wanted: readonly { databaseId: string; ids: readonly string[] }[],
): ReadonlyMap<string, RelatedRowSet> {
  const { isAuthenticated } = useOxy();
  const combine = useCallback(
    (results: { data?: { ids: readonly string[]; rows: DatabaseRow[] }; isError: boolean }[]) =>
      new Map(
        wanted.map(({ databaseId, ids }, i): [string, RelatedRowSet] => {
          const result = results[i];
          return [
            databaseId,
            {
              requested: new Set(ids),
              readIds: new Set(result?.data?.ids ?? []),
              rows: new Map((result?.data?.rows ?? []).map((row) => [row.id, row])),
              isError: result?.isError ?? false,
            },
          ];
        }),
      ),
    [wanted],
  );
  return useQueries({
    queries: wanted.map(({ databaseId, ids }) => ({
      queryKey: queryKeys.databases.relatedSet(databaseId, ids),
      queryFn: async ({ signal }: { signal: AbortSignal }) => ({
        ids,
        rows: await readRelatedRows(databaseId, ids, signal),
      }),
      enabled: isAuthenticated && ids.length > 0,
      // A row loaded or a value changed reads the set again: the titles shown stay meanwhile.
      placeholderData: keepPreviousData,
    })),
    combine,
  });
}

/** The most rows a relation's picker lists at once: more are found by searching. */
const ROW_SEARCH_SIZE = 25;

/**
 * Rows of a database whose title holds `search` (all of them, first ones
 * first, for an empty search), searched by the API: what a relation's picker
 * offers, whatever the size of the database.
 */
export function useRowSearch(databaseId: string | undefined, search: string, enabled = true) {
  const { isAuthenticated } = useOxy();
  const query = search.trim();
  return useQuery<DatabaseRow[]>({
    queryKey: queryKeys.databases.search(databaseId ?? 'none', query),
    queryFn: async ({ signal }) => {
      if (!databaseId) throw new Error('Database id required');
      const res = await apiClient.get<DatabaseRowsResponse>(
        API_ROUTES.databases.listRows(databaseId),
        {
          signal,
          params: { pageSize: String(ROW_SEARCH_SIZE), ...(query && { search: query }) },
        },
      );
      return res.data.rows;
    },
    // The rows found for the last search stay while the next is read.
    placeholderData: (previous) => previous,
    enabled: enabled && isAuthenticated && Boolean(databaseId),
  });
}

export function useCreateRow() {
  const queryClient = useQueryClient();
  return useMutation<DatabaseRow, Error, CreateRowInput>({
    mutationFn: async ({ databaseId, ...input }) => {
      const res = await apiClient.post<DatabaseRowResponse>(
        API_ROUTES.databases.createRow(databaseId),
        input,
      );
      return res.data.row;
    },
    onSettled: (_data, _err, { databaseId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.databases.templates(databaseId) });
      queryClient.invalidateQueries({
        queryKey: ['database', databaseId, 'rows'],
      });
    },
  });
}

/**
 * Row updates use the existing PATCH /pages/:id endpoint because a row
 * IS a Page with `databaseId` set. Either `properties` or page-level
 * fields (title, icon, etc.) can be updated in one request.
 */
export function useUpdateRow() {
  const queryClient = useQueryClient();
  return useMutation<DatabaseRow, Error, UpdateRowInput>({
    mutationFn: async ({ rowId, databaseId: _databaseId, ...patch }) => {
      const res = await apiClient.patch<PageResponse>(API_ROUTES.pages.update(rowId), patch);
      return pageToDatabaseRow(res.data.page);
    },
    onMutate: async ({ databaseId, rowId, ...patch }) => {
      await queryClient.cancelQueries({ queryKey: ['database', databaseId, 'rows'] });
      const queries = queryClient.getQueriesData<RowsCache>({
        queryKey: ['database', databaseId, 'rows'],
      });
      const previous: Array<{ key: unknown[]; data: unknown }> = [];
      for (const [key, data] of queries) {
        previous.push({ key: key as unknown[], data });
        if (!data) continue;
        queryClient.setQueryData<RowsCache>(key as unknown[], {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            rows: page.rows.map((r) =>
              r.id === rowId
                ? {
                    ...r,
                    ...patch,
                    properties: {
                      ...r.properties,
                      ...((patch.properties ?? {}) as Record<string, PropertyValue>),
                    },
                  }
                : r,
            ),
          })),
        });
      }
      // The row's own page shows it from its own query: it changes at once too.
      const rowKey = queryKeys.databases.row(databaseId, rowId);
      await queryClient.cancelQueries({ queryKey: rowKey });
      const row = queryClient.getQueryData<DatabaseRow>(rowKey);
      if (row) {
        previous.push({ key: [...rowKey], data: row });
        queryClient.setQueryData<DatabaseRow>(rowKey, {
          ...row,
          properties: {
            ...row.properties,
            ...((patch.properties ?? {}) as Record<string, PropertyValue>),
          },
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      const ctx = context as { previous?: Array<{ key: unknown[]; data: unknown }> } | undefined;
      if (!ctx?.previous) return;
      for (const entry of ctx.previous) {
        if (entry.data === undefined) continue;
        queryClient.setQueryData(entry.key, entry.data);
      }
    },
    onSettled: (_data, _err, { databaseId, rowId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.databases.templates(databaseId) });
      queryClient.invalidateQueries({
        queryKey: ['database', databaseId, 'rows'],
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.databases.row(databaseId, rowId) });
    },
  });
}

export function useDeleteRow() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, DeleteRowInput>({
    mutationFn: async ({ rowId }) => {
      // Row deletion is page deletion — soft-delete via /pages/:id with
      // archived: true. Hard delete is gated on workspace ownership.
      await apiClient.delete(API_ROUTES.pages.delete(rowId));
    },
    onSettled: (_data, _err, { databaseId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.databases.templates(databaseId) });
      queryClient.invalidateQueries({
        queryKey: ['database', databaseId, 'rows'],
      });
    },
  });
}
