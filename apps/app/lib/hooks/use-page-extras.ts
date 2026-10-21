import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
import axios from 'axios';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import config from '../config';
import type { ReadOnlyBlock } from '../block-tree';
import type { BreadcrumbEntry, Page, PageResponse } from '../types/pages';
import { useAuthQuery } from './create-query';
import { queryKeys } from './query-keys';
import { historyOf, useHistoryAccess } from './use-page-history-access';
import { hasRole } from './workspace-roles';

export interface PublicPage {
  page: Pick<
    Page,
    'id' | 'title' | 'icon' | 'cover' | 'coverPosition' | 'updatedAt' | 'font' | 'fullWidth'
  >;
  blocks: ReadOnlyBlock[];
  /** What each synced block on the page shows, by its original's id. */
  synced?: Record<string, ReadOnlyBlock[]>;
  children: BreadcrumbEntry[];
  breadcrumb: BreadcrumbEntry[];
  site: { slug: string; allowIndexing: boolean };
}
export function usePublicPage(slug: string, pageId?: string) {
  return useQuery({
    queryKey: queryKeys.publicPages.detail(slug, pageId),
    queryFn: async ({ signal }) =>
      (
        await axios.get<PublicPage>(`${config.apiUrl}${API_ROUTES.publicPage(slug, pageId)}`, {
          signal,
          timeout: 15000,
        })
      ).data,
    enabled: Boolean(slug),
    retry: false,
    staleTime: 0,
  });
}
export function usePublishPage(page: Page | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { published: boolean; allowIndexing?: boolean }) => {
      if (!page) throw new Error('Page required');
      const url = API_ROUTES.pages.publish(page.id);
      const response = input.published
        ? await apiClient.post(url, { allowIndexing: input.allowIndexing })
        : await apiClient.delete(url);
      return response.data as {
        published: boolean;
        slug: string;
        publishedAt: string | null;
        allowIndexing: boolean;
      };
    },
    onSuccess: async (result) => {
      if (!page) return;
      client.setQueryData<PageResponse>(queryKeys.pages.detail(page.id), (old) =>
        old
          ? {
              ...old,
              page: {
                ...old.page,
                publishedAt: result.published ? result.publishedAt : null,
                publishSlug: result.slug,
                publishIndexing: result.allowIndexing,
              },
            }
          : old,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.pages.detail(page.id) }),
        client.invalidateQueries({ queryKey: queryKeys.pages.list(page.workspaceId) }),
        client.invalidateQueries({ queryKey: queryKeys.pages.shared }),
        client.invalidateQueries({ queryKey: queryKeys.publicPages.all }),
      ]);
    },
  });
}
export interface PageVersion {
  id: string;
  createdAt: string;
  createdBy: string;
  blockCount: number;
}
function useHistoryQuery<T>(pageId: string, key: readonly string[], url: string, enabled = true) {
  const client = useQueryClient();
  const { canEdit, ready } = useHistoryAccess(pageId);
  const query = useQuery<T | null, Error, T | undefined>({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const access = client.getQueryState<PageResponse | null>(queryKeys.pages.detail(pageId));
      // refetch() is callable even on a disabled observer. Keep the same guard
      // at the transport boundary, including stale callbacks held by a dialog.
      if (
        !ready ||
        !enabled ||
        access?.isInvalidated ||
        access?.fetchStatus === 'fetching' ||
        !hasRole(access?.data?.role, 'editor')
      )
        throw new Error('Page history requires editor access');
      try {
        return (await apiClient.get<T>(url, { signal })).data;
      } catch (error) {
        if (
          !signal.aborted &&
          axios.isAxiosError(error) &&
          [401, 403, 404].includes(error.response?.status ?? 0)
        ) {
          client.setQueriesData({ predicate: historyOf(pageId) }, null);
          void client.invalidateQueries({ queryKey: queryKeys.pages.detail(pageId), exact: true });
        }
        throw error;
      }
    },
    select: (data) => data ?? undefined,
    enabled: ready && enabled,
    staleTime: 0,
    retry: (count, error) =>
      !(axios.isAxiosError(error) && [401, 403, 404].includes(error.response?.status ?? 0)) &&
      count < 2,
  });
  return {
    ...query,
    canEdit,
    isLoading: canEdit && (!ready || query.isLoading),
    data: ready && !query.isError ? query.data : undefined,
  };
}

export function usePageVersions(pageId: string) {
  return useHistoryQuery<{ versions: PageVersion[] }>(
    pageId,
    queryKeys.versions.list(pageId),
    API_ROUTES.pages.versions(pageId),
  );
}
export function usePageVersion(pageId: string, versionId: string) {
  return useHistoryQuery<{ version: Omit<PageVersion, 'blockCount'>; blocks: ReadOnlyBlock[] }>(
    pageId,
    queryKeys.versions.detail(pageId, versionId),
    API_ROUTES.pages.version(pageId, versionId),
    Boolean(versionId),
  );
}
export function useRestoreVersion(page: Page) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (versionId: string) => {
      const access = client.getQueryState<PageResponse | null>(queryKeys.pages.detail(page.id));
      if (
        access?.error ||
        access?.isInvalidated ||
        access?.fetchStatus === 'fetching' ||
        !hasRole(access?.data?.role, 'editor')
      )
        throw new Error('Page history requires editor access');
      return (await apiClient.post(API_ROUTES.pages.restoreVersion(page.id, versionId))).data;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.versions.list(page.id) }),
        client.invalidateQueries({ queryKey: queryKeys.blocks.list(page.id) }),
        client.invalidateQueries({ queryKey: queryKeys.pages.detail(page.id) }),
        client.invalidateQueries({ queryKey: queryKeys.pages.list(page.workspaceId) }),
        client.invalidateQueries({ queryKey: queryKeys.search.workspace(page.workspaceId) }),
        client.invalidateQueries({ queryKey: queryKeys.publicPages.all }),
      ]);
    },
  });
}
export interface Reminder {
  id: string;
  pageId: string;
  blockId: string | null;
  remindAt: string;
  note: string | null;
  sentAt: string | null;
  createdAt: string;
  page?: BreadcrumbEntry;
}
export function useReminders(pageId?: string) {
  const { user } = useOxy();
  return useAuthQuery<{ reminders: Reminder[] }>(
    queryKeys.reminders.list(user?.id, pageId),
    pageId ? API_ROUTES.pages.reminders(pageId) : API_ROUTES.reminders.list,
    undefined,
    { staleTime: 0, refetchInterval: 60_000 },
  );
}
export function useCreateReminder(pageId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { remindAt: string; note?: string; blockId?: string }) =>
      (await apiClient.post<{ reminder: Reminder }>(API_ROUTES.pages.reminders(pageId), input))
        .data,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.reminders.all }),
  });
}
export function useDeleteReminder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(API_ROUTES.reminders.delete(id));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.reminders.all }),
  });
}
