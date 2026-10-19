import { create } from 'zustand';
import type { FilterGroup } from '@/lib/types/databases';

/**
 * The dates each calendar or timeline view shows, by view id, as the filter
 * its rows are read with (`lib/visible-dates.ts`). The view sets it as it is
 * navigated and `useDatabaseRows` reads only those rows, where it used to read
 * the whole database page by page.
 */
interface VisibleDatesState {
  byView: Record<string, FilterGroup>;
  show: (viewId: string, filter: FilterGroup) => void;
}

export const useVisibleDatesStore = create<VisibleDatesState>()((set) => ({
  byView: {},
  show: (viewId, filter) =>
    set((state) =>
      JSON.stringify(state.byView[viewId]) === JSON.stringify(filter)
        ? state
        : { byView: { ...state.byView, [viewId]: filter } },
    ),
}));
