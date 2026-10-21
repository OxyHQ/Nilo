import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import apiClient from '@/lib/api/client';
import type { Page } from '@/lib/types/pages';
import { queryKeys } from '../query-keys';
import { usePageVersion, usePageVersions, useRestoreVersion } from '../use-page-extras';

jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('@/lib/config', () => ({
  __esModule: true,
  default: { apiUrl: 'https://api.example.test' },
}));
jest.mock('@/lib/realtime/use-live-updates', () => ({ useWorkspaceLive: jest.fn() }));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));

const listKey = queryKeys.versions.list('p');
const detailKey = queryKeys.versions.detail('p', 'v');
const pageKey = queryKeys.pages.detail('p');
const page = { id: 'p', workspaceId: 'w' };
const history = {
  versions: [{ id: 'v', createdBy: 'private-author', createdAt: '2026-10-20', blockCount: 1 }],
};
const detail = { version: history.versions[0], blocks: [{ id: 'private-block' }] };
let client: QueryClient;
let renderer: ReactTestRenderer;
let list: ReturnType<typeof usePageVersions>;
let preview: ReturnType<typeof usePageVersion>;
let restore: ReturnType<typeof useRestoreVersion>;
let role: string;
function Probe() {
  list = usePageVersions('p');
  preview = usePageVersion('p', 'v');
  restore = useRestoreVersion(page as Page);
  return null;
}
async function settle() {
  for (let i = 0; i < 6; i++)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function mount() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  await settle();
}
const historyCalls = () =>
  jest.mocked(apiClient.get).mock.calls.filter(([url]) => String(url).includes('/versions'));
beforeEach(() => {
  role = 'editor';
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: Infinity },
      // Exercise the owner's transport guard independently of TanStack's
      // default offline mutation queue; no real transport is used in this test.
      mutations: { networkMode: 'always', gcTime: Infinity },
    },
  });
  jest.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: url === '/pages/p' ? { page, role } : url === '/pages/p/versions' ? history : detail,
  }));
});

it('rejects stale history and restore callbacks while a non-invalidated permission read is paused', async () => {
  await mount();
  const staleRestore = restore.mutateAsync;
  const staleRead = client.getQueryCache().find({ queryKey: listKey, exact: true })
    ?.options.queryFn;
  if (typeof staleRead !== 'function') throw new Error('Missing history query');
  const reads = historyCalls().length;
  await act(async () => {
    onlineManager.setOnline(false);
    await client.refetchQueries({ queryKey: pageKey, exact: true });
  });
  expect(client.getQueryState(pageKey)).toMatchObject({
    fetchStatus: 'paused',
    isInvalidated: false,
  });
  await act(async () => {
    await expect(
      staleRead({
        client,
        queryKey: listKey,
        signal: new AbortController().signal,
        meta: undefined,
      }),
    ).rejects.toThrow('Page history requires editor access');
    await expect(staleRestore('v')).rejects.toThrow('Page history requires editor access');
  });
  expect(historyCalls()).toHaveLength(reads);
  expect(apiClient.post).not.toHaveBeenCalled();
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
  onlineManager.setOnline(true);
});

it('hides editor-era history while the permission recheck is paused offline', async () => {
  client.setQueryData(pageKey, { page, role: 'editor' });
  client.setQueryData(listKey, history);
  client.setQueryData(detailKey, detail);
  onlineManager.setOnline(false);
  await mount();
  expect(client.getQueryState(pageKey)?.fetchStatus).toBe('paused');
  expect(list.data).toBeUndefined();
  expect(preview.data).toBeUndefined();
  expect(historyCalls()).toHaveLength(0);
});

it('waits for a permission recheck before exposing editor-era cached history', async () => {
  client.setQueryData(pageKey, { page, role: 'editor' });
  client.setQueryData(listKey, history);
  client.setQueryData(detailKey, detail);
  let resolve!: (value: unknown) => void;
  jest.mocked(apiClient.get).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await mount();
  expect(list.data).toBeUndefined();
  expect(preview.data).toBeUndefined();
  expect(historyCalls()).toHaveLength(0);
  await act(async () => resolve({ data: { page, role: 'viewer' } }));
  await settle();
  expect(list.canEdit).toBe(false);
  expect(client.getQueryData(listKey)).toBeNull();
  expect(client.getQueryData(detailKey)).toBeNull();
  await act(async () => {
    await list.refetch();
    await preview.refetch();
  });
  expect(historyCalls()).toHaveLength(0);
});

