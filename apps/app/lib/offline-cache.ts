/**
 * What the app keeps of its queries on the device, so that without a
 * connection it still stands: the workspaces, the sidebar's page and database
 * lists, the teamspaces and pages' own records. Never blocks (pages kept
 * offline have their own copies, `lib/editor/offline-pages.ts`), comments,
 * search, notifications or anything else.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query, QueryClient, QueryKey } from '@tanstack/react-query';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import Constants from 'expo-constants';

/** How long a kept query may serve without being read again. */
export const SHELL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Each kept query by its key's first part, and how long its key is. */
const SHELL: readonly (readonly [string, number])[] = [
  ['workspaces', 1],
  ['workspace', 2],
  ['shared-pages', 1],
  ['pages', 2],
  ['databases', 2],
  ['teamspaces', 2],
  ['page', 2],
];

export function isShellQuery(key: QueryKey): boolean {
  return SHELL.some(([head, length]) => key[0] === head && key.length === length);
}

/** Kept queries live as long as they may be restored, and show what they have offline. */
export function configureShellQueries(client: QueryClient): void {
  for (const [head] of SHELL) {
    client.setQueryDefaults([head], { gcTime: SHELL_MAX_AGE_MS, networkMode: 'offlineFirst' });
  }
}

export const shellPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'nilo:query-cache',
  throttleTime: 1000,
});

export const shellPersistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: shellPersister,
  maxAge: SHELL_MAX_AGE_MS,
  // Another build may read its queries differently: it starts afresh.
  buster: Constants.expoConfig?.version ?? 'dev',
  dehydrateOptions: {
    shouldDehydrateQuery: (query: Query) =>
      query.state.status === 'success' && isShellQuery(query.queryKey),
  },
};
