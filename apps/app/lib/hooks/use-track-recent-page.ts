import * as React from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
import apiClient from '@/lib/api/client';
import { API_ROUTES } from '@/lib/api/routes';
import { createVisitRecorder, type VisitRecorder } from '@/lib/recent-visits';
import { useUIStore } from '@/lib/stores/ui-store';
import { queryKeys } from './query-keys';

// One recorder for the app: its memory of what was sent outlives a screen.
let recorder: VisitRecorder | null = null;
let latestClient: QueryClient | null = null;

function visits(client: QueryClient): VisitRecorder {
  latestClient = client;
  recorder ??= createVisitRecorder({
    send: async (pageId) => {
      await apiClient.post(API_ROUTES.pages.visit(pageId));
      await latestClient?.invalidateQueries({ queryKey: queryKeys.recentPages.all });
    },
  });
  return recorder;
}

/**
 * Records the visited page in the recent pages: at once on this device (the
 * offline fallback), and on the server once the page has stayed open a
 * moment (`lib/recent-visits.ts`), so Recents follow the user to every device.
 *
 * Why a hook (vs calling addRecentPage directly): consumers usually only have
 * a `string | undefined` from a router param. This guards against logging
 * "undefined" and only fires when the id changes — avoiding redundant work on
 * every render of `[pageId].tsx`.
 */
export function useTrackRecentPage(pageId: string | undefined) {
  const addRecentPage = useUIStore((s) => s.addRecentPage);
  const { isAuthenticated } = useOxy();
  const client = useQueryClient();

  React.useEffect(() => {
    if (!pageId) return;
    addRecentPage(pageId);
    if (!isAuthenticated) return;
    const recording = visits(client);
    recording.open(pageId);
    return () => recording.close();
  }, [pageId, addRecentPage, isAuthenticated, client]);
}
