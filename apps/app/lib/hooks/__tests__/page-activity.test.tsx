import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PageActivityEvent, PageActivityPage } from '@oxy.so/nilo-contracts';
import { AxiosError, type AxiosResponse } from 'axios';
import apiClient from '@/lib/api/client';
import { queryKeys } from '../query-keys';
import { usePageActivity } from '../use-page-activity';
import { usePageVersion } from '../use-page-extras';

jest.mock('@/lib/api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('@/lib/config', () => ({
  __esModule: true,
  default: { apiUrl: 'https://api.example.test' },
}));
jest.mock('@/lib/realtime/use-live-updates', () => ({ useWorkspaceLive: jest.fn() }));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));

const page = { id: 'p', workspaceId: 'w' };
const pageKey = queryKeys.pages.detail(page.id);
const activityKey = queryKeys.pageActivity.page(page.workspaceId, page.id);
const event = (id: string): PageActivityEvent => ({
  id,
  pageId: page.id,
  actorIds: ['actor'],
  kind: 'metadata_changed',
  createdAt: '2026-10-21T00:00:00Z',
  changes: [{ field: 'title', before: 'Private previous title', after: id }],
});
const first: PageActivityPage = { items: [event('a'), event('b')], nextCursor: 'opaque-next' };
const second: PageActivityPage = { items: [event('b'), event('c')], nextCursor: null };
const snapshot = {
  version: { id: 'v', createdAt: '2026-10-20', createdBy: 'actor' },
  blocks: [{ id: 'private-block' }],
};
let client: QueryClient;
let renderer: ReactTestRenderer;
let state: ReturnType<typeof usePageActivity>;
let preview: ReturnType<typeof usePageVersion>;
let role: string;
function Probe() {
  state = usePageActivity(page);
  return null;
}
function VersionProbe() {
  preview = usePageVersion(page.id, 'v');
  return null;
}
async function settle() {
  for (let i = 0; i < 6; i++)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function mount(version = false) {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Probe />
        {version && <VersionProbe />}
      </QueryClientProvider>,
    );
  });
  await settle();
}
function failure(status: number) {
  return new AxiosError('Unavailable', undefined, undefined, undefined, {
    status,
  } as AxiosResponse);
}
const calls = () =>
  jest.mocked(apiClient.get).mock.calls.filter(([url]) => url === '/pages/p/activity');
beforeEach(() => {
  role = 'editor';
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: Infinity } },
  });
  jest.mocked(apiClient.get).mockImplementation(async (url, options) => ({
    data:
      url === '/pages/p'
        ? { page, role }
        : url.includes('/versions/')
          ? snapshot
          : options?.params?.cursor
            ? second
            : first,
  }));
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
  onlineManager.setOnline(true);
});

