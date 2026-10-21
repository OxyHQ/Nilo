import { useEffect } from 'react';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import apiClient from '../api/client';
import { useOxy } from '@oxy.so/services/ui/client';
import type { PageResponse } from '../types/pages';
import { queryKeys } from './query-keys';
import { usePage } from './use-pages';
import { hasRole } from './workspace-roles';

export const historyOf = (pageId: string) => (query: { queryKey: readonly unknown[] }) =>
  ((query.queryKey[0] === 'versions' || query.queryKey[0] === 'version') &&
    query.queryKey[1] === pageId) ||
  (query.queryKey[0] === 'page-activity' && query.queryKey[2] === pageId);

/** Historical content has a stricter policy than current page metadata. */
export function useHistoryAccess(pageId: string) {
  const { isAuthenticated } = useOxy();
  const client = useQueryClient();
  const access = usePage(pageId);
  const editor = hasRole(access.data?.role, 'editor');
  const denied = !isAuthenticated || access.isError || (Boolean(access.data) && !editor);
  useEffect(() => {
    if (!denied) return;
    // Cancel before retiring: an older transport response cannot restore history
    // after a permission downgrade. Both list and preview are memory-only keys.
    void client.cancelQueries({ predicate: historyOf(pageId) }).then(() => {
      const current = client.getQueryState<PageResponse | null>(queryKeys.pages.detail(pageId));
      if (!isAuthenticated || current?.error || !hasRole(current?.data?.role, 'editor'))
        client.setQueriesData({ predicate: historyOf(pageId) }, null);
    });
  }, [client, pageId, denied, isAuthenticated]);
  const canEdit = isAuthenticated && editor && !access.isError;
  return { canEdit, ready: canEdit && access.fetchStatus === 'idle' && !access.isPending };
}

export function usePageHistoryAccess(pageId: string) {
  return useHistoryAccess(pageId).canEdit;
}

export const terminalHistoryError = (error: unknown) =>
  axios.isAxiosError(error) && [401, 403, 404].includes(error.response?.status ?? 0);

/** One transport boundary for version snapshots and the page's historical activity. */
export async function readPageHistory<T>({
  client,
  pageId,
  key,
  url,
  signal,
  ready,
  enabled = true,
  params,
}: {
  client: QueryClient;
  pageId: string;
  key: readonly unknown[];
  url: string;
  signal: AbortSignal;
  ready: boolean;
  enabled?: boolean;
  params?: Record<string, string | number | undefined>;
}): Promise<T> {
  const access = client.getQueryState<PageResponse | null>(queryKeys.pages.detail(pageId));
  if (
    !ready ||
    !enabled ||
    access?.error ||
    access?.isInvalidated ||
    access?.fetchStatus !== 'idle' ||
    !hasRole(access?.data?.role, 'editor')
  )
    throw new Error('Page history requires editor access');
  try {
    return (await apiClient.get<T>(url, { signal, ...(params ? { params } : {}) })).data;
  } catch (error) {
    if (!signal.aborted && terminalHistoryError(error)) {
      if (key[0] === 'version' && axios.isAxiosError(error) && error.response?.status === 404) {
        // Retention can remove a selected snapshot without revoking page access.
        client.setQueryData(key, null);
      } else {
        const current = client.getQueryCache().find({ queryKey: key, exact: true });
        void client.cancelQueries({
          predicate: (query) => historyOf(pageId)(query) && query !== current,
        });
        // Preserve terminal errors: clearing an error can restart sibling reads
        // after every metadata recheck, creating a denial loop.
        client.setQueriesData(
          {
            predicate: (query) => historyOf(pageId)(query) && query.state.data != null,
          },
          null,
        );
        void client.invalidateQueries({ queryKey: queryKeys.pages.detail(pageId), exact: true });
      }
    }
    throw error;
  }
}
