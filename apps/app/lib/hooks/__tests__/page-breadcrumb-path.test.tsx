import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import apiClient from '@/lib/api/client';
import type { Database } from '@/lib/types/databases';
import type { BreadcrumbEntry } from '@/lib/types/pages';
import { invalidateLiveQueries, useDatabaseLive } from '@/lib/realtime/use-live-updates';
import { queryKeys } from '../query-keys';
import { useUpdateDatabase } from '../use-databases';
import { usePageBreadcrumbPath, type PageBreadcrumbPathEntry } from '../use-page-breadcrumb-path';

jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), patch: jest.fn() },
}));
jest.mock('@/lib/realtime/socket', () => ({ acquireSocket: jest.fn(), releaseSocket: jest.fn() }));
jest.mock('@/lib/realtime/use-live-updates', () => ({
  ...jest.requireActual('@/lib/realtime/use-live-updates'),
  useWorkspaceLive: jest.fn(),
  useDatabaseLive: jest.fn(),
}));

const row = { id: 'row', title: 'A task', icon: null, workspaceId: 'workspace', databaseId: 'db' };
let database: Database;
let ancestors: BreadcrumbEntry[];
let databaseError: number | null;
let parentError: number | null;
let client: QueryClient;
let renderer: ReactTestRenderer;
let path: PageBreadcrumbPathEntry[];
let update: ReturnType<typeof useUpdateDatabase>;
function Reader({ page = row }: { page?: Parameters<typeof usePageBreadcrumbPath>[0] }) {
  path = usePageBreadcrumbPath(page);
  update = useUpdateDatabase();
  return null;
}
function tree(page?: Parameters<typeof usePageBreadcrumbPath>[0]) {
  return (
    <QueryClientProvider client={client}>
      <Reader page={page} />
    </QueryClientProvider>
  );
}
function refused(status: number) {
  return new AxiosError('Unavailable', undefined, undefined, undefined, {
    status,
  } as AxiosResponse);
}
async function settle() {
  for (let i = 0; i < 3; i++)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function mount(page?: Parameters<typeof usePageBreadcrumbPath>[0]) {
  await act(async () => {
    renderer = create(tree(page));
  });
  await settle();
}
beforeEach(() => {
  jest.clearAllMocks();
  database = {
    id: 'db',
    name: 'Private projects',
    icon: '📌',
    parentPageId: 'parent',
    workspaceId: 'workspace',
  } as Database;
  ancestors = [
    { id: 'grandparent', title: 'Shared area', icon: null },
    { id: 'parent', title: 'Parent', icon: null },
  ];
  databaseError = null;
  parentError = null;
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, staleTime: Infinity, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  jest.mocked(apiClient.get).mockImplementation(async (url) => {
    if (url === '/databases/db') {
      if (databaseError) throw refused(databaseError);
      return { data: { database, views: [], role: 'viewer' } };
    }
    if (parentError) throw refused(parentError);
    return { data: { breadcrumb: ancestors } };
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
});

it('uses the ordinary page path and current metadata without requesting a database', async () => {
  ancestors.push({ id: row.id, title: 'Stale title', icon: 'old' });
  const { databaseId: _databaseId, ...ordinary } = row;
  await mount(ordinary);
  expect(path.map((entry) => entry.title)).toEqual(['Shared area', 'Parent', 'A task']);
  expect(path.at(-1)).toMatchObject({ current: true, kind: 'page', icon: null });
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.get).toHaveBeenCalledWith('/pages/row/breadcrumb');
});

it('combines authorized ancestors, database and row with real destinations', async () => {
  await mount();
  expect(path.map(({ kind, href }) => ({ kind, href }))).toEqual([
    { kind: 'page', href: '/p/grandparent' },
    { kind: 'page', href: '/p/parent' },
    { kind: 'database', href: '/db/db' },
    { kind: 'page', href: undefined },
  ]);
  expect(path.map((entry) => entry.title)).toEqual([
    'Shared area',
    'Parent',
    'Private projects',
    'A task',
  ]);
  expect(useDatabaseLive).toHaveBeenCalledWith('db');
  expect(apiClient.get).toHaveBeenCalledWith('/pages/parent/breadcrumb');
});

it.each([403, 404])('shows only the row when database access returns %s', async (status) => {
  databaseError = status;
  await mount();
  expect(path).toEqual([
    { kind: 'page', id: row.id, title: row.title, icon: row.icon, current: true },
  ]);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.get).toHaveBeenCalledWith('/databases/db');
});

it('hides cached private database ancestry after access is revoked', async () => {
  await mount();
  databaseError = 403;
  await act(async () => invalidateLiveQueries(client, 'database', 'db'));
  await settle();
  expect(path.map((entry) => entry.id)).toEqual(['row']);
  // The database hook still caches its old response; it must not authorize the path.
  expect(client.getQueryData(queryKeys.databases.detail('db'))).toBeDefined();
});

it('updates database metadata and page hierarchy through their existing live query owners', async () => {
  await mount();
  database = { ...database, name: 'Renamed database', icon: '✅' };
  await act(async () => invalidateLiveQueries(client, 'database', 'db'));
  await settle();
  expect(path.find((entry) => entry.kind === 'database')).toMatchObject({
    title: 'Renamed database',
    icon: '✅',
  });
  ancestors = [{ id: 'parent', title: 'Moved parent', icon: null }];
  await act(async () => invalidateLiveQueries(client, 'workspace', 'workspace'));
  await settle();
  expect(path.map((entry) => entry.title)).toEqual(['Moved parent', 'Renamed database', 'A task']);
});

it('drops a deleted parent and accepts a subsequently confirmed detached database', async () => {
  await mount();
  parentError = 404;
  database = { ...database, parentPageId: null };
  await act(async () => invalidateLiveQueries(client, 'workspace', 'workspace'));
  await settle();
  expect(path.map((entry) => entry.id)).toEqual(['db', 'row']);
});

it('hides stale parent names when the parent check fails before database metadata catches up', async () => {
  await mount();
  parentError = 404;
  await act(async () =>
    client.invalidateQueries({ queryKey: queryKeys.pages.breadcrumb('parent', 'workspace') }),
  );
  await settle();
  expect(path.map((entry) => entry.id)).toEqual(['row']);
});

it.each(['success', 'failure'])(
  'defers workspace refresh during optimistic database edits and revalidates on %s',
  async (outcome) => {
    await mount();
    let resolve!: (response: { data: { database: Database } }) => void;
    let reject!: (error: Error) => void;
    jest.mocked(apiClient.patch).mockReturnValue(
      new Promise((accept, refuse) => {
        resolve = accept;
        reject = refuse;
      }),
    );
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = update.mutateAsync({ id: 'db', name: 'Optimistic' }).catch((error) => error);
    });
    await settle();
    expect(path.find((entry) => entry.kind === 'database')?.title).toBe('Optimistic');
    jest.mocked(apiClient.get).mockClear();
    await act(async () => invalidateLiveQueries(client, 'workspace', 'workspace'));
    await settle();
    expect(apiClient.get).not.toHaveBeenCalledWith('/databases/db');
    expect(path.find((entry) => entry.kind === 'database')?.title).toBe('Optimistic');
    database = { ...database, name: outcome === 'success' ? 'Saved' : 'Server after rollback' };
    await act(async () => {
      if (outcome === 'success') resolve({ data: { database } });
      else reject(new Error('Write failed'));
      await pending;
    });
    await settle();
    expect(apiClient.get).toHaveBeenCalledWith('/databases/db');
    expect(path.find((entry) => entry.kind === 'database')?.title).toBe(database.name);
  },
);

it('invalidates exact database metadata in one workspace without row queries or other workspaces', async () => {
  await mount();
  const rows = queryKeys.databases.rows('db', null);
  const other = queryKeys.databases.detail('other-db');
  client.setQueryData(rows, { rows: [] });
  client.setQueryData(other, { database: { workspaceId: 'other' } });
  await act(async () => invalidateLiveQueries(client, 'workspace', 'workspace'));
  await settle();
  expect(client.getQueryState(rows)?.isInvalidated).toBe(false);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
});

it('hides an ordinary cached ancestry after a failed permission recheck', async () => {
  await mount({ ...row, databaseId: null });
  parentError = 403;
  await act(async () => invalidateLiveQueries(client, 'workspace', 'workspace'));
  await settle();
  expect(path.map((entry) => entry.id)).toEqual(['row']);
});
