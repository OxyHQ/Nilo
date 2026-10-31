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

it('allows the shell queries needed to stand up offline to be persisted', () => {
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

it('keeps the specified private roots in memory only', () => {
  for (const key of [
    queryKeys.blocks.list('p'),
    queryKeys.files.url('share:token', 'f'),
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

it('persists shell data without file URLs or share tokens', async () => {
  // Exercise the exact persister shipped by Services 13.0.0; it has no public
  // test entry point. Resolve the package first to respect workspace layouts.
  const persisterPath = require
    .resolve('@oxy.so/services/package.json')
    .replace(/package\.json$/, 'lib/commonjs/ui/hooks/accountQueryPersistence.js');
  const { createAccountQueryPersistence } = jest.requireActual(persisterPath) as {
    createAccountQueryPersistence: (
      client: QueryClient,
      config: typeof ACCOUNT_QUERIES,
    ) => {
      setStorage: (storage: {
        getItem: (key: string) => Promise<string | null>;
        setItem: (key: string, value: string) => Promise<void>;
        removeItem: (key: string) => Promise<void>;
      }) => void;
      attach: () => void;
      activate: (account: string | null) => void;
      subscribe: (listener: () => void) => () => void;
      isReady: () => boolean;
      detach: () => void;
    };
  };
  const client = new QueryClient();
  const persistence = createAccountQueryPersistence(client, ACCOUNT_QUERIES);
  const stored = new Map<string, string>();
  let resolveWrite: () => void = () => undefined;
  const written = new Promise<void>((resolve) => {
    resolveWrite = resolve;
  });
  persistence.setStorage({
    getItem: async (key) => stored.get(key) ?? null,
    setItem: async (key, value) => {
      stored.set(key, value);
      resolveWrite();
    },
    removeItem: async (key) => {
      stored.delete(key);
    },
  });
  persistence.attach();
  const ready = new Promise<void>((resolve) => {
    const unsubscribe = persistence.subscribe(() => {
      if (persistence.isReady()) {
        unsubscribe();
        resolve();
      }
    });
  });
  persistence.activate('account-a');
  await ready;
  client.setQueryData(queryKeys.files.url('share:synthetic-token', 'f'), {
    url: 'https://example.invalid/synthetic-signed-url',
    expiresAt: 123,
  });
  client.setQueryData(queryKeys.pages.detail('p'), { title: 'offline shell' });
  client.setQueryData(workspaceKeys.list, [{ name: 'offline workspace' }]);
  persistence.activate('account-b');
  await written;
  const snapshot = stored.get('oxy_account_queries:account-a');
  expect(snapshot).toContain('offline shell');
  expect(snapshot).toContain('offline workspace');
  expect(snapshot).not.toContain('synthetic-token');
  expect(snapshot).not.toContain('synthetic-signed-url');
  persistence.detach();
  client.clear();
});

it('lets kept queries live as long as they may be restored, and show offline', () => {
  const client = new QueryClient();
  configureShellQueries(client);
  expect(client.getQueryDefaults(['pages', 'w'])).toMatchObject({
    gcTime: SHELL_MAX_AGE_MS,
    networkMode: 'offlineFirst',
  });
});
