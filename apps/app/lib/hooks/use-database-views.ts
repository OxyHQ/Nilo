import axios from 'axios';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
import apiClient, { patchForApiSession } from '../api/client';
import { apiSessionContextVersion } from '../api/session-context';
import { API_ROUTES } from '../api/routes';
import { queryKeys } from './query-keys';
import type {
  DatabaseView,
  DatabaseViewResponse,
  DatabaseViewType,
  DatabaseViewsResponse,
  FilterGroup,
  ViewConfig,
  ViewGroupBy,
  ViewSort,
} from '../types/databases';

interface CreateViewInput {
  blockId?: string;
  databaseId: string;
  name: string;
  type: DatabaseViewType;
  isDefault?: boolean;
  filters?: FilterGroup;
  sorts?: ViewSort[];
  groupBy?: ViewGroupBy | null;
  subGroupBy?: ViewGroupBy | null;
  hiddenProperties?: string[];
  frozenProperties?: string[];
  pageSize?: number;
  config?: ViewConfig;
  order?: number;
}

interface UpdateViewInput {
  /** Session of a retained interaction; omitted by callers without a session-bound owner. */
  expectedSession?: number;
  databaseId: string;
  viewId: string;
  name?: string;
  type?: DatabaseViewType;
  isDefault?: boolean;
  filters?: FilterGroup;
  sorts?: ViewSort[];
  groupBy?: ViewGroupBy | null;
  subGroupBy?: ViewGroupBy | null;
  hiddenProperties?: string[];
  frozenProperties?: string[];
  pageSize?: number;
  config?: ViewConfig;
  order?: number;
}

interface DeleteViewInput {
  blockId?: string | null;
  databaseId: string;
  viewId: string;
}

export function useDatabaseViews(databaseId: string | undefined, blockId?: string, enabled = true) {
  const { isAuthenticated } = useOxy();
  return useQuery<DatabaseViewsResponse>({
    queryKey: databaseId
      ? blockId
        ? queryKeys.databases.blockViews(databaseId, blockId)
        : queryKeys.databases.views(databaseId)
      : ['database', 'none', 'views'],
    queryFn: async () => {
      if (!databaseId) throw new Error('Database id required');
      const res = await apiClient.get<DatabaseViewsResponse>(
        API_ROUTES.databases.listViews(databaseId),
        { params: blockId ? { blockId } : undefined },
      );
      return res.data;
    },
    retry: (count, error) => {
      if (axios.isAxiosError(error) && [403, 404].includes(error.response?.status ?? 0))
        return false;
      return count < 2;
    },
    enabled: enabled && isAuthenticated && Boolean(databaseId),
  });
}

export function useCreateView() {
  const queryClient = useQueryClient();
  return useMutation<DatabaseView, Error, CreateViewInput>({
    mutationFn: async ({ databaseId, ...input }) => {
      const res = await apiClient.post<DatabaseViewResponse>(
        API_ROUTES.databases.createView(databaseId),
        input,
      );
      return res.data.view;
    },
    onSuccess: (view, { databaseId, blockId }) => {
      const key = blockId
        ? queryKeys.databases.blockViews(databaseId, blockId)
        : queryKeys.databases.views(databaseId);
      queryClient.setQueryData<DatabaseViewsResponse>(key, (old) => ({
        views: [...(old?.views ?? []).filter((v) => v.id !== view.id), view],
      }));
      void queryClient.invalidateQueries({ queryKey: key, exact: true });
      if (!blockId)
        void queryClient.invalidateQueries({
          queryKey: queryKeys.databases.detail(databaseId),
          exact: true,
        });
    },
  });
}

type ViewsCache = { views: DatabaseView[] } | undefined;

/**
 * `patch` applied to view `viewId` wherever it is cached (the database's
 * detail, its views, a linked block's), so a setting shows as changed at
 * once; the snapshots taken, to restore on failure. A view made the default
 * demotes the others, as the API does.
 */
