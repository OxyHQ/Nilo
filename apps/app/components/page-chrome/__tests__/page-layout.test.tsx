jest.mock('@/components/page-chrome/canvas-switch', () => ({ CanvasSwitch: () => null }));
jest.mock('@/components/page-chrome/ai-page-action', () => ({ AiPageAction: () => null }));
jest.mock('@/lib/realtime/use-live-updates', () => ({
  useWorkspaceLive: jest.fn(),
  useDatabaseLive: jest.fn(),
}));
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PageActionsMenu } from '../page-actions-menu';
import { PageChrome, PageHeader } from '../page-chrome';
import { Switch } from '@oxy.so/bloom/switch';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import apiClient from '@/lib/api/client';
import { usePage } from '@/lib/hooks/use-pages';
import { queryKeys } from '@/lib/hooks/query-keys';
import type { Page, PageResponse } from '@/lib/types/pages';

jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { patch: jest.fn(), get: jest.fn() },
}));
jest.mock('@oxy.so/services', () => ({
  useOxy: () => ({ isAuthenticated: true, user: { id: 'owner' } }),
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@oxy.so/bloom/fonts', () => ({
  fontFamilies: { sans: 'Inter', display: 'BlomusModernus', mono: 'JetBrains Mono' },
}));
jest.mock('@oxy.so/bloom/popover', () => {
  const { View } = require('react-native');
  return { Popover: View, PopoverTrigger: View, PopoverContent: View, PopoverSeparator: View };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({ colors: { foreground: 'black', mutedForeground: 'gray' } }),
}));
jest.mock('@/lib/hooks/use-page-follow', () => ({
  usePageFollow: () => ({ data: {}, refetch: jest.fn() }),
  useSetPageFollow: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/lib/hooks/use-page-transfer', () => ({ useExportPage: () => ({}) }));
jest.mock('@/lib/save-export', () => ({ saveExport: jest.fn() }));
jest.mock('@/components/reminders/reminder-dialog', () => ({ ReminderDialog: () => null }));
jest.mock('../page-history-dialog', () => ({ PageHistoryDialog: () => null }));
jest.mock('../import-pages-dialog', () => ({ ImportPagesDialog: () => null }));
jest.mock('../move-to-dialog', () => ({ MoveToDialog: () => null }));
jest.mock('@oxy.so/bloom/surfaces', () => ({ confirm: jest.fn().mockResolvedValue(true) }));
jest.mock('../breadcrumb', () => ({ Breadcrumb: () => null }));
jest.mock('../favorite-button', () => ({ FavoriteButton: () => null }));
jest.mock('../cover-display', () => ({ CoverDisplay: () => null }));
jest.mock('../icon-display', () => ({ IconDisplay: () => null }));
jest.mock('../icon-picker', () => ({ IconPicker: jest.fn(() => null) }));
jest.mock('../cover-picker', () => ({ CoverPicker: jest.fn(() => null) }));
jest.mock('../page-info', () => ({ PageInfo: () => null }));

const initial: Page = {
  id: 'page',
  teamspaceId: null,
  workspaceId: 'workspace',
  ownerId: 'owner',
  parentId: null,
  title: 'A page',
  icon: '📄',
  cover: 'cover',
  coverPosition: 50,
  fullWidth: false,
  smallText: false,
  font: 'default',
  mode: 'document',
  locked: false,
  archived: false,
  favorited: false,
  template: false,
  restricted: false,
  publishSlug: null,
  publishedAt: null,
  publishIndexing: false,
  order: 0,
  createdAt: '',
  updatedAt: '',
  databaseId: null,
  properties: {},
};
let client: QueryClient;
let renderer: ReactTestRenderer;
let serverPage: Page;
let resolvePatch: (value: unknown) => void;
let rejectPatch: (reason: Error) => void;
function Surface({ readOnly = false }: { readOnly?: boolean }) {
  const { data } = usePage('page');
  if (!data) return null;
  return (
    <PageChrome page={data.page} readOnly={readOnly}>
      <PageHeader page={data.page} readOnly={readOnly} />
    </PageChrome>
  );
}
async function mount(page = initial, readOnly = false) {
  serverPage = { ...page };
  client.setQueryData(queryKeys.pages.detail('page'), {
    page,
    role: readOnly ? 'viewer' : 'editor',
  });
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <QueryClientProvider client={client}>
          <Surface readOnly={readOnly} />
        </QueryClientProvider>
      </BloomTestProviders>,
    );
  });
}
function cached() {
  return client.getQueryData<PageResponse>(queryKeys.pages.detail('page'))!.page;
}
/** The control labelled `label`, once (not its host views too). */
function button(label: string) {
  return renderer.root.findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function',
    { deep: false },
  )[0]!;
}
/** The font choice labelled `label`. */
function fontChoice(label: string) {
  return renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label && typeof node.props.onValueChange === 'function',
    { deep: false },
  )[0]!;
}
function toggle(field: string) {
  return renderer.root
    .findAllByType(Switch)
    .find((node) => node.props.accessibilityLabel === `pages.style.${field}`)!;
}
async function settle(patch: Partial<Page>) {
  serverPage = { ...serverPage, ...patch };
  await act(async () => {
    resolvePatch({ data: { page: serverPage } });
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  jest
    .mocked(apiClient.get)
    .mockImplementation(async () => ({ data: { page: serverPage, role: 'editor' } }));
  jest.mocked(apiClient.patch).mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        resolvePatch = resolve;
        rejectPatch = reject;
      }),
  );
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
});

