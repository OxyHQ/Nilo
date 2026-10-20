import { Children, isValidElement, type ComponentType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Breadcrumb as BloomBreadcrumb,
  BreadcrumbItem,
  type BreadcrumbItemProps,
} from '@oxy.so/bloom/breadcrumb';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import apiClient from '@/lib/api/client';
import { queryKeys } from '@/lib/hooks/query-keys';
import { usePage, useUpdatePage } from '@/lib/hooks/use-pages';
import { invalidateLiveQueries, useWorkspaceLive } from '@/lib/realtime/use-live-updates';
import type { BreadcrumbEntry, BreadcrumbResponse } from '@/lib/types/pages';
import { Breadcrumb } from '../breadcrumb';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/realtime/socket', () => ({ acquireSocket: jest.fn(), releaseSocket: jest.fn() }));
jest.mock('@/lib/realtime/use-live-updates', () => ({
  ...jest.requireActual('@/lib/realtime/use-live-updates'),
  useWorkspaceLive: jest.fn(),
}));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), patch: jest.fn() },
}));
jest.mock('../icon-display', () => ({ IconDisplay: () => null }));
const Trail = (BloomBreadcrumb as unknown as { type: ComponentType }).type;
const Item = (BreadcrumbItem as unknown as { type: ComponentType }).type;
let client: QueryClient;
let renderer: ReactTestRenderer;
const page = { id: 'current', workspaceId: 'shared-workspace', title: 'Current page', icon: null };
function tree(currentPage = page) {
  return (
    <QueryClientProvider client={client}>
      <BloomTestProviders>
        <Breadcrumb currentPage={currentPage} />
      </BloomTestProviders>
    </QueryClientProvider>
  );
}
async function mount(ancestors: BreadcrumbEntry[] = []) {
  jest.mocked(apiClient.get).mockResolvedValue({ data: { breadcrumb: [...ancestors, page] } });
  await act(async () => {
    renderer = create(tree());
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
// Nilo supplies every authorized destination; Bloom owns which ones fit and
// exposes the rest through its tested responsive menu.
function suppliedCrumbs() {
  return Children.toArray(renderer.root.findByType(Trail).props.children).filter(
    isValidElement<BreadcrumbItemProps>,
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
});
it('shows only the authorized guest ancestry and real ancestor destinations without a workspace request', async () => {
  await mount([{ id: 'shared-parent', title: 'Shared parent', icon: null }]);
  const crumbs = suppliedCrumbs();
  expect(crumbs.map((crumb) => crumb.props.children)).toEqual(['Shared parent', 'Current page']);
  expect(crumbs[0].props.href).toBe('/p/shared-parent');
  act(() => crumbs[0].props.onPress?.());
  expect(mockPush).toHaveBeenCalledWith('/p/shared-parent');
  expect(crumbs[1].props.current).toBe(true);
  expect(crumbs[1].props.onPress).toBeUndefined();
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.get).toHaveBeenCalledWith('/pages/current/breadcrumb');
  expect(useWorkspaceLive).toHaveBeenCalledWith('shared-workspace');
});
it('delegates all authorized destinations to Bloom collapse without hiding ancestors in app code', async () => {
  const ancestors = Array.from({ length: 12 }, (_, index) => ({
    id: `ancestor-${index}`,
    title: `Ancestor ${index}`,
    icon: null,
  }));
  await mount(ancestors);
  expect(renderer.root.findByType(Trail).props.overflow).toBe('collapse');
  const crumbs = suppliedCrumbs();
  expect(crumbs).toHaveLength(13);
  expect(crumbs.slice(0, -1).map((crumb) => crumb.props.href)).toEqual(
    ancestors.map((entry) => `/p/${entry.id}`),
  );
  for (const crumb of crumbs.slice(0, -1)) act(() => crumb.props.onPress?.());
  expect(mockPush.mock.calls.map(([href]) => href)).toEqual(
    ancestors.map((entry) => `/p/${entry.id}`),
  );
  expect(crumbs[12].props.current).toBe(true);
  expect(crumbs[12].props.href).toBeUndefined();
});
it('keeps the current page visible while ancestry is loading and after a failed request', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(apiClient.get).mockReturnValue(
    new Promise<{ data: BreadcrumbResponse }>((_resolve, refuse) => {
      reject = refuse;
    }),
  );
  await act(async () => {
    renderer = create(tree());
  });
  expect(renderer.root.findAllByType(Item).map((item) => item.props.children)).toEqual([
    'Current page',
  ]);
  await act(async () => {
    reject(new Error('Offline'));
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(renderer.root.findAllByType(Item).map((item) => item.props.children)).toEqual([
    'Current page',
  ]);
});
it('renders optimistic current-page changes without waiting for the ancestry cache to refresh', async () => {
  await mount();
  await act(async () => renderer.update(tree({ ...page, title: 'Renamed immediately' })));
  expect(renderer.root.findByType(Item).props.children).toBe('Renamed immediately');
});
it('treats a root page as the current item, and labels whitespace titles as untitled', async () => {
  await mount();
  await act(async () => renderer.update(tree({ ...page, title: '  ' })));
  const crumbs = renderer.root.findAllByType(Item);
  expect(crumbs).toHaveLength(1);
  expect(crumbs[0].props.current).toBe(true);
  expect(crumbs[0].props.children).toBe('pages.untitled');
});

let update!: ReturnType<typeof useUpdatePage>;
function PageRoute() {
  const detail = usePage(page.id);
  update = useUpdatePage();
  return <Breadcrumb currentPage={detail.data?.page ?? page} />;
}
async function settleRender() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function mountRoute() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <BloomTestProviders>
          <PageRoute />
        </BloomTestProviders>
      </QueryClientProvider>,
    );
  });
  await settleRender();
}
async function workspaceChanged() {
  await act(async () => invalidateLiveQueries(client, 'workspace', page.workspaceId));
  await settleRender();
}
it('refreshes metadata from its page owner and protects a pending rename until rollback refetches', async () => {
  let serverPage = page;
  jest.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: url.endsWith('/breadcrumb') ? { breadcrumb: [serverPage] } : { page: serverPage },
  }));
  await mountRoute();
  serverPage = { ...page, title: 'Remote rename' };
  await workspaceChanged();
  expect(renderer.root.findByType(Item).props.children).toBe('Remote rename');
  let reject!: (error: Error) => void;
  jest.mocked(apiClient.patch).mockReturnValue(
    new Promise((_resolve, refuse) => {
      reject = refuse;
    }),
  );
  let mutation!: Promise<unknown>;
  await act(async () => {
    mutation = update.mutateAsync({ id: page.id, title: 'Typing locally' }).catch(() => undefined);
  });
  await settleRender();
  expect(renderer.root.findByType(Item).props.children).toBe('Typing locally');
  jest.mocked(apiClient.get).mockClear();
  await workspaceChanged();
  expect(apiClient.get).toHaveBeenCalledWith('/pages/current/breadcrumb');
  expect(apiClient.get).not.toHaveBeenCalledWith(
    '/pages/current',
    expect.objectContaining({ signal: expect.anything() }),
  );
  expect(renderer.root.findByType(Item).props.children).toBe('Typing locally');
  await act(async () => {
    reject(new Error('Save failed'));
    await mutation;
  });
  await settleRender();
  expect(renderer.root.findByType(Item).props.children).toBe('Remote rename');
  expect(apiClient.get).toHaveBeenCalledWith(
    '/pages/current',
    expect.objectContaining({ signal: expect.anything() }),
  );
});
it.each(['success', 'failure'] as const)(
  'keeps remote metadata while toggling a favorite and refreshes changes deferred until %s',
  async (result) => {
    let serverPage = { ...page, favorited: false, locked: false, cover: null as string | null };
    jest.mocked(apiClient.get).mockImplementation(async (url) => ({
      data: url.endsWith('/breadcrumb') ? { breadcrumb: [serverPage] } : { page: serverPage },
    }));
    client.setQueryData(['blocks', page.id], { blocks: [{ id: 'editing' }] });
    await mountRoute();
    serverPage = { ...serverPage, title: 'Remote title', locked: true, cover: 'cover-id' };
    await workspaceChanged();
    expect(renderer.root.findByType(Item).props.children).toBe('Remote title');
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    jest.mocked(apiClient.patch).mockReturnValue(
      new Promise((accept, refuse) => {
        resolve = accept;
        reject = refuse;
      }),
    );
    let mutation!: Promise<unknown>;
    await act(async () => {
      mutation = update.mutateAsync({ id: page.id, favorited: true }).catch(() => undefined);
    });
    await settleRender();
    expect(renderer.root.findByType(Item).props.children).toBe('Remote title');
    serverPage = { ...serverPage, title: 'Updated while saving', locked: false };
    jest.mocked(apiClient.get).mockClear();
    await workspaceChanged();
    expect(apiClient.get).not.toHaveBeenCalledWith(
      '/pages/current',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(renderer.root.findByType(Item).props.children).toBe('Remote title');
    if (result === 'success') serverPage = { ...serverPage, favorited: true };
    await act(async () => {
      if (result === 'success') resolve({ data: { page: serverPage } });
      else reject(new Error('Save failed'));
      await mutation;
    });
    await settleRender();
    expect(renderer.root.findByType(Item).props.children).toBe('Updated while saving');
    expect(client.getQueryData(queryKeys.pages.detail(page.id))).toEqual({ page: serverPage });
    expect(client.getQueryState(['blocks', page.id])?.isInvalidated).toBe(false);
  },
);
it('ignores a metadata response cancelled when a local rename starts', async () => {
  let serverPage = page;
  jest.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: url.endsWith('/breadcrumb') ? { breadcrumb: [serverPage] } : { page: serverPage },
  }));
  await mountRoute();
  let resolveRead!: (value: unknown) => void;
  jest.mocked(apiClient.get).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
  );
  let fetch!: Promise<void>;
  await act(async () => {
    fetch = client.refetchQueries({ queryKey: queryKeys.pages.detail(page.id), exact: true });
  });
  let resolvePatch!: (value: unknown) => void;
  jest.mocked(apiClient.patch).mockReturnValue(
    new Promise((resolve) => {
      resolvePatch = resolve;
    }),
  );
  let mutation!: Promise<unknown>;
  await act(async () => {
    mutation = update.mutateAsync({ id: page.id, title: 'Typing locally' });
  });
  await act(async () => {
    resolveRead({ data: { page: { ...page, title: 'Old in-flight response' } } });
    await fetch;
  });
  await settleRender();
  expect(renderer.root.findByType(Item).props.children).toBe('Typing locally');
  serverPage = { ...page, title: 'Typing locally' };
  await act(async () => {
    resolvePatch({ data: { page: serverPage } });
    await mutation;
  });
  await settleRender();
  expect(renderer.root.findByType(Item).props.children).toBe('Typing locally');
});
