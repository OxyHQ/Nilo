import { useEffect, useState } from 'react';
import { useOxy } from '@oxy.so/services/ui/client';
import { API_ROUTES } from '../api/routes';
import type { SearchResponse } from '../types/search';
import { useAuthQuery } from './create-query';
import { queryKeys } from './query-keys';

export function useSearch(workspaceId: string | null, query: string, enabled: boolean) {
  const { isAuthenticated } = useOxy();
  const text = query.trim();
  const [debounced, setDebounced] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text), 150);
    return () => clearTimeout(timer);
  }, [text]);
  // Observe the current key immediately, detaching/aborting the old request.
  // Enable it only after the debounce so old results cannot flash while typing.
  const search = useAuthQuery<SearchResponse>(
    queryKeys.search.results(workspaceId, text),
    API_ROUTES.search,
    { workspaceId, q: text, limit: 20 },
    {
      enabled: isAuthenticated && enabled && Boolean(workspaceId && text) && text === debounced,
      staleTime: 0,
      retry: 1,
    },
  );
  return { ...search, isSearching: Boolean(text) && (text !== debounced || search.isFetching) };
}