it('cancels in-flight list and preview reads on downgrade and ignores their late transport responses', async () => {
  const pending: { signal: AbortSignal; resolve: (data: unknown) => void }[] = [];
  jest
    .mocked(apiClient.get)
    .mockImplementation((url, options) =>
      url === '/pages/p'
        ? Promise.resolve({ data: { page, role } })
        : new Promise((resolve) =>
            pending.push({ signal: options?.signal as AbortSignal, resolve }),
          ),
    );
  await mount();
  expect(pending).toHaveLength(2);
  role = 'commenter';
  await act(async () => client.invalidateQueries({ queryKey: pageKey, exact: true }));
  await settle();
  expect(pending.every((request) => request.signal.aborted)).toBe(true);
  await act(async () => {
    for (const request of pending) request.resolve({ data: detail });
  });
  await settle();
  expect(list.data).toBeUndefined();
  expect(preview.data).toBeUndefined();
  expect(client.getQueryData(listKey)).toBeNull();
  expect(client.getQueryData(detailKey)).toBeNull();
});

it('retires both caches after a terminal version denial, including a later failed access recheck', async () => {
  await mount();
  expect(list.data).toEqual(history);
  expect(preview.data).toEqual(detail);
  const denied = new AxiosError('denied');
  denied.response = { status: 403 } as AxiosError['response'];
  jest.mocked(apiClient.get).mockImplementation(async (url) => {
    if (url === '/pages/p') throw new Error('offline');
    throw denied;
  });
  await act(async () => {
    await preview.refetch();
  });
  await settle();
  expect(list.data).toBeUndefined();
  expect(preview.data).toBeUndefined();
  expect(client.getQueryData(listKey)).toBeNull();
  expect(client.getQueryData(detailKey)).toBeNull();
});

it('keeps other pages history intact when one page loses permission', async () => {
  client.setQueryData(queryKeys.versions.list('other'), history);
  client.setQueryData(queryKeys.versions.detail('other', 'v'), detail);
  role = 'viewer';
  await mount();
  expect(client.getQueryData(queryKeys.versions.list('other'))).toEqual(history);
  expect(client.getQueryData(queryKeys.versions.detail('other', 'v'))).toEqual(detail);
  expect(historyCalls()).toHaveLength(0);
});

it('keeps a deleted version error stable without discarding other versions or rechecking page access', async () => {
  await mount();
  const pageReads = jest
    .mocked(apiClient.get)
    .mock.calls.filter(([url]) => url === '/pages/p').length;
  const missing = new AxiosError('Version not found');
  missing.response = { status: 404 } as AxiosError['response'];
  let missingReads = 0;
  jest.mocked(apiClient.get).mockImplementation(async (url) => {
    if (url === '/pages/p') {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { data: { page, role: 'editor' } };
    }
    if (url === '/pages/p/versions') return { data: history };
    missingReads++;
    throw missing;
  });
  await act(async () => {
    await preview.refetch();
  });
  await settle();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(missingReads).toBe(1);
  expect(jest.mocked(apiClient.get).mock.calls.filter(([url]) => url === '/pages/p')).toHaveLength(
    pageReads,
  );
  expect(list.data).toEqual(history);
  expect(preview.data).toBeUndefined();
  expect(preview.isError).toBe(true);
  expect(client.getQueryData(detailKey)).toBeNull();
  // Explicit retry still works, but does not silently retry on its own.
  await act(async () => {
    await preview.refetch();
  });
  await settle();
  expect(missingReads).toBe(2);
});