it.each(['default', 'serif', 'mono'] as const)(
  'applies %s immediately and PATCHes its font',
  async (font) => {
    await mount({ ...initial, font: 'mono' });
    await act(async () => {
      fontChoice(`pages.style.${font}`).props.onValueChange(font);
    });
    expect(apiClient.patch).toHaveBeenCalledWith('/pages/page', { font });
    expect(cached().font).toBe(font);
    await settle({ font });
    expect(fontChoice(`pages.style.${font}`).props.checked).toBe(true);
    expect(renderer.root.findByType(TextInput).props.style[0].fontFamily).toBe(
      { default: 'Inter', serif: 'BlomusModernus', mono: 'JetBrains Mono' }[font],
    );
  },
);
it.each(['smallText', 'fullWidth', 'locked'] as const)(
  'toggles %s both ways and updates the cache',
  async (field) => {
    await mount();
    for (const value of [true, false]) {
      await act(async () => {
        toggle(field).props.onCheckedChange(value);
      });
      expect(apiClient.patch).toHaveBeenLastCalledWith('/pages/page', { [field]: value });
      expect(cached()[field]).toBe(value);
      await settle({ [field]: value });
      expect(toggle(field).props.checked).toBe(value);
    }
  },
);
it('rolls back a failed setting and refetches the page', async () => {
  await mount();
  await act(async () => {
    toggle('fullWidth').props.onCheckedChange(true);
  });
  expect(cached().fullWidth).toBe(true);
  await act(async () => {
    rejectPatch(new Error('offline'));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(cached().fullWidth).toBe(false);
  expect(apiClient.get).toHaveBeenCalledWith('/pages/page');
});
it('locks title/icon/cover, shows the banner, and unlocks optimistically for editors', async () => {
  await mount({ ...initial, locked: true });
  expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
  expect(renderer.root.findAllByProps({ accessibilityLabel: 'pages.cover.change' })).toHaveLength(
    0,
  );
  expect(JSON.stringify(renderer.toJSON())).toContain('pages.lock.banner');
  expect(toggle('fullWidth').props.disabled).toBe(false);
  await act(async () => {
    button('pages.lock.unlock').props.onPress();
  });
  expect(apiClient.patch).toHaveBeenCalledWith('/pages/page', { locked: false });
  expect(cached().locked).toBe(false);
  await settle({ locked: false });
  expect(renderer.root.findAllByType(TextInput)).toHaveLength(1);
  expect(button('pages.lock.unlock')).toBeUndefined();
});
it('shows the lock banner to viewers without settings or unlock controls', async () => {
  await mount({ ...initial, locked: true }, true);
  expect(JSON.stringify(renderer.toJSON())).toContain('pages.lock.banner');
  expect(button('pages.lock.unlock')).toBeUndefined();
  // No page settings; keeping the page offline is a viewer's to choose too.
  expect(renderer.root.findAllByType(Switch).map((s) => s.props.accessibilityLabel)).toEqual([
    'pages.offline.available',
  ]);
  expect(renderer.root.findByType(PageActionsMenu).props.readOnly).toBe(true);
});
