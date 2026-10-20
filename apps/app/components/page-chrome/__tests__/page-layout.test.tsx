// Activity's requests and interaction are covered by page-activity.test.tsx.
jest.mock('../page-activity', () => ({ PageActivity: () => null, PageActivityPanel: () => null }));
jest.mock('@/components/page-chrome/canvas-switch', () => ({ CanvasSwitch: () => null }));
jest.mock('@/components/page-chrome/ai-page-action', () => ({ AiPageAction: () => null }));
jest.mock('@/lib/realtime/use-live-updates', () => ({
  useWorkspaceLive: jest.fn(),
  useDatabaseLive: jest.fn(),
}));
import { Children, isValidElement } from 'react';
import type { PageHeaderProps } from '@oxy.so/bloom/page-header';
import { FavoriteButton } from '../favorite-button';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, TextInput } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PageActionsMenu } from '../page-actions-menu';
import { PageChrome, PageHeader } from '../page-chrome';
import {
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
} from '@oxy.so/bloom/dropdown-menu';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import apiClient from '@/lib/api/client';
import { usePage } from '@/lib/hooks/use-pages';
import { queryKeys } from '@/lib/hooks/query-keys';
import type { Page, PageResponse } from '@/lib/types/pages';

jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { patch: jest.fn(), get: jest.fn() },
}));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: true, user: { id: 'owner' } }),
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@oxy.so/bloom/fonts', () => ({
  fontFamilies: { sans: 'Inter', display: 'BlomusModernus', mono: 'JetBrains Mono' },
}));
// Page persistence is under test; overlay positioning and keyboard navigation
// belong to Bloom's menu tests and the Windows browser checks.
jest.mock('@oxy.so/bloom/dropdown-menu', () => {
  const React = require('react');
  const { View } = require('react-native');
  return Object.fromEntries(
    [
      'DropdownMenu',
      'DropdownMenuTrigger',
      'DropdownMenuContent',
      'DropdownMenuItem',
      'DropdownMenuCheckboxItem',
      'DropdownMenuRadioGroup',
      'DropdownMenuRadioItem',
      'DropdownMenuSeparator',
      'DropdownMenuSub',
      'DropdownMenuSubTrigger',
      'DropdownMenuSubContent',
    ].map((name) => [name, (props: Record<string, unknown>) => React.createElement(View, props)]),
  );
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
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
jest.mock('@/lib/hooks/use-workspaces', () => ({ useWorkspaceRole: () => 'owner' }));
jest.mock('../cover-display', () => ({ CoverDisplay: () => null }));
jest.mock('../icon-display', () => ({ IconDisplay: () => null }));
jest.mock('../icon-picker', () => ({ IconPicker: jest.fn(() => null) }));
jest.mock('../cover-picker', () => ({ CoverPicker: jest.fn(() => null) }));
jest.mock('../page-info', () => ({ PageInfo: () => null }));
// What the page route's editor provider holds, for the page as it is cached now.
jest.mock('@/components/page-editor/page-editor-context', () => ({
  usePageEditorContext: () => {
    const { data } = jest.requireActual('@/lib/hooks/use-pages').usePage('page');
    const { pageContentReadOnly } = jest.requireActual('@/lib/hooks/page-access');
    return { readOnly: pageContentReadOnly(data.page, data.role) };
  },
}));

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
function Surface({
  readOnly = false,
  rightHeader,
}: {
  readOnly?: boolean;
  rightHeader?: PageHeaderProps['actions'];
}) {
  const { data } = usePage('page');
  if (!data) return null;
  return (
    <PageChrome page={data.page} readOnly={readOnly} rightHeader={rightHeader}>
      <PageHeader page={data.page} readOnly={readOnly} />
    </PageChrome>
  );
}
async function mount(page = initial, readOnly = false, rightHeader?: PageHeaderProps['actions']) {
  serverPage = { ...page };
  client.setQueryData(queryKeys.pages.detail('page'), {
    page,
    role: readOnly ? 'viewer' : 'editor',
  });
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <QueryClientProvider client={client}>
          <Surface readOnly={readOnly} rightHeader={rightHeader} />
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
function toggle(field: string) {
  return renderer.root
    .findAllByType(DropdownMenuCheckboxItem)
    .find((node) => node.props.children === `pages.style.${field}`)!;
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

it('persists Bloom cover coordinates and exposes save failures to its editor', async () => {
  await mount({ ...initial, cover: 'image:https://example.test/cover.jpg' });
  let pending = Promise.resolve();
  await act(async () => {
    pending = renderer.root
      .findByProps({ testID: 'page-cover' })
      .props.onCoverPositionCommit({ x: 0.5, y: 0.314 });
  });
  expect(apiClient.patch).toHaveBeenCalledWith('/pages/page', { coverPosition: 31 });
  await settle({ coverPosition: 31 });
  await pending;
  expect(renderer.root.findByProps({ testID: 'page-cover' }).props.coverPosition).toEqual({
    x: 0.5,
    y: 0.31,
  });
  let failure: Promise<unknown>;
  await act(async () => {
    failure = renderer.root
      .findByProps({ testID: 'page-cover' })
      .props.onCoverPositionCommit({ x: 0.5, y: 0.6 })
      .catch((error: unknown) => error);
  });
  const error = new Error('offline');
  await act(async () => {
    rejectPatch(error);
    expect(await failure).toBe(error);
  });
  expect(cached().coverPosition).toBe(31);
});

it.each([{ locked: true }, { archived: true }])(
  'keeps the cover readable but disables mutation for %j',
  async (state) => {
    await mount({ ...initial, ...state, cover: 'image:https://example.test/cover.jpg' });
    const cover = renderer.root.findByProps({ testID: 'page-cover' });
    expect(cover.props.repositionable).toBe(false);
    expect(cover.props.onChangeCover).toBeUndefined();
    await act(async () => cover.props.onCoverPositionCommit({ x: 0.5, y: 0.1 }));
    expect(apiClient.patch).not.toHaveBeenCalled();
  },
);

it.each(['default', 'serif', 'mono'] as const)(
  'applies %s immediately and PATCHes its font',
  async (font) => {
    await mount({ ...initial, font: 'mono' });
    await act(async () => {
      renderer.root.findByType(DropdownMenuRadioGroup).props.onValueChange(font);
    });
    expect(apiClient.patch).toHaveBeenCalledWith('/pages/page', { font });
    expect(cached().font).toBe(font);
    await settle({ font });
    expect(renderer.root.findByType(DropdownMenuRadioGroup).props.value).toBe(font);
    expect(StyleSheet.flatten(renderer.root.findByType(TextInput).props.style).fontFamily).toBe(
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
  expect(apiClient.get).toHaveBeenCalledWith(
    '/pages/page',
    expect.objectContaining({ signal: expect.anything() }),
  );
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
  expect(
    renderer.root.findAllByType(DropdownMenuCheckboxItem).map((s) => s.props.children),
  ).toEqual(['pages.follow.follow', 'pages.offline.available']);
  expect(renderer.root.findByType(PageActionsMenu).props.readOnly).toBe(true);
});

it.each([false, true])(
  'delegates compact header actions and retains favorites in the menu for readOnly=%s',
  async (readOnly) => {
    const rightHeader = jest.fn(() => null);
    await mount(initial, readOnly, rightHeader);
    const header = renderer.root.findAll(
      (node) =>
        node.props.presentation === 'navigation' && typeof node.props.actions === 'function',
    )[0];
    const full = Children.toArray(header.props.actions({ compact: false }).props.children).filter(
      isValidElement,
    );
    const compact = Children.toArray(header.props.actions({ compact: true }).props.children).filter(
      isValidElement,
    );
    expect(full.some((child) => child.type === FavoriteButton)).toBe(true);
    expect(compact.some((child) => child.type === FavoriteButton)).toBe(false);
    expect(compact.some((child) => child.type === PageActionsMenu)).toBe(true);
    expect(rightHeader).toHaveBeenCalledWith({ compact: true });
    const favorite = renderer.root
      .findAllByType(DropdownMenuItem)
      .find((node) => node.props.children === 'pages.actions.addToFavorites');
    expect(favorite).toBeDefined();
    await act(async () => favorite?.props.onPress());
    expect(apiClient.patch).toHaveBeenCalledWith('/pages/page', { favorited: true });
    await settle({ favorited: true });
  },
);
