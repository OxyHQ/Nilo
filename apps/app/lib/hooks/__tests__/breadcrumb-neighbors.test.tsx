import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import apiClient from '@/lib/api/client';
import { invalidateLiveQueries } from '@/lib/realtime/use-live-updates';
import { MEMORY_ONLY_ROOTS, isShellQuery } from '@/lib/offline-cache';
import {
  breadcrumbNeighborsKey,
  useBreadcrumbNeighbors,
  type BreadcrumbNeighborAnchor,
  type BreadcrumbNeighborsResponse,
} from '../use-breadcrumb-neighbors';

let mockAuthenticated = true;
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: mockAuthenticated }),
}));
jest.mock('@/lib/api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('@/lib/realtime/socket', () => ({ acquireSocket: jest.fn(), releaseSocket: jest.fn() }));
jest.mock('@/lib/realtime/use-live-updates', () => ({
  ...jest.requireActual('@/lib/realtime/use-live-updates'),
  useWorkspaceLive: jest.fn(),
}));

const anchor: BreadcrumbNeighborAnchor = { kind: 'page', id: 'page', workspaceId: 'workspace' };
const first: BreadcrumbNeighborsResponse = {
  items: [
    { kind: 'page', id: 'page', title: 'Current', icon: null, href: '/p/page', current: true },
  ],
  nextCursor: 'opaque-next',
};
const last: BreadcrumbNeighborsResponse = {
  items: [
    {
      kind: 'page',
      id: 'sibling',
      title: 'Sibling',
      icon: '📄',
      href: '/p/sibling',
      current: false,
    },
  ],
  nextCursor: null,
};
let client: QueryClient;
let renderer: ReactTestRenderer;
let state: ReturnType<typeof useBreadcrumbNeighbors>;
function Reader({ enabled, entry }: { enabled: boolean; entry: BreadcrumbNeighborAnchor }) {
  state = useBreadcrumbNeighbors(entry, { enabled });
  return null;
}
const tree = (enabled: boolean, entry = anchor) => (
  <QueryClientProvider client={client}>
    <Reader enabled={enabled} entry={entry} />
  </QueryClientProvider>
);
async function settle() {
  for (let i = 0; i < 3; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}
async function mount(enabled = true, entry = anchor) {
  await act(async () => {
    renderer = create(tree(enabled, entry));
  });
  await settle();
}
function denied(status: number) {
  return new AxiosError('Unavailable', undefined, undefined, undefined, {
    status,
  } as AxiosResponse);
}
beforeEach(() => {
  mockAuthenticated = true;
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  jest.mocked(apiClient.get).mockResolvedValue({ data: first });
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
  onlineManager.setOnline(true);
});

it('does not load or expose data until opened and mockAuthenticated, including explicit actions', async () => {
  client.setQueryData(breadcrumbNeighborsKey(anchor), { pages: [first], pageParams: [null] });
  await mount(false);
  await state.loadMore();
  await state.refetch();
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(state.items).toEqual([]);
  expect(state.isLoading).toBe(false);
  mockAuthenticated = false;
  await act(async () => renderer.update(tree(true)));
  await settle();
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(state.items).toEqual([]);
});

it('loads six authorized results lazily and appends the opaque next page', async () => {
  await mount(false);
  await act(async () => renderer.update(tree(true)));
  await settle();
  expect(apiClient.get).toHaveBeenCalledWith('/pages/page/neighbors', {
    params: { limit: 6 },
    signal: expect.any(Object),
  });
  expect(state.items).toEqual(first.items);
  expect(state.hasMore).toBe(true);
  jest.mocked(apiClient.get).mockResolvedValueOnce({ data: last });
  await act(async () => state.loadMore());
  await settle();
  expect(apiClient.get).toHaveBeenLastCalledWith('/pages/page/neighbors', {
    params: { limit: 6, cursor: 'opaque-next' },
    signal: expect.any(Object),
  });
  expect(state.items).toEqual([...first.items, ...last.items]);
  expect(state.hasMore).toBe(false);
  await state.loadMore();
  expect(apiClient.get).toHaveBeenCalledTimes(2);
});

it('uses the database endpoint without requesting pages or workspace lists', async () => {
  const db = { ...anchor, kind: 'database' as const, id: 'db' };
  await mount(true, db);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.get).toHaveBeenCalledWith('/databases/db/neighbors', expect.any(Object));
});

it('hides old data during each opening permission check and shows loading', async () => {
  await mount();
  await act(async () => renderer.update(tree(false)));
  let resolve!: (value: { data: BreadcrumbNeighborsResponse }) => void;
  jest.mocked(apiClient.get).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await act(async () => renderer.update(tree(true)));
  expect(state.isLoading).toBe(true);
  expect(state.items).toEqual([]);
  await act(async () => resolve({ data: last }));
  await settle();
  expect(state.items).toEqual(last.items);
});

it.each([401, 403, 404])(
  'retires cached neighbors after %s, including subsequent offline retries',
  async (status) => {
    await mount();
    jest.mocked(apiClient.get).mockRejectedValue(denied(status));
    await act(async () => state.refetch());
    await settle();
    expect(state.isError).toBe(true);
    expect(state.items).toEqual([]);
    expect(client.getQueryData(breadcrumbNeighborsKey(anchor))).toEqual({
      pages: [],
      pageParams: [],
    });
    expect(apiClient.get).toHaveBeenCalledTimes(2);
    jest.mocked(apiClient.get).mockRejectedValue(new Error('Offline'));
    await act(async () => state.refetch());
    await settle();
    expect(state.items).toEqual([]);
    expect(state.hasMore).toBe(false);
    jest.mocked(apiClient.get).mockResolvedValue({ data: last });
    await act(async () => state.refetch());
    await settle();
    expect(state.items).toEqual(last.items);
  },
);

it('retires earlier pages when a next-page request loses access', async () => {
  await mount();
  jest.mocked(apiClient.get).mockRejectedValue(denied(403));
  await act(async () => state.loadMore());
  await settle();
  expect(state.items).toEqual([]);
  expect(state.hasMore).toBe(false);
  expect(client.getQueryData(breadcrumbNeighborsKey(anchor))).toEqual({
    pages: [],
    pageParams: [],
  });
});

it('refreshes on workspace and database events without reading unrelated workspace caches', async () => {
  await mount();
  const other = breadcrumbNeighborsKey({ ...anchor, workspaceId: 'other' });
  client.setQueryData(other, { pages: [first], pageParams: [null] });
  jest.mocked(apiClient.get).mockResolvedValue({ data: last });
  await act(async () => invalidateLiveQueries(client, 'workspace', 'workspace'));
  await settle();
  expect(state.items).toEqual(last.items);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  const count = jest.mocked(apiClient.get).mock.calls.length;
  await act(async () => invalidateLiveQueries(client, 'database', 'db'));
  await settle();
  expect(apiClient.get).toHaveBeenCalledTimes(count + 1);
});

it('keeps neighbor results out of the persisted offline shell', () => {
  expect(MEMORY_ONLY_ROOTS).toContain('breadcrumb-neighbors');
  expect(isShellQuery(breadcrumbNeighborsKey(anchor))).toBe(false);
});

it('does not erase newer cache data when an aborted request later rejects with a denial', async () => {
  await mount();
  let reject!: (error: Error) => void;
  jest.mocked(apiClient.get).mockReturnValueOnce(
    new Promise((_accept, refuse) => {
      reject = refuse;
    }),
  );
  await act(async () => {
    void state.refetch();
  });
  const key = breadcrumbNeighborsKey(anchor);
  await act(async () => {
    await client.cancelQueries({ queryKey: key });
  });
  client.setQueryData(key, { pages: [last], pageParams: [null] });
  await act(async () => reject(denied(403)));
  await settle();
  expect(client.getQueryData(key)).toEqual({ pages: [last], pageParams: [null] });
});

it('keeps separate caches for anchors and workspaces when hover moves', async () => {
  await mount();
  const next = { ...anchor, id: 'second', workspaceId: 'second-workspace' };
  let resolve!: (value: { data: BreadcrumbNeighborsResponse }) => void;
  jest.mocked(apiClient.get).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await act(async () => renderer.update(tree(true, next)));
  expect(state.items).toEqual([]);
  expect(state.isLoading).toBe(true);
  await act(async () => resolve({ data: last }));
  await settle();
  expect(state.items).toEqual(last.items);
  expect(client.getQueryData(breadcrumbNeighborsKey(anchor))).toEqual({
    pages: [first],
    pageParams: [null],
  });
});

it('does not expose previously cached names while an opening check is paused offline', async () => {
  await mount();
  await act(async () => renderer.update(tree(false)));
  onlineManager.setOnline(false);
  await act(async () => renderer.update(tree(true)));
  await settle();
  expect(state.items).toEqual([]);
  expect(state.isLoading).toBe(true);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
});
