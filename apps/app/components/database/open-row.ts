import { useRouter } from 'expo-router';
import * as React from 'react';
import type { DatabaseView, OpenRowMode } from '@/lib/types/databases';

/**
 * How the views around open a row (`OpenRowProvider`, `row-peek-provider.tsx`).
 * Kept apart from the peek itself, so a cell that opens rows does not load
 * the page editor.
 */
export const OpenRowContext = React.createContext<((rowId: string) => void) | null>(null);

/**
 * Opens a row, from any view, on web and native: as its view's setting says
 * (`config.openIn`) where a view provides one, else as its own page — the
 * typed route object, which needs no string to be parsed back into a route.
 */
export function useOpenRow(): (rowId: string) => void {
  const router = useRouter();
  const peek = React.useContext(OpenRowContext);
  return React.useCallback(
    (rowId: string) =>
      peek ? peek(rowId) : router.push({ pathname: '/p/[pageId]', params: { pageId: rowId } }),
    [peek, router],
  );
}

/** Where a view opens its rows: Notion's side peek unless it says otherwise. */
export function openRowMode(view: Pick<DatabaseView, 'config'>): OpenRowMode {
  return view.config?.openIn ?? 'side_peek';
}
