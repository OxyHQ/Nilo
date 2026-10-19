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
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/hooks/use-database-rows', () => ({
  useCreateRow: () => ({ mutateAsync: jest.fn() }),
  useUpdateRow: () => ({ mutate: jest.fn() }),
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

function render(props: { hasMore?: boolean; onLoadMore?: () => void } = {}) {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <ViewBoard database={database} view={view} rows={rows} isLoading={false} {...props} />
      </BloomTestProviders>,
    );
  });
}

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
