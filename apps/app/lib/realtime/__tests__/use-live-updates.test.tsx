import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWorkspaceLive, useDatabaseLive, useCommentsLive } from '../use-live-updates';
import { acquireSocket, releaseSocket } from '../socket';

jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('../socket', () => ({ acquireSocket: jest.fn(), releaseSocket: jest.fn() }));
let client: QueryClient;
let renderer: ReactTestRenderer;
let events: Map<string, Set<(payload?: unknown) => void>>;
const emit = jest.fn();
function fire(event: string, payload?: unknown) {
  for (const listener of events.get(event) ?? []) listener(payload);
}
function Hooks({ workspace = 'w', database = 'd', comments = 'p', duplicate = false }) {
  useWorkspaceLive(workspace);
  useDatabaseLive(database);
  useCommentsLive(comments);
  useWorkspaceLive(duplicate ? workspace : undefined);
  return null;
}
async function mount(props = {}) {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Hooks {...props} />
      </QueryClientProvider>,
    );
  });
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  events = new Map();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  jest.mocked(acquireSocket).mockReturnValue({
    connected: true,
    emit,
    on: (event: string, listener: (payload?: unknown) => void) => {
      if (!events.has(event)) events.set(event, new Set());
      events.get(event)?.add(listener);
    },
    off: (event: string, listener: (payload?: unknown) => void) =>
      events.get(event)?.delete(listener),
  } as unknown as ReturnType<typeof acquireSocket>);
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
  jest.useRealTimers();
});
it('joins once for shared holders, rejoins on every connect, leaves only after the last unmount', async () => {
  await mount({ duplicate: true });
  expect(emit.mock.calls.map(([event, id]) => [event, id])).toEqual([
    ['workspace:join', 'w'],
    ['database:join', 'd'],
  ]);
  act(() => fire('connect'));
  act(() => fire('connect'));
  expect(emit.mock.calls.filter(([event]) => event === 'workspace:join')).toHaveLength(3);
  await act(async () =>
    renderer.update(
      <QueryClientProvider client={client}>
        <Hooks duplicate={false} />
      </QueryClientProvider>,
    ),
  );
  expect(emit).not.toHaveBeenCalledWith('workspace:leave', 'w');
  act(() => renderer.unmount());
  expect(emit).toHaveBeenCalledWith('workspace:leave', 'w');
  expect(emit).toHaveBeenCalledWith('database:leave', 'd');
  expect(emit.mock.calls.some(([event]) => event.startsWith('page:'))).toBe(false);
  expect(releaseSocket).toHaveBeenCalledTimes(3);
  expect([...events.values()].every((listeners) => listeners.size === 0)).toBe(true);
});
it('debounces matching ids, refreshes all variants, and never invalidates editor page data', async () => {
  const keys = [
    ['pages', 'w'],
    ['pages', 'w', 'templates'],
    ['pages', 'w', 'archived'],
    ['databases', 'w'],
    ['database', 'd'],
    ['database', 'd', 'rows', null],
    ['database', 'd', 'rows', 'filtered'],
    ['database', 'd', 'row', 'r'],
    ['database', 'd', 'templates'],
    ['comments', 'page', 'p', true],
    ['comments', 'page', 'p', false],
    ['comments', 'block', 'b'],
    ['page', 'p', 'breadcrumb', 'w'],
    ['page', 'p'],
    ['blocks', 'p'],
    ['page', 'other', 'breadcrumb', 'other'],
    ['pages', 'other'],
    ['database', 'other'],
    ['comments', 'page', 'other', false],
  ];
  for (const key of keys)
    client.setQueryData(key, key[1] === 'block' ? { comments: [{ pageId: 'p' }] } : {});
  await mount();
  act(() => jest.runOnlyPendingTimers());
  for (const key of keys) client.setQueryData(key, client.getQueryData(key));
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  act(() => {
    fire('workspace:changed', { workspaceId: 'other' });
    fire('database:changed', { databaseId: 'other' });
    fire('page:comments', { pageId: 'other' });
    jest.advanceTimersByTime(200);
  });
  expect(invalidate).not.toHaveBeenCalled();
  act(() => {
    for (let n = 0; n < 3; n++) {
      fire('workspace:changed', { workspaceId: 'w' });
      fire('database:changed', { databaseId: 'd' });
      fire('page:comments', { pageId: 'p' });
    }
  });
  expect(invalidate).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(120));
  expect(invalidate).toHaveBeenCalledTimes(6);
  for (const key of keys.slice(0, 13)) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  for (const key of keys.slice(13)) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
});
it('cancels scheduled invalidations and switches room ids', async () => {
  await mount();
  act(() => jest.runOnlyPendingTimers());
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  act(() => fire('database:changed', { databaseId: 'd' }));
  await act(async () =>
    renderer.update(
      <QueryClientProvider client={client}>
        <Hooks database="next" />
      </QueryClientProvider>,
    ),
  );
  expect(emit).toHaveBeenCalledWith('database:leave', 'd');
  expect(emit).toHaveBeenCalledWith('database:join', 'next', expect.any(Function));
  act(() => jest.advanceTimersByTime(120));
  expect(invalidate).not.toHaveBeenCalled();
});
it('refreshes after a successful join acknowledgement to catch missed changes', async () => {
  await mount();
  act(() => jest.runOnlyPendingTimers());
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const ack = emit.mock.calls.find(([event]) => event === 'database:join')?.[2];
  act(() => {
    ack({ ok: true });
    jest.advanceTimersByTime(120);
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['database', 'd'] });
});

it('waits for connect when initially offline and ignores late acknowledgements after disposal', async () => {
  const socket = acquireSocket();
  socket.connected = false;
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await mount();
  expect(emit).not.toHaveBeenCalled();
  act(() => fire('connect'));
  expect(emit).toHaveBeenCalledWith('workspace:join', 'w', expect.any(Function));
  const ack = emit.mock.calls.find(([event]) => event === 'workspace:join')?.[2];
  act(() => renderer.unmount());
  act(() => {
    ack({ ok: true });
    jest.advanceTimersByTime(200);
  });
  expect(invalidate).not.toHaveBeenCalled();
});
it('drops everything cached when its workspace is reset, and only its own', async () => {
  const keys = [
    ['pages', 'w'],
    ['page', 'p'],
    ['blocks', 'p'],
    ['database', 'd', 'rows', null],
  ];
  for (const key of keys) client.setQueryData(key, {});
  await mount();
  act(() => jest.runOnlyPendingTimers());
  for (const key of keys) client.setQueryData(key, {});
  act(() => fire('workspace:reset', { workspaceId: 'other' }));
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  // Unlike a change, a reset leaves no page standing: the editor's data goes too.
  act(() => fire('workspace:reset', { workspaceId: 'w' }));
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
});
