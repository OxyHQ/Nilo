import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { PropertyCell } from '../property-cell';
import { ViewBoard } from '../view-board';
import type { Database, DatabaseRow, DatabaseView } from '@/lib/types/databases';

// The cells read people, files and rows through the API client and Oxy's session.
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: false, oxyServices: {} }),
}));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
// A view's groups are saved with it (collapsed, moved, hidden).
jest.mock('@/lib/hooks/use-database-views', () => ({
  useUpdateView: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
const mockUpdateRow = jest.fn();
jest.mock('@/lib/hooks/use-database-rows', () => ({
  useCreateRow: () => ({ mutateAsync: jest.fn() }),
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
    ],
  },
} as Database;
const view = {
  id: 'view',
  type: 'board',
  groupBy: { propertyId: 'stage' },
  hiddenProperties: ['secret'],
} as DatabaseView;
const rows = [
  { id: 'row', title: 'Card', properties: { stage: { optionId: 'todo' } } },
] as unknown as DatabaseRow[];

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));

function render(
  props: { hasMore?: boolean; onLoadMore?: () => void } = {},
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
const columns = () =>
  renderer.root
    .findAll((node) => typeof node.props.onMoveTo === 'function' && node.props.option)
    .map((node) => node.props as { option: { name: string }; onMoveTo: (id: string) => void })
    .filter((props, i, all) => all.findIndex((p) => p.option === props.option) === i);

it('shows on a card only the properties the view does not hide', () => {
  render();
  const shown = renderer.root.findAllByType(PropertyCell).map((cell) => cell.props.property.id);
  expect(shown).toEqual(['stage', 'notes', 'points']);
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
  expect(JSON.stringify(renderer.toJSON())).not.toContain('databases.board.loadMore');
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
  const json = JSON.stringify(renderer.toJSON());
  const at = (text: string) => json.indexOf(text);
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
  expect(mockUpdateRow).toHaveBeenCalledWith({
    databaseId: 'db',
    rowId: 'row',
    properties: { done: { checked: true } },
  });
});
