import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '@/lib/hooks/query-keys';
import { holdPageSession, type SessionHolder } from '../shared-sessions';
import { usePageEditor } from '../use-page-editor';

const mockListeners = new Map<string, Set<(event: { pageId: string }) => void>>();
const mockSocket = {
  on: jest.fn((name: string, handler: (event: { pageId: string }) => void) => {
    const listeners = mockListeners.get(name) ?? new Set();
    listeners.add(handler);
    mockListeners.set(name, listeners);
  }),
  off: jest.fn((name: string, handler: (event: { pageId: string }) => void) =>
    mockListeners.get(name)?.delete(handler),
  ),
};
jest.mock('@/lib/realtime/socket', () => ({
  acquireSocket: () => mockSocket,
  releaseSocket: jest.fn(),
}));
jest.mock('../shared-sessions', () => ({ holdPageSession: jest.fn(() => jest.fn()) }));
jest.mock('../offline-pages', () => ({ offlinePages: { opened: jest.fn(), forget: jest.fn() } }));
jest.mock('../presence-focus', () => ({ tellFocus: jest.fn(), withMove: jest.fn() }));

let client: QueryClient;
let renderer: ReactTestRenderer;
let holder: SessionHolder;
const pageKey = queryKeys.pages.detail('p');
const versionsKey = queryKeys.versions.list('p');
const blockKey = queryKeys.blocks.list('p');
function Probe() {
  usePageEditor('p', false);
  return null;
}
function emit(name: string, pageId = 'p') {
  act(() => {
    for (const listener of mockListeners.get(name) ?? []) listener({ pageId });
  });
}
const stale = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;
beforeEach(() => {
  jest.clearAllMocks();
  mockListeners.clear();
  client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity }, mutations: { gcTime: Infinity } },
  });
  for (const key of [pageKey, versionsKey, blockKey, queryKeys.pages.detail('other')]) {
    client.setQueryData(key, { unchanged: true });
  }
  act(() => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  holder = jest.mocked(holdPageSession).mock.calls[0]?.[1] as SessionHolder;
});
afterEach(() => {
  act(() => renderer.unmount());
  client.clear();
});

it('waits for projection after the local server acknowledgement, then refreshes metadata and versions only', () => {
  act(() => {
    holder.onStatus('saving');
    holder.onStatus('saved');
  });
  expect(stale(pageKey)).toBe(false);
  expect(stale(versionsKey)).toBe(false);
  emit('page:projected');
  expect(stale(pageKey)).toBe(true);
  expect(stale(versionsKey)).toBe(true);
  expect(stale(blockKey)).toBe(false);
  expect(stale(queryKeys.pages.detail('other'))).toBe(false);
});

it('waits for remote projection rather than each incoming document update', () => {
  emit('doc:update');
  emit('doc:update');
  emit('page:projected', 'other');
  expect(stale(pageKey)).toBe(false);
  emit('page:projected');
  expect(stale(pageKey)).toBe(true);
  expect(stale(versionsKey)).toBe(true);
});

it('leaves optimistic metadata alone until its mutation settles, while refreshing history', async () => {
  let finish!: () => void;
  const mutation = client.getMutationCache().build(client, {
    mutationKey: ['page-update'],
    mutationFn: (_input: { id: string }) =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  const running = mutation.execute({ id: 'p' });
  await act(async () => {
    await Promise.resolve();
  });
  emit('page:projected');
  expect(stale(pageKey)).toBe(false);
  expect(stale(versionsKey)).toBe(true);
  finish();
  await running;
});

it('removes projection listeners on unmount', () => {
  act(() => renderer.unmount());
  emit('page:projected');
  expect(stale(pageKey)).toBe(false);
  expect(mockListeners.get('page:projected')?.size).toBe(0);
});
