import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api/client';
import { queryKeys } from '../query-keys';
import { useBreadcrumb, useUpdatePage } from '../use-pages';
import type { BreadcrumbResponse } from '@/lib/types/pages';

jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/realtime/use-live-updates', () => ({ useWorkspaceLive: jest.fn() }));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), patch: jest.fn() },
}));
let client: QueryClient;
let renderer: ReactTestRenderer;
let update: ReturnType<typeof useUpdatePage>;
let breadcrumb: ReturnType<typeof useBreadcrumb>;
function Hooks() {
  update = useUpdatePage();
  breadcrumb = useBreadcrumb('child', 'workspace');
  return null;
}
const key = queryKeys.pages.breadcrumb('child', 'workspace');
const siblingKey = queryKeys.pages.breadcrumb('unrelated', 'workspace');
function trail(parent = 'parent', title = 'Parent'): BreadcrumbResponse {
  return {
    breadcrumb: [
      { id: parent, title, icon: null },
      { id: 'child', title: 'Child', icon: null },
    ],
  };
}
beforeEach(async () => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  client.setQueryData(key, trail());
  client.setQueryData(siblingKey, {
    breadcrumb: [{ id: 'unrelated', title: 'Unrelated', icon: null }],
  });
  client.setQueryData(queryKeys.pages.detail('child'), {
    page: { id: 'child', title: 'Child', workspaceId: 'workspace' },
  });
  jest.mocked(apiClient.get).mockResolvedValue({ data: trail() });
  jest.mocked(apiClient.patch).mockResolvedValue({
    data: { page: { id: 'parent', title: 'Renamed', workspaceId: 'workspace' } },
  });
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Hooks />
      </QueryClientProvider>,
    );
  });
});
afterEach(() => {
  act(() => renderer.unmount());
  client.clear();
});
it.each([{ title: 'Renamed' }, { icon: '📌' }])(
  'refreshes a descendant path after its ancestor changes %p without refetching unrelated paths or its editor',
  async (patch) => {
    jest.mocked(apiClient.get).mockResolvedValue({ data: trail('parent', 'Renamed') });
    await act(async () => {
      await update.mutateAsync({ id: 'parent', ...patch });
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(apiClient.get).toHaveBeenCalledWith('/pages/child/breadcrumb');
    expect(breadcrumb.data?.breadcrumb[0].title).toBe('Renamed');
    expect(client.getQueryState(siblingKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(queryKeys.pages.detail('child'))?.isInvalidated).toBe(false);
  },
);
it('does not refresh paths for a content-format change', async () => {
  await act(async () => {
    await update.mutateAsync({ id: 'parent', fullWidth: true });
  });
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
});
it('refetches the descendant ancestry after moving its parent', async () => {
  const moved = {
    breadcrumb: [{ id: 'new-root', title: 'New root', icon: null }, ...trail().breadcrumb],
  };
  jest.mocked(apiClient.get).mockResolvedValue({ data: moved });
  await act(async () => {
    await update.mutateAsync({ id: 'parent', parentId: 'new-root' });
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(client.getQueryData(key)).toEqual(moved);
});
