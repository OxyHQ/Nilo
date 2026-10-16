import {
  useInfiniteQuery,
  type InfiniteData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import axios from 'axios';
import { useOxy } from '@oxy.so/services';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import { queryKeys } from './query-keys';
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
function pageToDatabaseRow(page: Page): DatabaseRow {
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

/** Infinite queries refetch only the pages already loaded on live invalidation. */
export function useDatabaseRows(
  databaseId: string | undefined,
  viewId: string | null,
  type: DatabaseViewType = 'table',
) {
  const { isAuthenticated } = useOxy();
  const incremental = ['table', 'list', 'gallery'].includes(type);
  const query = useInfiniteQuery({
    queryKey: [
      ...queryKeys.databases.rows(databaseId ?? 'none', viewId),
      incremental ? 'paged' : 'all',
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
            params: { ...(viewId && { viewId }), pageSize: '100', ...(cursor && { cursor }) },
          },
        );
        result = result ? { ...data, rows: [...result.rows, ...data.rows] } : data;
        cursor = data.cursor;
      } while (!incremental && cursor);
      return result;
    },
    getNextPageParam: (last) => last.cursor ?? undefined,
    retry: (count, error) => {
      if (axios.isAxiosError(error) && [403, 404].includes(error.response?.status ?? 0))
        return false;
      return count < 2;
    },
    enabled: isAuthenticated && Boolean(databaseId),
  });
  const first = query.data?.pages[0];
  return {
    ...query,
    data: first ? { ...first, rows: uniqueRows(query.data?.pages ?? []) } : undefined,
  };
}

/**
 * The loaded pages' rows, each once. A row edited between two page requests
 * can move past the cursor and come again on a later page, and a view sorted
 * on a formula or rollup pages by offset, where a row inserted moves another
 * across the boundary.
 */
function uniqueRows(pages: readonly DatabaseRowsResponse[]): DatabaseRow[] {
  const seen = new Set<string>();
  const rows: DatabaseRow[] = [];
  for (const page of pages) {
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
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
      const previous: Array<{
        key: unknown[];
        data: RowsCache | undefined;
      }> = [];
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
      return { previous };
    },
    onError: (_err, _vars, context) => {
      const ctx = context as
        | {
            previous?: Array<{
              key: unknown[];
              data: RowsCache | undefined;
            }>;
          }
        | undefined;
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
