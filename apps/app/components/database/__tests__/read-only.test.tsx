import type React from 'react';
import { ProjectBoard, type ControlledProjectBoardProps } from '@oxy.so/bloom/project-board';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Platform } from 'react-native';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { DatabaseViewContainer } from '../database-view';
import { PropertyCell } from '../property-cell';
import type { Database, DatabaseRow, DatabaseView, DatabaseViewType } from '@/lib/types/databases';

const mockUpdateRow = jest.fn();

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
// Render only Nilo's card slots here: drag geometry is Bloom's responsibility.
// Assertions below check that Nilo sends readOnly and suppresses every write.
jest.mock('@oxy.so/bloom/project-board', () => {
  const React = jest.requireActual('react');
  const { Pressable } = jest.requireActual('react-native');
  return {
    ...jest.requireActual('@oxy.so/bloom/project-board'),
    ProjectBoard: (props: ControlledProjectBoardProps<DatabaseRow>) =>
      props.columns.map((column) =>
        column.items.map((row) =>
          React.createElement(
            React.Fragment,
            { key: `${column.id}:${row.id}` },
            props.renderCard(row, column, { isDragging: false }),
          ),
        ),
      ),
    BoardDragHandle: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) =>
      React.createElement(Pressable, { onPress }, children),
  };
});
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
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: false, oxyServices: {} }),
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/hooks/use-forms', () => ({
  useFormLink: jest.fn(),
  useChangeFormLink: jest.fn(),
}));
jest.mock('@/lib/hooks/use-row-templates', () => ({
  useRowTemplates: () => ({ data: { templates: [] } }),
  useCreateRowTemplate: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/hooks/use-database-views', () => ({ useUpdateView: jest.fn() }));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/hooks/use-member-profiles', () => ({
  profileName: () => null,
  useMemberProfiles: () => ({ data: [] }),
}));
jest.mock('@/lib/hooks/use-database-rows', () => ({
  useCreateRow: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useUpdateRow: () => ({ mutate: mockUpdateRow }),
  useRelatedRowSets: () => new Map(),
  useRelatedRows: () => ({}),
}));
jest.mock('../property-config-modal', () => ({
  AddPropertyButton: () => null,
  PropertyHeaderMenu: () => null,
}));
jest.mock('../filter-builder', () => ({ FilterBuilder: () => null }));
jest.mock('../sort-builder', () => ({ SortBuilder: () => null }));

const database: Database = {
  id: 'db',
  teamspaceId: null,
  workspaceId: 'workspace',
  name: 'Projects',
  icon: null,
  cover: null,
  ownerId: 'owner',
  isInline: true,
  parentPageId: 'parent',
  archived: false,
  locked: false,
  systemKey: null,
  createdAt: '',
  updatedAt: '',
  schema: {
    properties: [
      {
        id: 'status',
        name: 'Status',
        type: 'status',
        config: { options: [{ id: 'done', name: 'Done', color: 'green' }] },
      },
      { id: 'checked', name: 'Checked', type: 'checkbox' },
    ],
  },
};
const view: DatabaseView = {
  id: 'view',
  databaseId: 'db',
  name: 'Table',
  type: 'table',
  isDefault: true,
  filters: { kind: 'group', combinator: 'and', filters: [] },
  sorts: [],
  groupBy: { propertyId: 'status' },
  hiddenProperties: [],
  frozenProperties: [],
  pageSize: 50,
  config: {},
  order: 0,
  createdAt: '',
  updatedAt: '',
};
const rows: DatabaseRow[] = [
  {
    id: 'row',
    workspaceId: 'workspace',
    parentId: 'parent',
    databaseId: 'db',
    title: 'A project',
    icon: null,
    cover: null,
    ownerId: 'owner',
    archived: false,
    order: 0,
    properties: { status: { optionId: 'done' }, checked: { checked: true } },
    createdAt: '',
    updatedAt: '',
  },
];

/** Bloom's providers: closed menus still mount their native sheet. */
function Bloom({ children }: { children: React.ReactNode }) {
  return <BloomTestProviders>{children}</BloomTestProviders>;
}

let renderer: ReactTestRenderer;
const originalOS = Platform.OS;
beforeEach(() => {
  mockUpdateRow.mockClear();
  Platform.OS = 'web';
});
afterEach(() => {
  act(() => renderer?.unmount());
  Platform.OS = originalOS;
});

it.each<DatabaseViewType>(['table', 'board', 'gallery', 'list'])(
  '%s hides editing controls but retains rows in read-only mode',
  (type) => {
    act(() => {
      renderer = create(
        <Bloom>
          <DatabaseViewContainer
            database={database}
            view={{ ...view, type }}
            rows={rows}
            isLoading={false}
            readOnly
          />
        </Bloom>,
      );
    });
    if (type === 'board') {
      const board = renderer.root.findByType(ProjectBoard).props;
      expect(board.readOnly).toBe(true);
      expect(board.allowReorder).toBe(false);
      expect(board.onColumnOrderChange).toBeUndefined();
      act(() =>
        board.onMove({
          itemId: 'row',
          fromColumnId: 'done',
          toColumnId: '__unassigned__',
          toIndex: 0,
        }),
      );
      expect(mockUpdateRow).not.toHaveBeenCalled();
    }
    expect(renderer.root.findAllByType(PropertyCell).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByType(PropertyCell).every((cell) => cell.props.readOnly)).toBe(
      true,
    );
    expect(
      renderer.root
        .findAll((node) => Boolean(node.props.onPress))
        .filter((node) => node.props.accessibilityLabel === 'databases.actions.new'),
    ).toHaveLength(0);
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    expect(renderer.root.findAll((node) => node.props.draggable || node.props.onDrop)).toHaveLength(
      0,
    );
    expect(JSON.stringify(renderer.toJSON())).toContain('A project');
  },
);

it('keeps table editing and creation available to editors', () => {
  act(() => {
    renderer = create(
      <Bloom>
        <DatabaseViewContainer database={database} view={view} rows={rows} isLoading={false} />
      </Bloom>,
    );
  });
  expect(renderer.root.findAllByType('input').length).toBeGreaterThan(0);
  expect(
    renderer.root
      .findAll((node) => Boolean(node.props.onPress))
      .some((node) => node.props.accessibilityLabel === 'databases.actions.new'),
  ).toBe(true);
  const { PropertyHeaderMenu } = jest.requireMock('../property-config-modal');
  expect(renderer.root.findAllByType(PropertyHeaderMenu).length).toBeGreaterThan(0);
});

it('keeps the form builder and management requests unavailable in read-only mode', () => {
  act(() => {
    renderer = create(
      <Bloom>
        <DatabaseViewContainer
          database={database}
          view={{ ...view, type: 'form' }}
          rows={rows}
          isLoading={false}
          readOnly
        />
      </Bloom>,
    );
  });
  expect(JSON.stringify(renderer.toJSON())).toContain('databases.form.editorsOnly');
  expect(renderer.root.findAll((node) => Boolean(node.props.onPress))).toHaveLength(0);
});

it('keeps a locked database’s rows editable and its properties and views as they are', () => {
  const { FilterBuilder } = jest.requireMock('../filter-builder');
  const { AddPropertyButton, PropertyHeaderMenu } = jest.requireMock('../property-config-modal');
  act(() => {
    renderer = create(
      <Bloom>
        <DatabaseViewContainer
          database={{ ...database, locked: true }}
          view={view}
          rows={rows}
          isLoading={false}
        />
      </Bloom>,
    );
  });
  // Rows: still created and edited.
  expect(renderer.root.findAllByType('input').length).toBeGreaterThan(0);
  expect(
    renderer.root
      .findAll((node) => Boolean(node.props.onPress))
      .some((node) => node.props.accessibilityLabel === 'databases.actions.new'),
  ).toBe(true);
  // The view and the properties: no filter, sort, new property or column menu.
  expect(renderer.root.findAllByType(FilterBuilder)).toHaveLength(0);
  expect(renderer.root.findAllByType(AddPropertyButton)).toHaveLength(0);
  expect(renderer.root.findAllByType(PropertyHeaderMenu)).toHaveLength(0);
  // Searching it is the reader's own.
  expect(
    renderer.root.findAll(
      (node) => node.props.accessibilityLabel === 'databases.search.open' && node.props.onPress,
    ).length,
  ).toBeGreaterThan(0);
});
