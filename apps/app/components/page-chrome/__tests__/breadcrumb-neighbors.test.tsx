import { isValidElement } from 'react';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from '@oxy.so/bloom/dropdown-menu';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import apiClient from '@/lib/api/client';
import type { NavigationNeighbors } from '@oxy.so/nilo-contracts';
import { breadcrumbNeighborsKey } from '@/lib/hooks/use-breadcrumb-neighbors';
import { BreadcrumbNeighbors } from '../breadcrumb-neighbors';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('@/lib/realtime/use-live-updates', () => ({ useWorkspaceLive: jest.fn() }));
jest.mock('../icon-display', () => ({ IconDisplay: () => null }));

const anchor = { kind: 'page' as const, id: 'current', workspaceId: 'workspace' };
const first: NavigationNeighbors = {
  items: [
    {
      kind: 'page',
      id: 'current',
      title: 'Current',
      icon: null,
      href: '/p/current',
      current: true,
    },
    {
      kind: 'page',
      id: 'page',
      title: 'Page sibling',
      icon: null,
      href: '/p/page',
      current: false,
    },
    { kind: 'database', id: 'db', title: 'Projects', icon: null, href: '/db/db', current: false },
  ],
  nextCursor: 'opaque-next',
};
const last: NavigationNeighbors = {
  items: [
    {
      kind: 'page',
      id: 'last',
      title: 'Last sibling',
      icon: null,
      href: '/p/last',
      current: false,
    },
  ],
  nextCursor: null,
};
let renderer: ReactTestRenderer;
let client: QueryClient;
const changed = jest.fn();
function tree(enabled = true) {
  return (
    <BloomTestProviders>
      <QueryClientProvider client={client}>
        <DropdownMenu defaultOpen onOpenChange={changed}>
          <DropdownMenuContent label="Related pages">
            <BreadcrumbNeighbors anchor={anchor} enabled={enabled} parentTitle="Parent" />
          </DropdownMenuContent>
        </DropdownMenu>
      </QueryClientProvider>
    </BloomTestProviders>
  );
}
async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}
async function mount(enabled = true) {
  await act(async () => {
    renderer = create(tree(enabled));
  });
  await settle();
}
const items = () => renderer.root.findAllByType(DropdownMenuItem);
const named = (title: string) => items().find((item) => item.props.children === title);
function press(item: ReactTestInstance | undefined) {
  if (!item) throw new Error('Missing menu item');
  // Invoke the actual row handler, including Bloom's menu close/keepOpen behavior.
  const row = item.findAll((node) => node.props.role === 'menuitem' && node.props.onPress)[0];
  if (!row) throw new Error('Missing menu row');
  row.props.onPress({ nativeEvent: {} });
}
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  jest.mocked(apiClient.get).mockResolvedValue({ data: first });
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
});

it('does not load destinations until the hover content is enabled', async () => {
  await mount(false);
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(items()).toHaveLength(0);
  await act(async () => renderer.update(tree()));
  await settle();
  expect(apiClient.get).toHaveBeenCalledWith('/pages/current/neighbors', {
    params: { limit: 6 },
    signal: expect.any(Object),
  });
  expect(named('Page sibling')).toBeDefined();
});

it('preserves real page/database hrefs and routes one activation, but not the current destination', async () => {
  await mount();
  expect(named('Current')?.props).toMatchObject({ href: '/p/current', current: true });
  expect(named('Page sibling')?.props.href).toBe('/p/page');
  expect(named('Projects')?.props.href).toBe('/db/db');
  act(() => press(named('Current')));
  expect(mockPush).not.toHaveBeenCalled();
  act(() => press(named('Page sibling')));
  expect(mockPush.mock.calls).toEqual([['/p/page']]);
  act(() => press(named('Projects')));
  expect(mockPush.mock.calls).toEqual([['/p/page'], ['/db/db']]);
  const pageIcon = named('Page sibling')?.props.leading;
  const dbIcon = named('Projects')?.props.leading;
  expect(
    isValidElement<{ pageId?: string; showPlaceholder?: boolean }>(pageIcon) && pageIcon.props,
  ).toMatchObject({ pageId: 'page', showPlaceholder: true });
  expect(isValidElement<{ pageId?: string }>(dbIcon) && dbIcon.props.pageId).toBeUndefined();
});

it('keeps More open while paging, disables duplicate requests, then appends the next results', async () => {
  await mount();
  changed.mockClear();
  let resolve!: (response: { data: NavigationNeighbors }) => void;
  jest.mocked(apiClient.get).mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const more = named('pages.navigation.more');
  expect(more?.props.keepOpen).toBe(true);
  act(() => press(more));
  await settle();
  expect(changed).not.toHaveBeenCalledWith(false);
  expect(named('common.loading')?.props.disabled).toBe(true);
  expect(named('Page sibling')).toBeDefined();
  expect(apiClient.get).toHaveBeenLastCalledWith('/pages/current/neighbors', {
    params: { limit: 6, cursor: 'opaque-next' },
    signal: expect.any(Object),
  });
  await act(async () => resolve({ data: last }));
  await settle();
  expect(named('Last sibling')).toBeDefined();
  expect(named('pages.navigation.more')).toBeUndefined();
  expect(changed).not.toHaveBeenCalledWith(false);
});

it('removes private cached labels on permission denial and retries without closing the menu', async () => {
  await mount();
  jest.mocked(apiClient.get).mockRejectedValue(
    new AxiosError('Forbidden', undefined, undefined, undefined, {
      status: 403,
    } as AxiosResponse),
  );
  await act(async () => client.invalidateQueries({ queryKey: breadcrumbNeighborsKey(anchor) }));
  await settle();
  expect(named('Page sibling')).toBeUndefined();
  expect(named('Projects')).toBeUndefined();
  const retry = named('pages.navigation.retry');
  expect(retry?.props.keepOpen).toBe(true);
  changed.mockClear();
  jest.mocked(apiClient.get).mockResolvedValue({ data: last });
  act(() => press(retry));
  await settle();
  expect(named('Last sibling')).toBeDefined();
  expect(named('Projects')).toBeUndefined();
  expect(changed).not.toHaveBeenCalledWith(false);
});
