import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
import type { PageResponse } from '../types/pages';
import { queryKeys } from './query-keys';
import { usePage } from './use-pages';
import { hasRole } from './workspace-roles';

export const historyOf = (pageId: string) => (query: { queryKey: readonly unknown[] }) =>
  (query.queryKey[0] === 'versions' || query.queryKey[0] === 'version') &&
  query.queryKey[1] === pageId;

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
