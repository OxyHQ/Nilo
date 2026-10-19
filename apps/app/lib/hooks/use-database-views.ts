import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import { queryKeys } from './query-keys';
import type {
  DatabaseView,
  DatabaseViewResponse,
  DatabaseViewType,
  DatabaseViewsResponse,
  FilterGroup,
  ViewConfig,
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
  groupBy?: { propertyId: string } | null;
  hiddenProperties?: string[];
  frozenProperties?: string[];
  pageSize?: number;
  config?: ViewConfig;
  order?: number;
}

interface UpdateViewInput {
  databaseId: string;
  viewId: string;
  name?: string;
  type?: DatabaseViewType;
  isDefault?: boolean;
  filters?: FilterGroup;
  sorts?: ViewSort[];
  groupBy?: { propertyId: string } | null;
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

export function useUpdateView() {
  const queryClient = useQueryClient();
  return useMutation<DatabaseView, Error, UpdateViewInput>({
    mutationFn: async ({ databaseId, viewId, ...patch }) => {
      const res = await apiClient.patch<DatabaseViewResponse>(
        API_ROUTES.databases.updateView(databaseId, viewId),
        patch,
      );
      return res.data.view;
    },
    onSuccess: (view, { databaseId, viewId }) => {
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
