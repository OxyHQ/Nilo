import { create } from 'zustand';

/**
 * What each view's rows are searched for (by title), by view id: the search
 * box in the view's toolbar sets it and `useDatabaseRows` reads only the rows
 * that match (`GET /databases/:id/rows?search=`), wherever the view is shown.
 * Not saved with the view: a search is the reader's, as in Notion.
 */
interface ViewSearchState {
  byView: Record<string, string>;
  search: (viewId: string, text: string) => void;
}

export const useViewSearchStore = create<ViewSearchState>()((set) => ({
  byView: {},
  search: (viewId, text) =>
    set((state) => {
      const next = text.trim().slice(0, 200);
      if ((state.byView[viewId] ?? '') === next) return state;
      const byView = { ...state.byView };
      if (next) byView[viewId] = next;
      else delete byView[viewId];
      return { byView };
    }),
}));
