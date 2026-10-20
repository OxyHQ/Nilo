import type { ComponentType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BreadcrumbItem } from '@oxy.so/bloom/breadcrumb';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import apiClient from '@/lib/api/client';
import { queryKeys } from '@/lib/hooks/query-keys';
import { usePage, useUpdatePage } from '@/lib/hooks/use-pages';
import { useWorkspaceLive } from '@/lib/realtime/use-live-updates';
import type { BreadcrumbEntry, BreadcrumbResponse } from '@/lib/types/pages';
import { Breadcrumb } from '../breadcrumb';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/realtime/use-live-updates', () => ({ useWorkspaceLive: jest.fn() }));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), patch: jest.fn() },
}));
jest.mock('../icon-display', () => ({ IconDisplay: () => null }));
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
  const crumbs = renderer.root.findAllByType(Item);
  expect(crumbs.map((crumb) => crumb.props.children)).toEqual(['Shared parent', 'Current page']);
  expect(crumbs[0].props.href).toBe('/p/shared-parent');
  act(() => crumbs[0].props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/p/shared-parent');
  expect(crumbs[1].props.current).toBe(true);
  expect(crumbs[1].props.onPress).toBeUndefined();
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.get).toHaveBeenCalledWith('/pages/current/breadcrumb');
  expect(useWorkspaceLive).toHaveBeenCalledWith('shared-workspace');
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
  client.setQueryData(
    queryKeys.pages.detail(page.id),
    { page: { ...page, title: 'Renamed immediately' } },
    { updatedAt: Date.now() + 1 },
  );
  await act(async () => renderer.update(tree({ ...page, title: 'Renamed immediately' })));
  expect(renderer.root.findByType(Item).props.children).toBe('Renamed immediately');
});
it('treats a root page as the current item, and labels whitespace titles as untitled', async () => {
  await mount();
  client.setQueryData(
    queryKeys.pages.detail(page.id),
    { page: { ...page, title: '  ' } },
    { updatedAt: Date.now() + 1 },
  );
  await act(async () => renderer.update(tree({ ...page, title: '  ' })));
  const crumbs = renderer.root.findAllByType(Item);
  expect(crumbs).toHaveLength(1);
  expect(crumbs[0].props.current).toBe(true);
  expect(crumbs[0].props.children).toBe('pages.untitled');
});

it('accepts a newer remote current-page title, protects an in-flight optimistic rename, and restores on error', async () => {
  let update!: ReturnType<typeof useUpdatePage>;
  function PageRoute() {
    const detail = usePage(page.id);
    update = useUpdatePage();
    return <Breadcrumb currentPage={detail.data?.page ?? page} />;
  }
  client.setQueryData(queryKeys.pages.detail(page.id), { page }, { updatedAt: Date.now() - 1_000 });
  jest.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: url.endsWith('/breadcrumb')
      ? { breadcrumb: [{ ...page, title: 'Remote rename' }] }
      : { page },
  }));
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <BloomTestProviders>
          <PageRoute />
        </BloomTestProviders>
      </QueryClientProvider>,
    );
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  // A workspace event refetch can be newer than the still-mounted page detail.
  await act(async () => {
    client.setQueryData(
      queryKeys.pages.breadcrumb(page.id, page.workspaceId),
      { breadcrumb: [{ ...page, title: 'Remote rename' }] },
      { updatedAt: Date.now() + 1 },
    );
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
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
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(renderer.root.findByType(Item).props.children).toBe('Typing locally');
  // A workspace event can refetch stale server metadata before PATCH commits.
  await act(async () => {
    await client.refetchQueries({
      queryKey: queryKeys.pages.breadcrumb(page.id, page.workspaceId),
    });
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(renderer.root.findByType(Item).props.children).toBe('Typing locally');
  jest.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: url.endsWith('/breadcrumb') ? { breadcrumb: [page] } : { page },
  }));
  await act(async () => {
    reject(new Error('Save failed'));
    await mutation;
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(renderer.root.findByType(Item).props.children).toBe('Current page');
});
