import { useWorkspaceLive } from '../realtime/use-live-updates';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
import axios from 'axios';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import { useAuthQuery } from './create-query';
import { queryKeys } from './query-keys';
import type { BreadcrumbResponse, Page, PageResponse, PagesListResponse } from '../types/pages';

interface CreatePageInput {
  workspaceId: string;
  parentId?: string | null;
  teamspaceId?: string | null;
  title?: string;
  icon?: string | null;
}

interface UpdatePageInput {
  id: string;
  fullWidth?: boolean;
  smallText?: boolean;
  font?: Page['font'];
  mode?: Page['mode'];
  locked?: boolean;
  title?: string;
  icon?: string | null;
  cover?: string | null;
  coverPosition?: number;
  parentId?: string | null;
  teamspaceId?: string | null;
  archived?: boolean;
  template?: boolean;
  /**
   * Owned by the Page chrome agent (#14). Forwarded as-is to the API; if the
   * backend hasn't shipped the column yet, the update is a safe no-op.
   */
  favorited?: boolean;
  /** Sibling order; consumed by drag-to-reorder. */
  order?: number;
}

export function usePages(workspaceId: string | null) {
  useWorkspaceLive(workspaceId);
  const { isAuthenticated } = useOxy();

  return useQuery<PagesListResponse>({
    queryKey: queryKeys.pages.list(workspaceId),
    queryFn: async () => {
      const res = await apiClient.get(API_ROUTES.pages.list, {
        params: workspaceId ? { workspaceId } : undefined,
      });
      return res.data;
    },
    staleTime: 1000 * 30,
    enabled: isAuthenticated && Boolean(workspaceId),
  });
}

/** Templates use a separate cache below the workspace page-list key. */
export function useTemplates(workspaceId: string | null) {
  useWorkspaceLive(workspaceId);
  const { isAuthenticated } = useOxy();
  return useAuthQuery<PagesListResponse>(
    queryKeys.pages.templates(workspaceId),
    API_ROUTES.pages.list,
    { workspaceId, templates: 'only' },
    { enabled: isAuthenticated && Boolean(workspaceId), staleTime: 30_000 },
  );
}

export function usePage(id: string | undefined) {
  const { isAuthenticated } = useOxy();

  return useQuery<PageResponse>({
    queryKey: id ? queryKeys.pages.detail(id) : ['page', 'none'],
    queryFn: async () => {
      if (!id) throw new Error('Page id required');
      const res = await apiClient.get(API_ROUTES.pages.get(id));
      return res.data;
    },
    retry: (count, error) => {
      if (axios.isAxiosError(error) && [401, 403, 404].includes(error.response?.status ?? 0))
        return false;
      return count < 2;
    },
    enabled: isAuthenticated && Boolean(id),
  });
}

export function useCreatePage() {
  const queryClient = useQueryClient();

  return useMutation<Page, Error, CreatePageInput>({
    mutationFn: async (input) => {
      const res = await apiClient.post<PageResponse>(API_ROUTES.pages.create, input);
      return res.data.page;
    },
    onSuccess: (page) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.search.workspace(page.workspaceId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.pages.list(page.workspaceId),
      });
    },
  });
}

export function useUpdatePage() {
  const queryClient = useQueryClient();

  return useMutation<Page, Error, UpdatePageInput>({
    mutationKey: ['page-update'],
    mutationFn: async ({ id, ...patch }) => {
      const res = await apiClient.patch<PageResponse>(API_ROUTES.pages.update(id), patch);
      return res.data.page;
    },
    onMutate: async ({ id, ...patch }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.pages.detail(id) });
      const previous = queryClient.getQueryData<PageResponse>(queryKeys.pages.detail(id));
      if (previous) {
        queryClient.setQueryData<PageResponse>(queryKeys.pages.detail(id), {
          ...previous,
          page: { ...previous.page, ...patch } as Page,
        });
      }
      return { previous };
    },
    onError: (_err, { id }, context) => {
      const ctx = context as { previous?: PageResponse } | undefined;
      if (ctx?.previous) {
        queryClient.setQueryData(queryKeys.pages.detail(id), ctx.previous);
      }
    },
    onSettled: (page, _error, { id, parentId, teamspaceId, title, icon }) => {
      if (parentId !== undefined || teamspaceId !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['page'] });
        queryClient.invalidateQueries({ queryKey: ['page-permissions'] });
        queryClient.invalidateQueries({ queryKey: ['database'] });
        queryClient.invalidateQueries({ queryKey: ['databases'] });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.pages.detail(id) });
      if (!page) return;
      if (title !== undefined || icon !== undefined) {
        // A renamed ancestor appears in descendants' paths, not their detail queries.
        queryClient.invalidateQueries({
          predicate: (query) =>
            query.queryKey[0] === 'page' &&
            query.queryKey[2] === 'breadcrumb' &&
            query.queryKey[1] !== id &&
            query.queryKey[3] === page.workspaceId &&
            (query.state.data as BreadcrumbResponse | undefined)?.breadcrumb.some(
              (entry) => entry.id === id,
            ) === true,
        });
      }
      if (page.databaseId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.databases.detail(page.databaseId) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.search.workspace(page.workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.pages.shared });
      queryClient.invalidateQueries({
        queryKey: queryKeys.pages.list(page.workspaceId),
      });
    },
  });
}