it('appends two server pages with the opaque cursor and deduplicates overlapping events', async () => {
  await mount();
  expect(state.items).toEqual(first.items);
  expect(state.hasNextPage).toBe(true);
  await act(async () => {
    await state.fetchNextPage();
  });
  await settle();
  expect(calls().map(([, options]) => options?.params)).toEqual([
    { limit: 20, cursor: undefined },
    { limit: 20, cursor: 'opaque-next' },
  ]);
  expect(state.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  expect(state.hasNextPage).toBe(false);
  await act(async () => {
    await state.fetchNextPage();
  });
  expect(calls()).toHaveLength(2);
});

it('keeps the existing feed when the next page fails with 500 and retries the same cursor', async () => {
  await mount();
  jest.mocked(apiClient.get).mockImplementation(async (url) => {
    if (url === '/pages/p') return { data: { page, role } };
    throw failure(500);
  });
  await act(async () => {
    await state.fetchNextPage();
  });
  await settle();
  expect(state.isFetchNextPageError).toBe(true);
  expect(state.items).toEqual(first.items);
  expect(state.hasNextPage).toBe(true);
  expect(calls()).toHaveLength(4); // Initial page, then bounded three attempts.
  jest.mocked(apiClient.get).mockResolvedValue({ data: second });
  await act(async () => {
    await state.fetchNextPage();
  });
  await settle();
  expect(state.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  expect(calls().at(-1)?.[1]?.params?.cursor).toBe('opaque-next');
});

it('retires cached activity and version data after a 403 without repeatedly rereading activity', async () => {
  await mount();
  const listKey = queryKeys.versions.list(page.id);
  const detailKey = queryKeys.versions.detail(page.id, 'v');
  const otherKey = queryKeys.pageActivity.page('other-workspace', 'other-page');
  client.setQueryData(listKey, { versions: [snapshot.version] });
  client.setQueryData(detailKey, snapshot);
  client.setQueryData(otherKey, { pages: [first], pageParams: [null] });
  jest.mocked(apiClient.get).mockImplementation(async (url) => {
    if (url === '/pages/p') return { data: { page, role } };
    throw failure(403);
  });
  await act(async () => {
    await state.fetchNextPage();
  });
  await settle();
  expect(state.items).toEqual([]);
  expect(state.isError).toBe(true);
  expect(client.getQueryData(activityKey)).toBeNull();
  expect(client.getQueryData(listKey)).toBeNull();
  expect(client.getQueryData(detailKey)).toBeNull();
  expect(client.getQueryData(otherKey)).not.toBeNull();
  const reads = calls().length;
  await act(async () => new Promise((resolve) => setTimeout(resolve, 40)));
  await settle();
  expect(calls()).toHaveLength(reads);
  expect(reads).toBe(2);
});

it('aborts a pending next page on permission downgrade and ignores a late transport response', async () => {
  await mount();
  let resolve!: (value: unknown) => void;
  let signal!: AbortSignal;
  jest.mocked(apiClient.get).mockImplementation((url, options) =>
    url === '/pages/p'
      ? Promise.resolve({ data: { page, role } })
      : new Promise((done) => {
          resolve = done;
          signal = options?.signal as AbortSignal;
        }),
  );
  let pending!: ReturnType<typeof state.fetchNextPage>;
  await act(async () => {
    pending = state.fetchNextPage();
  });
  await settle();
  role = 'commenter';
  await act(async () => client.invalidateQueries({ queryKey: pageKey, exact: true }));
  await settle();
  expect(signal.aborted).toBe(true);
  expect(state.items).toEqual([]);
  expect(state.canEdit).toBe(false);
  await act(async () => {
    resolve({ data: second });
    await pending;
  });
  await settle();
  expect(state.items).toEqual([]);
  expect(client.getQueryData(activityKey)).toBeNull();
});

it('guards a stale next-page callback while the non-invalidated permission query is paused', async () => {
  // Force the activity transport guard to run even while TanStack pauses the
  // permission request; otherwise its global offline queue would hide a bug.
  client.setQueryDefaults(activityKey, { networkMode: 'always' });
  await mount();
  const staleNext = state.fetchNextPage;
  await act(async () => {
    onlineManager.setOnline(false);
    await client.refetchQueries({ queryKey: pageKey, exact: true });
  });
  await settle();
  expect(client.getQueryState(pageKey)).toMatchObject({
    fetchStatus: 'paused',
    isInvalidated: false,
  });
  const reads = calls().length;
  await act(async () => {
    await staleNext();
  });
  await settle();
  expect(calls()).toHaveLength(reads);
  expect(state.items).toEqual([]);
});

it('keeps activity intact and avoids a permission loop when a selected snapshot no longer exists', async () => {
  await mount(true);
  expect(preview.data).toEqual(snapshot);
  const activityReads = calls().length;
  const metadataReads = jest
    .mocked(apiClient.get)
    .mock.calls.filter(([url]) => url === '/pages/p').length;
  jest.mocked(apiClient.get).mockImplementation(async (url) => {
    if (url.includes('/versions/')) throw failure(404);
    return { data: url === '/pages/p' ? { page, role } : first };
  });
  await act(async () => {
    await preview.refetch();
  });
  await settle();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 40)));
  expect(preview.isError).toBe(true);
  expect(preview.data).toBeUndefined();
  expect(state.items).toEqual(first.items);
  expect(calls()).toHaveLength(activityReads);
  expect(jest.mocked(apiClient.get).mock.calls.filter(([url]) => url === '/pages/p')).toHaveLength(
    metadataReads,
  );
});

it('cancels an activity response when a sibling history request is denied and does not resurrect it', async () => {
  await mount(true);
  let resolve!: (value: unknown) => void;
  let signal!: AbortSignal;
  jest.mocked(apiClient.get).mockImplementation((url, options) => {
    if (url === '/pages/p') return Promise.resolve({ data: { page, role } });
    if (url.includes('/versions/')) return Promise.reject(failure(403));
    return new Promise((done) => {
      resolve = done;
      signal = options?.signal as AbortSignal;
    });
  });
  let pending!: ReturnType<typeof state.fetchNextPage>;
  await act(async () => {
    pending = state.fetchNextPage();
  });
  await settle();
  role = 'viewer';
  await act(async () => {
    await preview.refetch();
  });
  await settle();
  expect(signal.aborted).toBe(true);
  expect(client.getQueryData(activityKey)).toBeNull();
  expect(state.items).toEqual([]);
  await act(async () => {
    resolve({ data: second });
    await pending;
  });
  await settle();
  expect(client.getQueryData(activityKey)).toBeNull();
  expect(state.items).toEqual([]);
  expect(preview.data).toBeUndefined();
});