it('does not cycle persistent history denials when page metadata still reports editor', async () => {
  await mount();
  const denied = new AxiosError('History denied');
  denied.response = { status: 403 } as AxiosError['response'];
  let deniedReads = 0;
  jest.mocked(apiClient.get).mockImplementation(async (url) => {
    if (url === '/pages/p') {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { data: { page, role: 'editor' } };
    }
    deniedReads++;
    throw denied;
  });
  await act(async () => {
    await preview.refetch();
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  await settle();
  const settledReads = deniedReads;
  expect(settledReads).toBeGreaterThan(0);
  expect(settledReads).toBeLessThanOrEqual(2);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  await settle();
  expect(deniedReads).toBe(settledReads);
  expect(client.getQueryData(listKey)).toBeNull();
  expect(client.getQueryData(detailKey)).toBeNull();
  expect(list.data).toBeUndefined();
  expect(preview.data).toBeUndefined();
  await act(async () => {
    await preview.refetch();
  });
  await settle();
  expect(deniedReads).toBe(settledReads + 1);
});

it('retires denied restore history and cancels a pending preview before its late response', async () => {
  await mount();
  const activityKey = queryKeys.pageActivity.page('w', 'p');
  client.setQueryData(activityKey, {
    pages: [{ items: [{ id: 'private-event' }] }],
    pageParams: [null],
  });
  let resolve!: (value: unknown) => void;
  let signal!: AbortSignal;
  jest.mocked(apiClient.get).mockImplementation((url, options) => {
    if (url === '/pages/p') return Promise.resolve({ data: { page, role } });
    return new Promise((done) => {
      resolve = done;
      signal = options?.signal as AbortSignal;
    });
  });
  let pending!: ReturnType<typeof preview.refetch>;
  await act(async () => {
    pending = preview.refetch();
  });
  await settle();
  const denied = new AxiosError('denied');
  denied.response = { status: 403 } as AxiosError['response'];
  jest.mocked(apiClient.post).mockImplementation(async () => {
    role = 'viewer';
    throw denied;
  });
  await act(async () => {
    await expect(restore.mutateAsync('v')).rejects.toBe(denied);
  });
  await settle();
  expect(signal.aborted).toBe(true);
  expect(list.canEdit).toBe(false);
  expect(client.getQueryData(listKey)).toBeNull();
  expect(client.getQueryData(detailKey)).toBeNull();
  expect(client.getQueryData(activityKey)).toBeNull();
  await act(async () => {
    resolve({ data: detail });
    await pending;
  });
  expect(preview.data).toBeUndefined();
  expect(client.getQueryData(detailKey)).toBeNull();
});

it('retires only the missing snapshot when restore returns 404', async () => {
  await mount();
  const activityKey = queryKeys.pageActivity.page('w', 'p');
  const activity = { pages: [{ items: [{ id: 'event' }] }], pageParams: [null] };
  client.setQueryData(activityKey, activity);
  const reads = jest.mocked(apiClient.get).mock.calls.length;
  const missing = new AxiosError('missing');
  missing.response = { status: 404 } as AxiosError['response'];
  jest.mocked(apiClient.post).mockRejectedValue(missing);
  await act(async () => {
    await expect(restore.mutateAsync('v')).rejects.toBe(missing);
  });
  await settle();
  expect(client.getQueryData(detailKey)).toBeNull();
  expect(list.data).toEqual(history);
  expect(list.canEdit).toBe(true);
  expect(client.getQueryData(activityKey)).toEqual(activity);
  expect(apiClient.get).toHaveBeenCalledTimes(reads);
});

it('preserves preview after a recoverable restore failure and allows an explicit retry', async () => {
  await mount();
  const failure = new AxiosError('server unavailable');
  failure.response = { status: 500 } as AxiosError['response'];
  jest
    .mocked(apiClient.post)
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce({ data: { ok: true } });
  await act(async () => {
    await expect(restore.mutateAsync('v')).rejects.toBe(failure);
  });
  expect(preview.data).toEqual(detail);
  expect(list.data).toEqual(history);
  await act(async () => {
    await expect(restore.mutateAsync('v')).resolves.toEqual({ ok: true });
  });
  expect(apiClient.post).toHaveBeenCalledTimes(2);
});
