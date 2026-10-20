import type { NavigationNeighbor, NavigationNeighbors } from '@oxy.so/nilo-contracts';
import { useOxy } from '@oxy.so/services/ui/client';
import { type InfiniteData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import apiClient from '../api/client';
import { queryKeys } from './query-keys';
import { useWorkspaceLive } from '../realtime/use-live-updates';

export interface BreadcrumbNeighborAnchor {
  kind: 'page' | 'database';
  id: string;
  workspaceId: string;
}

export type BreadcrumbNeighbor = NavigationNeighbor;
export type BreadcrumbNeighborsResponse = NavigationNeighbors;

export const breadcrumbNeighborsKey = (anchor: BreadcrumbNeighborAnchor) =>
  queryKeys.breadcrumbNeighbors.anchor(anchor.workspaceId, anchor.kind, anchor.id);

function unavailable(error: unknown) {
  return axios.isAxiosError(error) && [401, 403, 404].includes(error.response?.status ?? 0);
}

/** Server-authorized sibling navigation. Never derive neighbors from workspace caches. */
export function useBreadcrumbNeighbors(
  anchor: BreadcrumbNeighborAnchor,
  { enabled }: { enabled: boolean },
) {
  const { isAuthenticated } = useOxy();
  const client = useQueryClient();
  const active = enabled && isAuthenticated && Boolean(anchor.id && anchor.workspaceId);
  useWorkspaceLive(active ? anchor.workspaceId : undefined);
  const key = breadcrumbNeighborsKey(anchor);
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const resource = anchor.kind === 'database' ? 'databases' : 'pages';
      try {
        const response = await apiClient.get<BreadcrumbNeighborsResponse>(
          `/${resource}/${anchor.id}/neighbors`,
          { params: { limit: 6, ...(pageParam ? { cursor: pageParam } : {}) }, signal },
        );
        return response.data;
      } catch (error) {
        // A later offline/error retry must not resurrect previously authorized names.
        // An aborted request no longer owns this cache entry.
        if (!signal.aborted && unavailable(error)) {
          client.setQueryData<InfiniteData<BreadcrumbNeighborsResponse, string | null>>(key, {
            pages: [],
            pageParams: [],
          });
        }
        throw error;
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: active,
    staleTime: 0,
    retry: (count, error) => !unavailable(error) && count < 1,
  });
  // Opening the menu revalidates permission before exposing a previous response.
  // Loading more retains the already verified page while its next page arrives.
  const checking =
    query.fetchStatus === 'paused' || (query.isFetching && !query.isFetchingNextPage);
  const readable = active && !query.isError && !checking;
  const items = readable ? (query.data?.pages.flatMap((page) => page.items) ?? []) : [];

  return {
    items,
    isLoading: active && (query.isPending || checking),
    isFetching: active && query.isFetching,
    isError: active && query.isError,
    error: active ? query.error : null,
    hasMore: readable && Boolean(query.hasNextPage),
    isLoadingMore: active && query.isFetchingNextPage,
    loadMore: async () => {
      if (active && !query.isError && query.hasNextPage && !query.isFetching) {
        await query.fetchNextPage();
      }
    },
    refetch: async () => {
      if (active) await query.refetch();
    },
  };
}
