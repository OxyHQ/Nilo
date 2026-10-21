import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { PropertyCell } from '../property-cell';
import { ViewBoard } from '../view-board';
import { ProjectBoard, type ControlledProjectBoardProps } from '@oxy.so/bloom/project-board';
import { Text } from '@oxy.so/bloom/typography';
import type { Database, DatabaseRow, DatabaseView } from '@/lib/types/databases';

// The cells read people, files and rows through the API client and Oxy's session.
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: false, oxyServices: {} }),
}));
// A view's groups are saved with it (collapsed, moved, hidden).
const mockUpdateView = jest.fn();
jest.mock('@/lib/hooks/use-database-views', () => ({
  useUpdateView: () => ({ mutate: mockUpdateView, isPending: false }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
const mockUpdateRow = jest.fn();
jest.mock('@/lib/hooks/use-member-profiles', () => ({
  profileName: () => null,
  useMemberProfiles: () => ({ data: [] }),
}));
jest.mock('@/lib/hooks/use-database-rows', () => ({
  useCreateRow: () => ({ mutate: jest.fn(), mutateAsync: jest.fn() }),
  useUpdateRow: () => ({ mutate: mockUpdateRow }),
  useRelatedRows: () => ({}),
}));

const database = {
  id: 'db',
  workspaceId: 'workspace',
  systemKey: null,
  schema: {
    properties: [
      { id: 'name', name: 'Name', type: 'text' },
      {
        id: 'stage',
        name: 'Stage',
        type: 'status',
        config: { options: [{ id: 'todo', name: 'To do', color: 'gray' }] },
      },
      { id: 'secret', name: 'Secret', type: 'text' },
      { id: 'notes', name: 'Notes', type: 'text' },
      { id: 'points', name: 'Points', type: 'number' },
      { id: 'total', name: 'Total', type: 'rollup' },
    ],
  },
} as Database;
const view = {
  id: 'view',
  type: 'board',
  groupBy: { propertyId: 'stage' },
  hiddenProperties: ['secret'],
  config: {},
} as DatabaseView;
const rows = [
  { id: 'row', title: 'Card', properties: { stage: { optionId: 'todo' } } },
] as unknown as DatabaseRow[];

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));

function render(
  props: {
    hasMore?: boolean;
    onLoadMore?: () => void;
    viewEditable?: boolean;
    readOnly?: boolean;
  } = {},
  on: { database: Database; view: DatabaseView } = { database, view },
) {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <ViewBoard database={on.database} view={on.view} rows={rows} isLoading={false} {...props} />
      </BloomTestProviders>,
    );
  });
}
/** The board's columns, by the name of the option each shows. */
const columns = () => {
  const board = renderer.root.findByType(ProjectBoard)
    .props as ControlledProjectBoardProps<DatabaseRow>;
  return board.columns.map((column) => ({
    option: { name: column.title },
    onMoveTo: (id: string) =>
      board.onMove?.({ itemId: id, fromColumnId: 'unchecked', toColumnId: column.id }),
  }));
};

it('shows on a card only the properties the view does not hide', () => {
  render();
  const shown = renderer.root.findAllByType(PropertyCell).map((cell) => cell.props.property.id);
  expect(shown).toEqual(['stage', 'notes', 'points', 'total']);
});

it('saves a card property through the row mutation', () => {
  render();
  const status = renderer.root
    .findAllByType(PropertyCell)
    .find((cell) => cell.props.property.id === 'stage');
  act(() => status?.props.onChange({ optionId: null }));
  expect(mockUpdateRow).toHaveBeenCalledWith(
    {
      databaseId: 'db',
      rowId: 'row',
      properties: { stage: { optionId: null } },
    },
    expect.objectContaining({ onError: expect.any(Function) }),
  );
});

