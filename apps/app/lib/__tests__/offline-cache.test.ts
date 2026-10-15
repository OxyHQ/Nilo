import { type Query, QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/hooks/query-keys';
import { teamspaceKeys } from '@/lib/hooks/use-teamspaces';
import { workspaceKeys } from '@/lib/hooks/workspace-keys';
import {
  configureShellQueries,
  isShellQuery,
  SHELL_MAX_AGE_MS,
  shellPersistOptions,
} from '../offline-cache';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@oxy.so/services', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/api/client', () => ({ __esModule: true, default: {} }));

it('keeps what the app needs to stand up without a connection', () => {
  for (const key of [
    workspaceKeys.list,
    workspaceKeys.detail('w'),
    queryKeys.pages.list('w'),
    queryKeys.pages.shared,
    queryKeys.pages.detail('p'),
    queryKeys.databases.list('w'),
    teamspaceKeys.list('w'),
  ]) {
    expect([key, isShellQuery(key)]).toEqual([key, true]);
  }
});

it('never keeps blocks, comments, search, rows or what hangs off a page', () => {
  for (const key of [
    queryKeys.blocks.list('p'),
    queryKeys.comments.page('p', false),
    queryKeys.search.results('w', 'q'),
    queryKeys.databases.rows('d', null),
    queryKeys.pages.backlinks('p'),
    queryKeys.pages.follow('p'),
    queryKeys.pages.permissions('p'),
    queryKeys.pages.archived('w'),
    queryKeys.pages.templates('w'),
    ['notifications'],
  ]) {
    expect([key, isShellQuery(key)]).toEqual([key, false]);
  }
});

it('writes only the kept queries that succeeded', () => {
  const should = shellPersistOptions.dehydrateOptions?.shouldDehydrateQuery as (
    q: Query,
  ) => boolean;
  const query = (queryKey: unknown[], status: string) =>
    ({ queryKey, state: { status } }) as unknown as Query;
  expect(should(query(['pages', 'w'], 'success'))).toBe(true);
  expect(should(query(['pages', 'w'], 'error'))).toBe(false);
  expect(should(query(['blocks', 'p'], 'success'))).toBe(false);
  expect(shellPersistOptions.maxAge).toBe(SHELL_MAX_AGE_MS);
});

it('lets kept queries live as long as they may be restored, and show offline', () => {
  const client = new QueryClient();
  configureShellQueries(client);
  expect(client.getQueryDefaults(['pages', 'w'])).toMatchObject({
    gcTime: SHELL_MAX_AGE_MS,
    networkMode: 'offlineFirst',
  });
});
