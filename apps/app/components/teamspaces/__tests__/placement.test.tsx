jest.mock('@/lib/realtime/use-live-updates', () => ({
  useWorkspaceLive: jest.fn(),
  useDatabaseLive: jest.fn(),
}));
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { NewPageDialog } from '@/components/templates/new-page-dialog';
import { MoveToDialog } from '@/components/page-chrome/move-to-dialog';
import { PlacementSections } from '@/components/sidebar-sections/placement-sections';
import { SidebarSection } from '@/components/sidebar-sections/sidebar-section';
import { TemplateList } from '@/components/templates/template-list';
import { ImportPagesDialog } from '@/components/page-chrome/import-pages-dialog';
import { useNewPageStore } from '@/lib/stores/new-page-store';
import apiClient from '@/lib/api/client';
import type { Page } from '@/lib/types/pages';

jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: true, user: { id: 'me' } }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/lib/hooks/use-workspaces', () => ({ useWorkspaceRole: () => 'editor' }));
jest.mock('@/lib/stores/workspace-store', () => ({ useWorkspaceStore: () => 'w' }));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));
// The dialog's own surface needs native overlay modules. This one is always
// shown, and closing it through its control reports the close as Bloom's does.
jest.mock('@oxy.so/bloom/dialog', () => {
  const { createElement, useImperativeHandle } = require('react');
  const { View } = require('react-native');
  function Dialog({
    children,
    control,
    onClose,
  }: {
    children: React.ReactNode;
    control?: { ref: React.Ref<unknown> };
    onClose?: () => void;
  }) {
    useImperativeHandle(
      control?.ref,
      () => ({
        open: () => {},
        close: (callback?: () => void) => {
          onClose?.();
          callback?.();
        },
      }),
      [onClose],
    );
    return createElement(View, null, children);
  }
  return { ...jest.requireActual('@oxy.so/bloom/dialog'), Dialog };
});
jest.mock('@/components/sidebar-sections/sidebar-section', () => ({
  SidebarSection: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/sidebar-sections/sidebar-page-tree', () => ({
  SidebarPageTree: () => null,
}));
jest.mock('@/components/teamspaces/teamspace-dialog', () => ({ TeamspaceDialog: () => null }));
jest.mock('@/components/templates/template-list', () => ({ TemplateList: () => null }));
jest.mock('@/components/page-chrome/import-pages-dialog', () => ({
  ImportPagesDialog: () => null,
}));

const spaces = [
  {
    id: 'default',
    name: 'Default',
    privacy: 'open',
    role: 'member',
    isDefault: true,
    archived: false,
  },
  { id: 'joined', name: 'Joined', privacy: 'private', role: 'member', archived: false },
  { id: 'open', name: 'Open', privacy: 'open', role: null, archived: false },
  { id: 'closed', name: 'Closed', privacy: 'closed', role: null, archived: false },
];
let client: QueryClient;
let renderer: ReactTestRenderer;
async function mount(element: React.ReactNode) {
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <QueryClientProvider client={client}>{element}</QueryClientProvider>
      </BloomTestProviders>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
/** The labels of everything pressable, by props: the outermost node is the Bloom control. */
function pressables() {
  return renderer.root.findAll(
    (node) =>
      typeof node.props.accessibilityLabel === 'string' && typeof node.props.onPress === 'function',
  );
}
function labels() {
  return pressables().map((node) => node.props.accessibilityLabel);
}
async function press(label: string) {
  const button = pressables().find((b) => b.props.accessibilityLabel === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => {
    button.props.onPress();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  useNewPageStore.getState().close();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  jest.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: url.endsWith('/teamspaces') ? { teamspaces: spaces } : { pages: [], databases: [] },
  }));
  jest.mocked(apiClient.post).mockResolvedValue({
    data: { page: { id: 'new', workspaceId: 'w' }, database: { id: 'db', workspaceId: 'w' } },
  });
  jest
    .mocked(apiClient.patch)
    .mockResolvedValue({ data: { page: { id: 'page', workspaceId: 'w' } } });
});
afterEach(() => {
  act(() => {
    renderer.unmount();
    useNewPageStore.getState().close();
  });
  client.clear();
});

