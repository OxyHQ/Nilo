import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ViewGroupKey } from '../types/databases';

/** The views whose collapsed groups a device remembers: the most recent ones. */
const MAX_VIEWS = 200;

/**
 * The groups a reader collapsed in each view, by view id, on this device: a
 * reader may not change the view (`config.collapsedGroups`, which its editors
 * set for everyone), so what they collapse stays theirs. Persisted, so a
 * view opens as it was left. A view with no entry shows its own collapsing.
 */
interface CollapsedGroupsState {
  byView: Record<string, ViewGroupKey[]>;
  setCollapsed: (viewId: string, keys: ViewGroupKey[]) => void;
}

export const useCollapsedGroupsStore = create<CollapsedGroupsState>()(
  persist(
    (set) => ({
      byView: {},
      setCollapsed: (viewId, keys) =>
        set((state) => {
          // The view moves to the end: the oldest go first past the limit.
          const { [viewId]: _previous, ...others } = state.byView;
          const entries = Object.entries(others);
          const kept = entries.slice(Math.max(0, entries.length - (MAX_VIEWS - 1)));
          return { byView: { ...Object.fromEntries(kept), [viewId]: [...keys] } };
        }),
    }),
    {
      name: 'collapsed-groups',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ byView: state.byView }),
      version: 1,
    },
  ),
);
