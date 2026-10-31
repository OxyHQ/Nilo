import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ViewGroupKey } from '../types/databases';

/** The views whose collapsed groups a device remembers: the most recent ones. */
const MAX_VIEWS = 200;

// Serialize persistence with account-boundary cleanup: an older write must not
// complete after the empty state has been written for the next account.
let pendingStorage: Promise<void> = Promise.resolve();
function inStorageOrder<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingStorage.then(operation);
  pendingStorage = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
const storage = {
  getItem: (name: string) => inStorageOrder(() => AsyncStorage.getItem(name)),
  setItem: (name: string, value: string) => inStorageOrder(() => AsyncStorage.setItem(name, value)),
  removeItem: (name: string) => inStorageOrder(() => AsyncStorage.removeItem(name)),
};

/**
 * The groups a reader collapsed in each view, by view id, on this device: a
 * reader may not change the view (`config.collapsedGroups`, which its editors
 * set for everyone), so what they collapse stays theirs. Persisted, so a
 * view opens as it was left. A view with no entry shows its own collapsing.
 */
interface CollapsedGroupsState {
  byView: Record<string, ViewGroupKey[]>;
  /** Changes whenever account data is cleared, invalidating older callbacks. */
  generation: number;
  setCollapsed: (viewId: string, keys: ViewGroupKey[]) => void;
}

export const useCollapsedGroupsStore = create<CollapsedGroupsState>()(
  persist(
    (set) => ({
      byView: {},
      generation: 0,
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
      storage: createJSONStorage(() => storage),
      partialize: (state) => ({ byView: state.byView }),
      version: 1,
    },
  ),
);

/** Remove account-specific group values after any pending hydration and writes. */
export async function clearCollapsedGroups(): Promise<void> {
  // A fresh hydration invalidates any previous in-flight hydration in Zustand.
  await useCollapsedGroupsStore.persist.rehydrate();
  await useCollapsedGroupsStore.setState((state) => ({
    byView: {},
    generation: state.generation + 1,
  }));
}
