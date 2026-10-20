import type { ComponentType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Button } from '@oxy.so/bloom/button';
import { Item } from '@oxy.so/bloom/item';
import { HoverCard } from '@oxy.so/bloom/hover-card';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import apiClient from '@/lib/api/client';
import type { Page } from '@/lib/types/pages';
import { PageActivity, PageActivityPanel } from '../page-activity';
import { PageHistoryDialog } from '../page-history-dialog';
import { PageInfo } from '../page-info';

const mockPush = jest.fn();
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
  useOxy: () => ({ isAuthenticated: true }),
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
const versions = [
  { id: 'v1', createdBy: 'unknown', createdAt: page.updatedAt, blockCount: 5 },
  { id: 'v2', createdBy: 'owner', createdAt: page.createdAt, blockCount: 2 },
];
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
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } } });
  jest.mocked(apiClient.get).mockResolvedValue({ data: { versions } });
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
});

it('does not request versions while closed, and loads them when the panel opens', async () => {
  await mount(<PageActivityPanel page={page} open={false} onClose={onClose} />);
  expect(apiClient.get).not.toHaveBeenCalled();
  await act(async () =>
    renderer.update(tree(<PageActivityPanel page={page} open onClose={onClose} />)),
  );
  await settle();
  expect(apiClient.get).toHaveBeenCalledWith('/pages/page/versions', expect.any(Object));
  expect(titles()).toContain('pages.activity.savedBy:Page owner');
  expect(jest.mocked(apiClient.post)).not.toHaveBeenCalled();
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

it('shows loading then an error with retry, without inventing activity entries', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(apiClient.get).mockReturnValue(
    new Promise((_resolve, refuse) => {
      reject = refuse;
    }),
  );
  await mount(<PageActivityPanel page={page} open onClose={onClose} />);
  expect(titles().filter((title) => String(title).startsWith('pages.activity.savedBy'))).toEqual(
    [],
  );
  expect(
    renderer.root.findAll((node) => node.props.accessibilityLabel === 'common.loading').length,
  ).toBeGreaterThan(0);
  await act(async () => reject(new Error('Unavailable')));
  await settle();
  const retry = renderer.root
    .findAllByType(Button)
    .find((node) => String(node.props.children).includes('pages.publish.retry'));
  expect(retry).toBeDefined();
  jest.mocked(apiClient.get).mockResolvedValue({ data: { versions } });
  if (!retry) throw new Error('Retry button missing');
  await act(async () => retry.props.onPress());
  await settle();
  expect(titles()).toContain('pages.activity.savedBy:Page owner');
});

it('opens the existing history dialog at the selected version, without restoring anything', async () => {
  await mount(<PageActivityPanel page={page} open onClose={onClose} />);
  const choices = renderer.root.findAllByType(ItemRenderer).filter((item) => item.props.onPress);
  expect(choices).toHaveLength(2);
  act(() => choices[1].props.onPress());
  const history = renderer.root.findByType(PageHistoryDialog);
  expect(history.props.initialVersionId).toBe('v2');
  expect(history.props.page).toBe(page);
  expect(apiClient.post).not.toHaveBeenCalled();
  act(() => history.props.onClose());
  expect(renderer.root.findAllByType(PageHistoryDialog)).toHaveLength(0);
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

it('resets the selected history version when the activity panel changes page', async () => {
  await mount(<PageActivityPanel page={page} open onClose={onClose} />);
  const choice = renderer.root.findAllByType(ItemRenderer).find((item) => item.props.onPress);
  if (!choice) throw new Error('Version choice missing');
  act(() => choice.props.onPress());
  expect(renderer.root.findAllByType(PageHistoryDialog)).toHaveLength(1);
  await act(async () =>
    renderer.update(
      tree(<PageActivityPanel page={{ ...page, id: 'second' }} open onClose={onClose} />),
    ),
  );
  await settle();
  expect(renderer.root.findAllByType(PageHistoryDialog)).toHaveLength(0);
  expect(apiClient.get).toHaveBeenCalledWith('/pages/second/versions', expect.any(Object));
});