it('restores the column order and lets view editors persist a new order', () => {
  const ordered = {
    ...view,
    config: { boardColumnOrder: { propertyId: 'stage', columnIds: ['__unassigned__', 'todo'] } },
  };
  render({ viewEditable: true }, { database, view: ordered });
  const board = renderer.root.findByType(ProjectBoard)
    .props as ControlledProjectBoardProps<DatabaseRow>;
  expect(board.columns.map((column) => column.id)).toEqual(['__unassigned__', 'todo']);
  act(() => board.onColumnOrderChange?.(['todo', '__unassigned__']));
  expect(mockUpdateView).toHaveBeenCalledWith(
    {
      databaseId: 'db',
      viewId: 'view',
      config: { boardColumnOrder: { propertyId: 'stage', columnIds: ['todo', '__unassigned__'] } },
    },
    expect.objectContaining({ onError: expect.any(Function) }),
  );
  render({ viewEditable: true, readOnly: true }, { database, view: ordered });
  expect(renderer.root.findByType(ProjectBoard).props.onColumnOrderChange).toBeUndefined();
  render(
    {},
    {
      database,
      view: {
        ...view,
        config: {
          boardColumnOrder: { propertyId: 'other', columnIds: ['__unassigned__', 'todo'] },
        },
      },
    },
  );
  expect(
    renderer.root.findByType(ProjectBoard).props.columns.map((column: { id: string }) => column.id),
  ).toEqual(['todo', '__unassigned__']);
});

it('offers the next rows while the board has not read them all', () => {
  const onLoadMore = jest.fn();
  render({ hasMore: true, onLoadMore });
  const more = renderer.root.findAll(
    (node) => node.props.children === 'databases.board.loadMore' && node.props.onPress,
  )[0];
  act(() => more?.props.onPress());
  expect(onLoadMore).toHaveBeenCalled();
  render({ hasMore: false, onLoadMore });
  expect(renderer.root.findAllByType(Text).map((node) => node.props.children)).not.toContain(
    'databases.board.loadMore',
  );
});

it('shows a status’s options under their groups, in the groups’ order', () => {
  const grouped = {
    ...database,
    schema: {
      properties: [
        {
          id: 'stage',
          name: 'Stage',
          type: 'status',
          config: {
            options: [
              { id: 'done', name: 'Done', color: 'green' },
              { id: 'todo', name: 'To do', color: 'gray' },
              { id: 'doing', name: 'Doing', color: 'blue' },
            ],
            groups: [
              { id: 'todo', optionIds: ['todo'] },
              { id: 'in_progress', optionIds: ['doing'] },
              { id: 'complete', optionIds: ['done'] },
            ],
          },
        },
      ],
    },
  } as Database;
  render({}, { database: grouped, view });
  expect(columns().map((c) => c.option.name)).toEqual([
    'To do',
    'Doing',
    'Done',
    'databases.board.noStatus',
  ]);
  const board = renderer.root.findByType(ProjectBoard)
    .props as ControlledProjectBoardProps<DatabaseRow>;
  // Native panel headers render through their screen's outlet. Exercise the
  // supplied header slots directly, independently of screen layout in Jest.
  const labels = board.columns.flatMap((column) => {
    let header!: ReactTestRenderer;
    act(() => {
      header = create(
        <BloomTestProviders>
          {board.renderColumnHeader?.(column, { isDropTarget: false })}
        </BloomTestProviders>,
      );
    });
    const text = header.root
      .findAll((node) => typeof node.props.children === 'string')
      .map((node) => node.props.children);
    act(() => header.unmount());
    return text;
  });
  const at = (text: string) => labels.indexOf(text);
  expect(at('databases.statusGroups.todo')).toBeGreaterThan(-1);
  expect(at('databases.statusGroups.todo')).toBeLessThan(at('databases.statusGroups.in_progress'));
  expect(at('databases.statusGroups.in_progress')).toBeLessThan(
    at('databases.statusGroups.complete'),
  );
});

it('groups by a checkbox, a card moved across checking or unchecking it', () => {
  const checkbox = {
    ...database,
    schema: { properties: [{ id: 'done', name: 'Done', type: 'checkbox' }] },
  } as Database;
  render({}, { database: checkbox, view: { ...view, groupBy: { propertyId: 'done' } } });
  const [checked, unchecked] = columns();
  expect([checked?.option.name, unchecked?.option.name]).toEqual([
    'databases.board.checked',
    'databases.board.unchecked',
  ]);
  act(() => checked?.onMoveTo('row'));
  expect(mockUpdateRow).toHaveBeenCalledWith(
    {
      databaseId: 'db',
      rowId: 'row',
      properties: { done: { checked: true } },
    },
    expect.objectContaining({ onError: expect.any(Function) }),
  );
});
