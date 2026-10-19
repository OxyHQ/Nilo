import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/hooks/query-keys';
import { teamspaceKeys } from '@/lib/hooks/use-teamspaces';
import { shareLinkKeys, workspaceKeys, workspaceMemberKeys } from '@/lib/hooks/workspace-keys';
import {
  ACCOUNT_QUERIES,
  configureShellQueries,
  isShellQuery,
  MEMORY_ONLY_ROOTS,
  SHELL_MAX_AGE_MS,
  SHELL_ROOTS,
} from '../offline-cache';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/api/client', () => ({ __esModule: true, default: {} }));

const memoryOnly = new Set<string>(MEMORY_ONLY_ROOTS);

it("makes every query the account's: another account never finds one in memory", () => {
  expect(ACCOUNT_QUERIES.roots).toBe('all');
  expect(ACCOUNT_QUERIES.memoryOnlyRoots).toEqual(MEMORY_ONLY_ROOTS);
});

it('writes to the device only what the app needs to stand up offline', () => {
  for (const key of [
    workspaceKeys.list,
    workspaceKeys.detail('w'),
    queryKeys.pages.list('w'),
    queryKeys.pages.shared,
    queryKeys.pages.detail('p'),
    queryKeys.databases.list('w'),
    teamspaceKeys.list('w'),
  ]) {
    expect([key, isShellQuery(key), memoryOnly.has(String(key[0]))]).toEqual([key, true, false]);
  }
});

it('keeps every other root the app uses in memory only', () => {
  for (const key of [
    queryKeys.blocks.list('p'),
    queryKeys.comments.page('p', false),
    queryKeys.search.results('w', 'q'),
    queryKeys.databases.rows('d', null),
    queryKeys.databases.detail('d'),
    queryKeys.pages.permissions('p'),
    queryKeys.versions.list('p'),
    queryKeys.versions.detail('p', 'v'),
    queryKeys.reminders.list('u'),
    queryKeys.forms.link('f', 'v'),
    queryKeys.forms.public('t'),
    queryKeys.publicPages.detail('s'),
    workspaceMemberKeys.list('w'),
    shareLinkKeys.list('p'),
    shareLinkKeys.public('t'),
    teamspaceKeys.members('t'),
    ['ai', 'power-levels'],
    ['notifications'],
  ]) {
    expect([key, isShellQuery(key) || memoryOnly.has(String(key[0]))]).toEqual([key, true]);
    expect([key, isShellQuery(key)]).toEqual([key, false]);
  }
  expect(SHELL_ROOTS.filter((root) => memoryOnly.has(root))).toEqual([]);
});

it('lets kept queries live as long as they may be restored, and show offline', () => {
  const client = new QueryClient();
  configureShellQueries(client);
  expect(client.getQueryDefaults(['pages', 'w'])).toMatchObject({
    gcTime: SHELL_MAX_AGE_MS,
    networkMode: 'offlineFirst',
  });
});
