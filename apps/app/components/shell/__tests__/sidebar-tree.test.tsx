jest.mock('@/lib/realtime/use-live-updates', () => ({
  useWorkspaceLive: jest.fn(),
  useDatabaseLive: jest.fn(),
}));
import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SidebarTree, SidebarTreeDrop, SidebarTreeItem } from '@oxy.so/bloom/sidebar';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { useSidebarTree } from '@/components/shell/use-sidebar-tree';
import { useNewPageStore } from '@/lib/stores/new-page-store';
import apiClient from '@/lib/api/client';
import type { Page } from '@/lib/types/pages';

jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: true, user: { id: 'me' } }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/p/b',
}));
jest.mock('@/lib/hooks/use-workspaces', () => ({ useWorkspaceRole: () => 'editor' }));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));
jest.mock('@/components/teamspaces/teamspace-dialog', () => ({ TeamspaceDialog: () => null }));

const page = (id: string, order: number, patch: Partial<Page> = {}) =>
  ({
    id,
    workspaceId: 'w',
    title: id.toUpperCase(),
    icon: null,
    order,
    parentId: null,
    teamspaceId: null,
    ownerId: 'me',
    archived: false,
    template: false,
    databaseId: null,
    favorited: false,
    updatedAt: '2026-10-20T00:00:00Z',
    ...patch,
  }) as unknown as Page;

const PAGES = [
  page('a', 1),
  page('b', 2, { favorited: true }),
  page('child', 1, { parentId: 'a' }),
  page('t1', 1, { teamspaceId: 'joined' }),
];
const SPACES = [
  {
    id: 'joined',
    name: 'Joined',
    icon: null,
    privacy: 'private',
    role: 'member',
    isDefault: false,
    archived: false,
  },
];

let client: QueryClient;
let renderer: ReactTestRenderer;
let current: ReturnType<typeof useSidebarTree>;

function Harness() {
  current = useSidebarTree('w');
  return (
    <>
      {current.tree.map((section) => (
        <React.Fragment key={section.key}>{section.actions}</React.Fragment>
      ))}
    </>
  );
}

async function mount() {
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>
      </BloomTestProviders>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const section = (key: string) => current.tree.find((each) => each.key === key) as SidebarTree;
const row = (items: ReadonlyArray<SidebarTreeItem> | undefined, key: string): SidebarTreeItem => {
  for (const item of items ?? []) {
    if (item.key === key) return item;
    const found = item.items ? row(item.items, key) : undefined;
    if (found) return found;
  }
  return undefined as unknown as SidebarTreeItem;
};

beforeEach(() => {
  jest.clearAllMocks();
  useNewPageStore.getState().close();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  jest.mocked(apiClient.get).mockImplementation(async (url: string) => ({
    data: url.endsWith('/teamspaces')
      ? { teamspaces: SPACES }
      : url.endsWith('/pages/shared')
        ? { shared: [] }
        : url.includes('/databases')
          ? { databases: [] }
          : { pages: PAGES, databases: [] },
  }));
  jest.mocked(apiClient.patch).mockResolvedValue({ data: { page: { id: 'x', workspaceId: 'w' } } });
});
afterEach(() => {
  act(() => renderer.unmount());
  client.clear();
});

it('builds the workspace tree: private pages that move, teamspace rows they go inside, favourites listed apart', async () => {
  await mount();
  const priv = section('private');
  expect(row(priv.items, 'a')).toMatchObject({ draggable: true, href: '/p/a' });
  expect(row(priv.items, 'child')).toMatchObject({ draggable: true });
  // The open page is selected wherever it is listed.
  expect(row(priv.items, 'b').selected).toBe(true);
  const favorites = section('favorites');
  expect(row(favorites.items, 'favorite:b')).toMatchObject({ draggable: false, selected: true });
  expect(favorites.droppable).toBe(false);
  const joined = row(section('teamspaces').items, 'teamspace:joined');
  expect(joined).toMatchObject({ dropBeside: false, droppable: true, expandable: true });
  expect(row(joined.items, 't1')).toMatchObject({ draggable: true });
  expect(row(section('teamspaces').items, 'teamspaces:browse')).toBeDefined();
});

it.each([
  ['private', null],
  ['teamspace:joined', 'joined'],
])('creates from %s with its placement', async (key, teamspaceId) => {
  await mount();
  const actions =
    key === 'private' ? section('private').actions : row(section('teamspaces').items, key).actions;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<BloomTestProviders>{actions}</BloomTestProviders>);
  });
  const add = tree.root.findAll(
    (node) =>
      typeof node.props.onPress === 'function' &&
      typeof node.props.accessibilityLabel === 'string' &&
      node.props.accessibilityLabel.startsWith('sidebar.addToSection'),
  )[0];
  await act(async () => add?.props.onPress());
  expect(useNewPageStore.getState().destination).toEqual({
    workspaceId: 'w',
    parentId: null,
    teamspaceId,
  });
  act(() => tree.unmount());
});

async function drop(partial: {
  item: string;
  target?: string;
  section: string;
  position?: SidebarTreeDrop['position'];
}) {
  const { item, target, section: key, position = 'inside' } = partial;
  const all = current.tree.flatMap((each) => each.items ?? []);
  await act(async () => {
    current.onTreeItemDrop({
      item: row(all, item),
      target: target ? row(all, target) : undefined,
      position,
      from: section('private'),
      section: section(key),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it('moves a page between its new neighbours', async () => {
  await mount();
  await drop({ item: 'b', target: 'a', position: 'before', section: 'private' });
  expect(apiClient.patch).toHaveBeenCalledWith(
    '/pages/b',
    expect.objectContaining({ order: 0, parentId: null, teamspaceId: null }),
  );
});

it("puts a page dropped on a teamspace's row at the end of that teamspace", async () => {
  await mount();
  await drop({ item: 'a', target: 'teamspace:joined', section: 'teamspaces' });
  expect(apiClient.patch).toHaveBeenCalledWith(
    '/pages/a',
    expect.objectContaining({ order: 2, parentId: null, teamspaceId: 'joined' }),
  );
});

it("puts a page dropped on the private section's label last among its pages", async () => {
  await mount();
  await drop({ item: 't1', section: 'private' });
  expect(apiClient.patch).toHaveBeenCalledWith(
    '/pages/t1',
    expect.objectContaining({ order: 3, parentId: null, teamspaceId: null }),
  );
});
