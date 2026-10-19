import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import { recentPageIds } from '../recent-visits';
import { useUIStore } from '../stores/ui-store';
import { queryKeys } from './query-keys';

/** A page the user opened, as `GET /pages/recent` lists it. */
export interface RecentPage {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  databaseId: string | null;
  visitedAt: string;
}

/** The user's recent pages in `workspaceId`, from every device, the latest first. */
export function useServerRecentPages(workspaceId: string | null) {
  const { isAuthenticated } = useOxy();
  return useQuery<RecentPage[]>({
    queryKey: queryKeys.recentPages.workspace(workspaceId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get<{ pages: RecentPage[] }>(API_ROUTES.pages.recent, {
          params: { workspaceId, limit: 20 },
          signal,
        })
      ).data.pages,
    enabled: Boolean(isAuthenticated && workspaceId),
    staleTime: 1000 * 30,
    retry: 1,
  });
}

/**
 * The ids of the recent pages to show (sidebar, Home, quick find): the
 * server's, else this device's while the server cannot be reached.
 */
export function useRecentPageIds(workspaceId: string | null): readonly string[] {
  const device = useUIStore((s) => s.recentPageIds);
  const { data } = useServerRecentPages(workspaceId);
  const server = React.useMemo(() => data?.map((page) => page.id), [data]);
  return recentPageIds(server, device);
}
