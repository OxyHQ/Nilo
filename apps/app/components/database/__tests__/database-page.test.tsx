import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Platform, TextInput } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WorkspaceRole } from '@/lib/hooks/use-workspaces';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import DatabaseRoute from '../../../app/(app)/db/[id]';
import { DatabaseActionsMenu } from '../database-actions-menu';
import { DatabaseHeader } from '../database-header';
import { DatabaseViewContainer } from '../database-view';
import { PropertyCell } from '../property-cell';
import type { Database, DatabaseRow, DatabaseView } from '@/lib/types/databases';

let mockRole: WorkspaceRole = 'viewer';

// react-test-renderer supplies native host refs, not DOM scroll owners. Keep the
// real Screen scope/chrome; viewport geometry is covered by Bloom and browser QA.
jest.mock('@oxy.so/bloom/screen', () => {
  const actual = jest.requireActual('@oxy.so/bloom/screen');
  const React = jest.requireActual('react');
  return {
    ...actual,
    Screen: (props: React.ComponentProps<typeof actual.Screen>) =>
      React.createElement(actual.Screen, { ...props, scroll: 'content' }),
  };
});
jest.mock('@/lib/hooks/use-route-workspace', () => ({ useRouteWorkspace: jest.fn() }));
jest.mock('@/lib/realtime/socket', () => ({ acquireSocket: jest.fn(), releaseSocket: jest.fn() }));
jest.mock('@/lib/realtime/use-live-updates', () => ({ useWorkspaceLive: jest.fn() }));
let mockViewId: string | undefined;
const mockSetParams = jest.fn();
// The cells read people, files and rows through the API client.
jest.mock('@/lib/hooks/use-view-data', () => ({
  useViewCalculations: () => ({ data: undefined }),
  useViewChart: () => ({ data: undefined, isLoading: false }),
}));
// A row's peek holds the page editor: these views only open it.
jest.mock('../row-peek', () => ({ RowPeek: () => null }));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/hooks/use-forms', () => ({
  useFormLink: jest.fn(),
  useChangeFormLink: jest.fn(),
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'db', v: mockViewId }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), setParams: mockSetParams }),
}));
jest.mock('@/lib/hooks/use-databases', () => ({
  useDatabase: () => ({
    data: {
      database: mockDatabase(),
      views: [mockView(), { ...mockView(), id: 'second', name: 'Second', isDefault: false }],
      role: mockRole,
    },
    isLoading: false,
    isError: false,
  }),
  useUpdateDatabase: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/lib/hooks/use-database-rows', () => ({
  useDatabaseRows: () => ({ data: { rows: mockRows(), total: 1 }, isLoading: false }),
  useCreateRow: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useUpdateRow: () => ({ mutate: jest.fn() }),
  useRelatedRowSets: () => new Map(),
}));
jest.mock('@/lib/hooks/use-database-properties', () => ({
  useReorderProperties: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('../database-chrome', () => ({ DatabaseChromePickers: () => null }));
jest.mock('@/lib/hooks/use-database-views', () => ({
  useDatabaseViews: () => ({ data: undefined }),
  useCreateView: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteView: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateView: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/hooks/use-row-templates', () => ({
  useRowTemplates: () => ({ data: { templates: [] } }),
  useCreateRowTemplate: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('../database-actions-menu', () => ({ DatabaseActionsMenu: jest.fn(() => null) }));
jest.mock('../property-config-modal', () => ({
  AddPropertyButton: () => null,
  PropertyHeaderMenu: () => null,
}));
jest.mock('../filter-builder', () => ({ FilterBuilder: () => null }));
jest.mock('../sort-builder', () => ({ SortBuilder: () => null }));

function mockDatabase(): Database {
  return {
    id: 'db',
    teamspaceId: null,
    workspaceId: 'workspace',
    name: 'Projects',
    icon: null,
    cover: null,
    ownerId: 'owner',
    isInline: false,
    parentPageId: null,
    archived: false,
    locked: false,
    systemKey: null,
    createdAt: '',
    updatedAt: '',
    schema: {
      properties: [
        { id: 'name', name: 'Name', type: 'text' },
        { id: 'notes', name: 'Notes', type: 'text' },
      ],
    },
  };
}
function mockView(): DatabaseView {
  return {
    id: 'view',
    databaseId: 'db',
    name: 'Table',
    type: 'table',
    isDefault: true,
    filters: { kind: 'group', combinator: 'and', filters: [] },
    sorts: [],
    groupBy: null,
    hiddenProperties: [],
    frozenProperties: [],
    pageSize: 50,
    config: {},
    order: 0,
    createdAt: '',
    updatedAt: '',
  };
}
function mockRows(): DatabaseRow[] {
  return [
    {
      id: 'row',
      workspaceId: 'workspace',
      parentId: null,
      databaseId: 'db',
      title: 'A project',
      icon: null,
      cover: null,
      ownerId: 'owner',
      archived: false,
      order: 0,
      properties: { notes: { text: 'kept' } },
      createdAt: '',
      updatedAt: '',
    },
  ];
}

let renderer: ReactTestRenderer;
let client: QueryClient;
const originalOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  mockViewId = undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  Platform.OS = 'web';
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
  Platform.OS = originalOS;
});

function render(role: WorkspaceRole) {
  mockRole = role;
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <QueryClientProvider client={client}>
          <DatabaseRoute />
        </QueryClientProvider>
      </BloomTestProviders>,
    );
  });
}
const newView = () =>
  renderer.root.findAll(
    (node) =>
      node.props.children === 'databases.views.new' && typeof node.props.onPress === 'function',
  );
const title = () => renderer.root.findAllByType(TextInput)[0];

it('opens the view named by a shared URL and writes tab choices to the URL', () => {
  mockViewId = 'second';
  render('viewer');
  expect(renderer.root.findByType(DatabaseViewContainer).props.view.id).toBe('second');
  act(() => renderer.root.findByType(DatabaseHeader).props.onSelectView('view'));
  expect(mockSetParams).toHaveBeenCalledWith({ v: 'view' });
});

it('falls back to the default when a linked view has been removed', () => {
  mockViewId = 'removed';
  render('viewer');
  expect(renderer.root.findByType(DatabaseViewContainer).props.view.id).toBe('view');
});

it.each<WorkspaceRole>(['viewer', 'commenter'])(
  'a %s of the database reads it without a way to change it',
  (role) => {
    render(role);
    expect(title()?.props.editable).toBe(false);
    expect(newView()).toHaveLength(0);
    expect(
      renderer.root.findAll((node) =>
        String(node.props.accessibilityLabel ?? '').startsWith('databases.views.settings'),
      ),
    ).toHaveLength(0);
    expect(jest.mocked(DatabaseActionsMenu).mock.calls[0]?.[0]).toMatchObject({ readOnly: true });
    const cells = renderer.root.findAllByType(PropertyCell);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((cell) => cell.props.readOnly)).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('A project');
  },
);

it('an editor edits the title, the views and the cells', () => {
  render('editor');
  expect(title()?.props.editable).toBe(true);
  expect(newView().length).toBeGreaterThan(0);
  expect(jest.mocked(DatabaseActionsMenu).mock.calls[0]?.[0]).toMatchObject({ readOnly: false });
  expect(renderer.root.findAllByType(PropertyCell).some((cell) => !cell.props.readOnly)).toBe(true);
});