interface DeletePageInput {
  id: string;
  workspaceId: string;
  /** When true, permanently delete from PostgreSQL (owner only). */
  hard?: boolean;
}

export function useDeletePage() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, DeletePageInput>({
    mutationFn: async ({ id, hard }) => {
      await apiClient.delete(API_ROUTES.pages.delete(id), {
        params: hard ? { hard: 'true' } : undefined,
      });
    },
    onSuccess: (_data, { workspaceId, id }) => {
      const page = queryClient.getQueryData<PageResponse>(queryKeys.pages.detail(id))?.page;
      if (page?.databaseId)
        queryClient.invalidateQueries({ queryKey: queryKeys.databases.detail(page.databaseId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.search.workspace(workspaceId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.pages.list(workspaceId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.pages.archived(workspaceId),
      });
      queryClient.removeQueries({ queryKey: queryKeys.pages.detail(id) });
    },
  });
}

/**
 * Server-side duplicate (POST /pages/:id/duplicate). The backend copies the
 * page, its blocks and its subpages and returns the new page.
 */
export function useDuplicatePage() {
  const queryClient = useQueryClient();

  return useMutation<
    Page,
    Error,
    {
      id: string;
      workspaceId: string;
      fromTemplate?: true;
      parentId?: string | null;
      teamspaceId?: string | null;
    }
  >({
    mutationFn: async ({ id, fromTemplate, parentId, teamspaceId }) => {
      const res = await apiClient.post<PageResponse>(API_ROUTES.pages.duplicate(id), {
        fromTemplate,
        parentId: fromTemplate ? (parentId ?? null) : parentId,
        teamspaceId,
      });
      return res.data.page;
    },
    onSuccess: (_page, { workspaceId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.search.workspace(workspaceId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.pages.list(workspaceId),
      });
    },
  });
}

/**
 * Fetches the breadcrumb chain for a page (root → current). Used by the
 * page-chrome breadcrumb header. Cached separately from the page detail.
 */
export function useBreadcrumb(
  pageId: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  useWorkspaceLive(workspaceId);
  const { isAuthenticated } = useOxy();

  return useQuery<BreadcrumbResponse>({
    queryKey: queryKeys.pages.breadcrumb(pageId ?? 'none', workspaceId),
    queryFn: async () => {
      if (!pageId) throw new Error('Page id required');
      const res = await apiClient.get(API_ROUTES.pages.breadcrumb(pageId));
      return res.data;
    },
    enabled: isAuthenticated && Boolean(pageId) && Boolean(workspaceId),
    staleTime: 1000 * 30,
  });
}

/**
 * Lists archived pages for a workspace. Backs the /trash route.
 */
export function useArchivedPages(workspaceId: string | null) {
  useWorkspaceLive(workspaceId);
  const { isAuthenticated } = useOxy();

  return useQuery<PagesListResponse>({
    queryKey: queryKeys.pages.archived(workspaceId),
    queryFn: async () => {
      const res = await apiClient.get(API_ROUTES.pages.list, {
        params: workspaceId
          ? { workspaceId, archivedOnly: 'true', includeArchived: 'true', templates: 'include' }
          : undefined,
      });
      return res.data;
    },
    staleTime: 1000 * 10,
    enabled: isAuthenticated && Boolean(workspaceId),
  });
}

/**
 * Empties the workspace trash (owner only). Cascade-deletes archived pages
 * and their blocks.
 */
export function useEmptyTrash() {
  const queryClient = useQueryClient();

  return useMutation<{ deleted: number }, Error, { workspaceId: string }>({
    mutationFn: async ({ workspaceId }) => {
      const res = await apiClient.post<{ success: boolean; deleted: number }>(
        API_ROUTES.workspaces.emptyTrash(workspaceId),
      );
      return { deleted: res.data.deleted };
    },
    onSuccess: (_data, { workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.pages.archived(workspaceId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.pages.list(workspaceId),
      });
    },
  });
}
