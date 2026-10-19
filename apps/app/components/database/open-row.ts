import { useRouter } from 'expo-router';
import * as React from 'react';

/**
 * Opens a row as its own page, from any view, on web and native: the typed
 * route object, which needs no string to be parsed back into a route.
 */
export function useOpenRow(): (rowId: string) => void {
  const router = useRouter();
  return React.useCallback(
    (rowId: string) => router.push({ pathname: '/p/[pageId]', params: { pageId: rowId } }),
    [router],
  );
}