it.each([
  ['teamspace:joined', 'joined'],
  ['private', null],
])('creates from the %s section with explicit placement', async (sectionKey, teamspaceId) => {
  await mount(
    <>
      <PlacementSections />
      <NewPageDialog />
    </>,
  );
  const section = renderer.root
    .findAllByType(SidebarSection)
    .find((s) => s.props.sectionKey === sectionKey);
  expect(section).toBeDefined();
  await act(async () => section?.props.onAdd());
  expect(useNewPageStore.getState().destination).toEqual({
    workspaceId: 'w',
    parentId: null,
    teamspaceId,
  });
  await press('pages.templates.blank');
  expect(apiClient.post).toHaveBeenCalledWith('/pages', {
    workspaceId: 'w',
    parentId: null,
    teamspaceId,
    title: '',
  });
});

it.each(['joined', null, undefined])(
  'preserves %s placement for database creation',
  async (teamspaceId) => {
    useNewPageStore.getState().open({ workspaceId: 'w', parentId: null, teamspaceId });
    await mount(<NewPageDialog />);
    await press('workspace.teamspaces.newDatabase');
    expect(apiClient.post).toHaveBeenCalledWith(
      '/databases',
      expect.objectContaining({ workspaceId: 'w', parentPageId: null, teamspaceId }),
    );
  },
);

it('uses the private section when applying a template from another teamspace', async () => {
  useNewPageStore.getState().open({ workspaceId: 'w', parentId: null, teamspaceId: null });
  await mount(<NewPageDialog />);
  await press('pages.templates.fromTemplate');
  await act(async () =>
    renderer.root.findByType(TemplateList).props.onUse({ id: 'template', teamspaceId: 'other' }),
  );
  expect(apiClient.post).toHaveBeenCalledWith('/pages/template/duplicate', {
    fromTemplate: true,
    parentId: null,
    teamspaceId: null,
  });
});

it.each(['pages.import.title', 'databases.csv.import'])(
  'passes section placement into %s',
  async (label) => {
    useNewPageStore.getState().open({ workspaceId: 'w', parentId: null, teamspaceId: 'joined' });
    await mount(<NewPageDialog />);
    await press(label);
    expect(renderer.root.findByType(ImportPagesDialog).props).toEqual(
      expect.objectContaining({
        workspaceId: 'w',
        parentId: null,
        teamspaceId: 'joined',
        csvOnly: label === 'databases.csv.import',
      }),
    );
  },
);

it.each([
  ['Joined', 'joined'],
  ['sidebar.sections.private', null],
])('moves a subpage to the top of %s', async (label, teamspaceId) => {
  const closed = jest.fn();
  await mount(
    <MoveToDialog
      open
      onOpenChange={closed}
      page={{ id: 'page', workspaceId: 'w', parentId: 'parent' } as Page}
    />,
  );
  expect(labels()).not.toContain('Closed');
  expect(labels()).toContain('Open');
  await press(label);
  expect(apiClient.patch).toHaveBeenCalledWith('/pages/page', { parentId: null, teamspaceId });
  expect(closed).toHaveBeenCalledWith(false);
});

it.each(['NO_TEAMSPACE_ACCESS', 'INSUFFICIENT_ROLE'])(
  'keeps Move to open and explains %s',
  async (code) => {
    jest.mocked(apiClient.patch).mockRejectedValue({
      isAxiosError: true,
      response: { data: { code, error: 'Server explanation' }, status: 403 },
    });
    const closed = jest.fn();
    await mount(
      <MoveToDialog
        open
        onOpenChange={closed}
        page={{ id: 'page', workspaceId: 'w', parentId: null } as Page}
      />,
    );
    await press('Joined');
    expect(closed).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('Server explanation');
  },
);
