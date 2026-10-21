import type { ComponentType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Button } from '@oxy.so/bloom/button';
import { Item } from '@oxy.so/bloom/item';
import { ActivityFeed } from '@oxy.so/bloom/activity-feed';
import { HoverCard } from '@oxy.so/bloom/hover-card';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import apiClient from '@/lib/api/client';
import type { Page } from '@/lib/types/pages';
import { queryKeys } from '@/lib/hooks/query-keys';
import { PageActivity, PageActivityPanel } from '../page-activity';
import { PageHistoryDialog } from '../page-history-dialog';
import { PageInfo } from '../page-info';

const mockPush = jest.fn();
jest.mock('@/lib/realtime/use-live-updates', () => ({ useWorkspaceLive: jest.fn() }));
let role = 'editor';
let mockPresentation: 'inline' | 'floating' = 'inline';
jest.mock('@oxy.so/bloom/app-shell/hooks', () => ({
  useAppShellPanel: () => ({ presentation: mockPresentation }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('@/lib/config', () => ({
  __esModule: true,
  default: { apiUrl: 'https://api.example.test' },
}));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({
    isAuthenticated: true,
    user: { id: 'self' },
    oxyServices: {
      users: { getMany: async () => [{ id: 'owner', name: { displayName: 'Page owner' } }] },
    },
  }),
  useUserById: (id: string | null) => ({
    data: id === 'owner' ? { name: { displayName: 'Page owner' } } : undefined,
  }),
}));
// Native test-renderer has no DOM layout or hover positioning. Only those
// boundaries are substituted; activity state, queries and controls remain real.
jest.mock('@oxy.so/bloom/hover-card', () => ({
  HoverCard: ({ children }: { children: React.ReactNode }) => children,
  HoverCardContent: ({ children }: { children: React.ReactNode }) => children,
  HoverCardTrigger: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@oxy.so/bloom/screen', () => ({
  Screen: ({ header, children }: { header?: React.ReactNode; children: React.ReactNode }) => (
    <>
      {header}
      {children}
    </>
  ),
  ScreenScrollView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../page-history-dialog', () => ({ PageHistoryDialog: jest.fn(() => null) }));
jest.mock('../icon-display', () => ({ IconDisplay: () => null }));

const page = {
  id: 'page',
  workspaceId: 'workspace',
  ownerId: 'owner',
  lastEditedBy: 'unknown',
  createdAt: '2026-10-20T12:00:00Z',
  updatedAt: '2026-10-21T12:00:00Z',
} as Page;
let client: QueryClient;
let renderer: ReactTestRenderer;
const onClose = jest.fn();
const onOpen = jest.fn();
const events = [
  {
    id: 'e1',
    pageId: page.id,
    actorIds: ['owner'],
    kind: 'metadata_changed',
    createdAt: page.updatedAt,
    changes: [{ field: 'title', before: 'Before', after: 'After' }],
  },
  {
    id: 'e2',
    pageId: page.id,
    actorIds: ['owner'],
    kind: 'created',
    createdAt: page.createdAt,
    changes: [],
  },
];
const ActivityRenderer = (ActivityFeed as unknown as { type: ComponentType }).type;
const entries = () => renderer.root.findByType(ActivityRenderer).props.entries;
const historyButton = () =>
  renderer.root
    .findAllByType(Button)
    .find((node) => node.props.accessibilityLabel === 'pages.history.title');
function tree(content: React.ReactNode) {
  return (
    <BloomTestProviders>
      <QueryClientProvider client={client}>{content}</QueryClientProvider>
    </BloomTestProviders>
  );
}
async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}
async function mount(content: React.ReactNode) {
  await act(async () => {
    renderer = create(tree(content));
  });
  await settle();
}
const ItemRenderer = (Item as unknown as { type: ComponentType }).type;
const titles = () => renderer.root.findAllByType(ItemRenderer).map((item) => item.props.title);
beforeEach(() => {
  mockPresentation = 'inline';
  role = 'editor';
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  jest
    .mocked(apiClient.get)
    .mockImplementation(async (url) =>
      /^\/pages\/[^/]+$/.test(String(url))
        ? { data: { page: { ...page, id: String(url).split('/').at(-1) }, role } }
        : { data: { items: events, nextCursor: null } },
    );
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
});

it('shows actual editor and creator metadata, including an unknown-profile fallback', async () => {
  await mount(<PageActivity page={page} onOpen={onOpen} />);
  expect(titles()).toContain('pages.activity.editedBy:pages.info.unknownMember');
  expect(titles()).toContain('pages.activity.createdBy:Page owner');
  expect(apiClient.get).not.toHaveBeenCalled();
  const hover = renderer.root.findByType(HoverCard);
  act(() => hover.props.onOpenChange(true));
  const button = renderer.root.findAllByType(Button).find((node) => node.props.onPress);
  if (!button) throw new Error('Activity button missing');
  act(() => button.props.onPress());
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByType(HoverCard).props.open).toBe(false);
});

it('does not render invalid dates as Invalid Date or NaN', async () => {
  await mount(
    <PageActivity page={{ ...page, createdAt: 'invalid', updatedAt: 'invalid' }} onOpen={onOpen} />,
  );
  expect(JSON.stringify(renderer.toJSON())).not.toMatch(/Invalid Date|NaN/);
});

it('does not show zero backlinks or duplicate edited metadata beneath the title', async () => {
  jest.mocked(apiClient.get).mockResolvedValue({ data: { backlinks: [] } });
  await mount(<PageInfo page={page} />);
  expect(renderer.root.findAllByType(Button)).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).not.toMatch(/backlinks|Edited by|Unknown member/);
});

it('keeps useful backlinks expandable and navigable when they exist', async () => {
  jest.mocked(apiClient.get).mockResolvedValue({
    data: {
      backlinks: [
        { page: { id: 'source', title: 'Source document', icon: null }, text: 'Referenced here' },
      ],
    },
  });
  await mount(<PageInfo page={page} />);
  const toggle = renderer.root.findByType(Button);
  expect(toggle.props.accessibilityLabel).toContain('pages.backlinks.count');
  act(() => toggle.props.onPress());
  const link = renderer.root.findAll(
    (node) => node.props.accessibilityRole === 'link' && node.props.onPress,
  )[0];
  expect(link.props.accessibilityLabel).toBe('Source document');
  act(() => link.props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/p/source');
});

it('loads actual updates only when open, never version snapshots', async () => {
  await mount(<PageActivityPanel page={page} open={false} onClose={onClose} />);
  expect(apiClient.get).not.toHaveBeenCalled();
  await act(async () =>
    renderer.update(tree(<PageActivityPanel page={page} open onClose={onClose} />)),
  );
  await settle();
  expect(apiClient.get).toHaveBeenCalledWith('/pages/page/activity', expect.any(Object));
  expect(entries().map((entry: { id: string }) => entry.id)).toEqual(['e1', 'e2']);
  expect(entries()[0].actor.name).toBe('Page owner');
  expect(
    jest.mocked(apiClient.get).mock.calls.some(([url]) => String(url).includes('/versions')),
  ).toBe(false);
});

it('retries failed updates without inventing entries', async () => {
  jest.mocked(apiClient.get).mockImplementation(async (url) => {
    if (String(url).endsWith('/activity')) throw new Error('Unavailable');
    return { data: { page, role } };
  });
  await mount(<PageActivityPanel page={page} open onClose={onClose} />);
  await settle();
  expect(entries()).toEqual([]);
  const retry = renderer.root
    .findAllByType(Button)
    .find((node) => node.props.children === 'pages.publish.retry');
  expect(retry).toBeDefined();
  jest.mocked(apiClient.get).mockResolvedValue({ data: { items: events, nextCursor: null } });
  await act(async () => retry?.props.onPress());
  await settle();
  expect(entries()).toHaveLength(2);
});

it('opens history separately without assigning a snapshot to an update', async () => {
  await mount(<PageActivityPanel page={page} open onClose={onClose} />);
  act(() => historyButton()?.props.onPress());
  expect(renderer.root.findByType(PageHistoryDialog).props.initialVersionId).toBeUndefined();
  expect(apiClient.post).not.toHaveBeenCalled();
  act(() => renderer.root.findByType(PageHistoryDialog).props.onClose());
  expect(renderer.root.findAllByType(PageHistoryDialog)).toHaveLength(0);
});

it('resets history on page changes', async () => {
  await mount(<PageActivityPanel page={page} open onClose={onClose} />);
  act(() => historyButton()?.props.onPress());
  expect(renderer.root.findAllByType(PageHistoryDialog)).toHaveLength(1);
  await act(async () =>
    renderer.update(
      tree(<PageActivityPanel page={{ ...page, id: 'second' }} open onClose={onClose} />),
    ),
  );
  await settle();
  expect(renderer.root.findAllByType(PageHistoryDialog)).toHaveLength(0);
  expect(apiClient.get).toHaveBeenCalledWith('/pages/second/activity', expect.any(Object));
});

it('uses the compositor floating close without duplicate close controls', async () => {
  await mount(<PageActivityPanel page={page} open onClose={onClose} />);
  expect(
    renderer.root.findAll((node) => node.props.accessibilityLabel === 'pages.activity.close')
      .length,
  ).toBeGreaterThan(0);
  mockPresentation = 'floating';
  await act(async () =>
    renderer.update(tree(<PageActivityPanel page={page} open onClose={onClose} />)),
  );
  expect(
    renderer.root.findAll((node) => node.props.accessibilityLabel === 'pages.activity.close'),
  ).toHaveLength(0);
  expect(entries()).toHaveLength(2);
});

it.each(['viewer', 'commenter'])(
  'retires historical values for %s without querying activity',
  async (value) => {
    role = value;
    client.setQueryData(queryKeys.pageActivity.page(page.workspaceId, page.id), {
      pages: [{ items: events, nextCursor: null }],
      pageParams: [null],
    });
    await mount(<PageActivityPanel page={page} open onClose={onClose} />);
    expect(historyButton()).toBeUndefined();
    expect(titles()).toContain('pages.activity.restricted');
    expect(
      jest.mocked(apiClient.get).mock.calls.some(([url]) => String(url).endsWith('/activity')),
    ).toBe(false);
    expect(client.getQueryData(queryKeys.pageActivity.page(page.workspaceId, page.id))).toBeNull();
  },
);

it('closes history and removes historical activity after a live downgrade', async () => {
  await mount(<PageActivityPanel page={page} open onClose={onClose} />);
  act(() => historyButton()?.props.onPress());
  role = 'viewer';
  await act(async () =>
    client.invalidateQueries({ queryKey: queryKeys.pages.detail(page.id), exact: true }),
  );
  await settle();
  expect(renderer.root.findAllByType(PageHistoryDialog)).toHaveLength(0);
  expect(renderer.root.findAllByType(ActivityRenderer)).toHaveLength(0);
  expect(client.getQueryData(queryKeys.pageActivity.page(page.workspaceId, page.id))).toBeNull();
});