function patchCachedView(
  client: QueryClient,
  databaseId: string,
  viewId: string,
  patch: Partial<DatabaseView>,
): Array<[readonly unknown[], unknown]> {
  const entries = client.getQueriesData<ViewsCache>({ queryKey: ['database', databaseId] });
  const snapshots: Array<[readonly unknown[], unknown]> = [];
  for (const [key, data] of entries) {
    if (!data || !Array.isArray((data as { views?: unknown }).views)) continue;
    if (!data.views.some((v) => v.id === viewId)) continue;
    snapshots.push([key, data]);
    const views = data.views.map((v) =>
      v.id === viewId
        ? { ...v, ...patch }
        : patch.isDefault && v.blockId === data.views.find((x) => x.id === viewId)?.blockId
          ? { ...v, isDefault: false }
          : v,
    );
    // Listed by order, as the API lists them: a moved view moves at once.
    if (patch.order !== undefined) views.sort((a, b) => a.order - b.order);
    client.setQueryData(key, { ...data, views });
  }
  return snapshots;
}

export function useUpdateView() {
  const queryClient = useQueryClient();
  return useMutation<DatabaseView, Error, UpdateViewInput, Array<[readonly unknown[], unknown]>>({
    mutationFn: async ({ databaseId, viewId, expectedSession, ...patch }) => {
      if (expectedSession !== undefined && expectedSession !== apiSessionContextVersion())
        throw new Error('The request session changed');
      const url = API_ROUTES.databases.updateView(databaseId, viewId);
      const res =
        expectedSession === undefined
          ? await apiClient.patch<DatabaseViewResponse>(url, patch)
          : await patchForApiSession<DatabaseViewResponse>(url, patch, expectedSession);
      return res.data.view;
    },
    onMutate: async ({ databaseId, viewId, expectedSession, ...patch }) => {
      if (expectedSession !== undefined && expectedSession !== apiSessionContextVersion())
        return [];
      await queryClient.cancelQueries({
        queryKey: queryKeys.databases.detail(databaseId),
        exact: true,
      });
      if (expectedSession !== undefined && expectedSession !== apiSessionContextVersion())
        return [];
      return patchCachedView(queryClient, databaseId, viewId, patch);
    },
    onError: (_error, { expectedSession }, snapshots) => {
      if (expectedSession !== undefined && expectedSession !== apiSessionContextVersion()) return;
      for (const [key, data] of snapshots ?? []) queryClient.setQueryData(key, data);
    },
    onSuccess: (view, { databaseId, viewId, expectedSession }) => {
      if (expectedSession !== undefined && expectedSession !== apiSessionContextVersion()) return;
      const key = view.blockId
        ? queryKeys.databases.blockViews(databaseId, view.blockId)
        : queryKeys.databases.views(databaseId);
      void queryClient.invalidateQueries({ queryKey: key, exact: true });
      if (!view.blockId)
        void queryClient.invalidateQueries({
          queryKey: queryKeys.databases.detail(databaseId),
          exact: true,
        });
      void queryClient.invalidateQueries({ queryKey: queryKeys.forms.link(databaseId, viewId) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.databases.rows(databaseId, viewId),
      });
    },
  });
}

export function useDeleteView() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, DeleteViewInput>({
    mutationFn: async ({ databaseId, viewId }) => {
      await apiClient.delete(API_ROUTES.databases.deleteView(databaseId, viewId));
    },
    onSuccess: (_data, { databaseId, viewId, blockId }) => {
      const key = blockId
        ? queryKeys.databases.blockViews(databaseId, blockId)
        : queryKeys.databases.views(databaseId);
      void queryClient.invalidateQueries({ queryKey: key, exact: true });
      if (!blockId)
        void queryClient.invalidateQueries({
          queryKey: queryKeys.databases.detail(databaseId),
          exact: true,
        });
      queryClient.removeQueries({ queryKey: queryKeys.databases.rows(databaseId, viewId) });
      queryClient.removeQueries({ queryKey: queryKeys.forms.link(databaseId, viewId) });
    },
  });
}
