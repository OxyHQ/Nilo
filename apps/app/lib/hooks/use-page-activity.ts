import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { PageActivityPage } from '@oxy.so/nilo-contracts';
import type { Page } from '../types/pages';
import { queryKeys } from './query-keys';
import { readPageHistory, terminalHistoryError, useHistoryAccess } from './use-page-history-access';

/** Historical values stay in memory and share version-history permission retirement. */
export function usePageActivity(page: Pick<Page, 'id' | 'workspaceId'>) {
  const client = useQueryClient();
  const { canEdit, ready } = useHistoryAccess(page.id);
  const key = queryKeys.pageActivity.page(page.workspaceId, page.id);
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      readPageHistory<PageActivityPage>({
        client,
        pageId: page.id,
        key,
        url: `/pages/${page.id}/activity`,
        signal,
        ready,
        params: { limit: 20, cursor: pageParam ?? undefined },
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: (state) => ready && !terminalHistoryError(state.state.error),
    retry: (count, error) => !terminalHistoryError(error) && count < 2,
    staleTime: 0,
  });
  const items =
    ready && !terminalHistoryError(query.error)
      ? [
          ...new Map(
            (query.data?.pages ?? [])
              .flatMap((result) => result.items)
              .map((item) => [item.id, item]),
          ).values(),
        ]
      : [];
  return { ...query, canEdit, items, isLoading: canEdit && (!ready || query.isLoading) };
}
