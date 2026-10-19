import { useQuery } from '@tanstack/react-query';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import { useViewSearchStore } from '../stores/view-search-store';
import type { ViewCalculationsResponse, ViewChartResponse } from '../types/databases';
import { readerTimeZone } from '../time-zone';
import { queryKeys } from './query-keys';

/**
 * What a view computes over all its rows, searched as it is: its footer's
 * calculations, a chart's points. Kept under the view's rows, so a row
 * changed, added or removed (which refreshes the rows) refreshes these too.
 */
function useViewComputed<T>(
  kind: 'calculations' | 'chart',
  databaseId: string,
  viewId: string,
  enabled: boolean,
) {
  const search = useViewSearchStore((state) => state.byView[viewId] ?? '');
  return useQuery<T>({
    queryKey: [...queryKeys.databases.rows(databaseId, viewId), kind, search],
    queryFn: async ({ signal }) => {
      const timeZone = readerTimeZone();
      const res = await apiClient.get<T>(
        kind === 'calculations'
          ? API_ROUTES.databases.viewCalculations(databaseId, viewId)
          : API_ROUTES.databases.viewChart(databaseId, viewId),
        { signal, params: { ...(search && { search }), ...(timeZone && { timeZone }) } },
      );
      return res.data;
    },
    // A search typed shows the last values until the next are read.
    placeholderData: (previous) => previous,
    enabled,
  });
}

/** A view's footer calculations (`config.calculations`), over every row it shows. */
export function useViewCalculations(databaseId: string, viewId: string, enabled = true) {
  return useViewComputed<ViewCalculationsResponse>('calculations', databaseId, viewId, enabled);
}

/** A chart view's points, one per group of its axis. */
export function useViewChart(databaseId: string, viewId: string, enabled = true) {
  return useViewComputed<ViewChartResponse>('chart', databaseId, viewId, enabled);
}
