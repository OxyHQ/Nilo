import { Platform } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { useVisibleDatesStore } from '@/lib/stores/visible-dates-store';
import { rowSpan, ViewTimeline } from '../view-timeline';
import { groupRowsByDay, ViewCalendar } from '../view-calendar';
import { ViewBoard } from '../view-board';
import { ViewList } from '../view-list';
import type { Database, DatabaseRow, DatabaseView, FilterGroup } from '@/lib/types/databases';

const mockPush = jest.fn();
const mockMutate = jest.fn();
const mockOxyServices = { session: { userId: 'test-user' } };
const mockRuntime = {
  subscribe: () => () => undefined,
  getAccountSessionRevision: () => 0,
  getAccountSessionIdentity: () => ({ accountId: 'test-user', sessionId: null, revision: 0 }),
};
let mockWidth = 390;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 844, scale: 2, fontScale: 1 }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  ownsApiTransport: () => true,
}));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({
    isAuthenticated: false,
    user: { id: 'test-user' },
    oxyServices: mockOxyServices,
  }),
}));
jest.mock('@oxy.so/services/runtime', () => ({ useOxyRuntime: () => mockRuntime }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
// A view's groups are saved with it (collapsed, moved, hidden).
jest.mock('@/lib/hooks/use-database-views', () => ({
  useUpdateView: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/hooks/use-member-profiles', () => ({
  profileName: () => null,
  useMemberProfiles: () => ({ data: [] }),
}));
jest.mock('@/lib/hooks/use-database-rows', () => ({
  useCreateRow: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useUpdateRow: () => ({ mutate: mockMutate }),
  useRelatedRows: () => ({}),
}));

const database = {
  id: 'db',
  workspaceId: 'workspace',
  systemKey: null,
  schema: {
    properties: [
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'due', name: 'Due', type: 'date' },
      {
        id: 'stage',
        name: 'Stage',
        type: 'status',
        config: {
          options: [
            { id: 'todo', name: 'To do', color: 'gray' },
            { id: 'done', name: 'Done', color: 'green' },
          ],
        },
      },
    ],
  },
} as Database;
const row = (id: string, properties: DatabaseRow['properties']) =>
  ({ id, title: `Row ${id}`, properties }) as unknown as DatabaseRow;
const day = (d: number) => new Date(Date.UTC(2026, 9, d)).toISOString();
const rows = [
  row('a', { due: { start: day(20) }, stage: { optionId: 'todo' } }),
  row('b', { due: { start: day(20), end: day(23) } }),
  row('c', { due: { start: day(22) } }),
];

let renderer: ReactTestRenderer;
const originalOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  mockWidth = 390;
  useVisibleDatesStore.setState({ byView: {} });
  jest.useFakeTimers({ now: new Date(2026, 9, 19, 12) });
});
afterEach(() => {
  act(() => renderer?.unmount());
  Platform.OS = originalOS;
  jest.useRealTimers();
});

function render(element: React.ReactElement) {
  act(() => {
    renderer = create(<BloomTestProviders>{element}</BloomTestProviders>);
  });
}
function pressable(label: string) {
  const found = renderer.root.findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function',
  )[0];
  if (!found) throw new Error(`nothing pressable named ${label}`);
  return found;
}
const text = () => JSON.stringify(renderer.toJSON());
const opened = (pageId: string) =>
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/p/[pageId]', params: { pageId } });

describe('calendar on native', () => {
  const view = { id: 'view', type: 'calendar', config: { datePropertyId: 'due' } } as DatabaseView;

  it('marks each day’s rows, lists the day picked and opens a row', () => {
    render(<ViewCalendar database={database} view={view} rows={rows} isLoading={false} />);
    expect(text()).not.toContain('webOnly');
    // It reads only the rows of the weeks it shows, as on web.
    expect((useVisibleDatesStore.getState().byView.view as FilterGroup).filters).toHaveLength(2);
    // Today (19 October) has none; the 20th has two.
    expect(text()).toContain('databases.calendar.noRows');
    const twentieth = renderer.root.findAll(
      (node) =>
        typeof node.props.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.endsWith('databases.calendar.rowCount') &&
        typeof node.props.onPress === 'function',
    )[0];
    act(() => twentieth?.props.onPress());
    expect(text()).toContain('Row a');
    expect(text()).toContain('Row b');
    expect(text()).not.toContain('Row c');
    act(() => pressable('Row b').props.onPress());
    opened('b');
  });

  it('lists titles in the day cells where there is room', () => {
    mockWidth = 1024;
    render(<ViewCalendar database={database} view={view} rows={rows} isLoading={false} />);
    act(() => pressable('Row c').props.onPress());
    opened('c');
  });

  it('places a dated row on the day it names, and a timed one on its local day', () => {
    const local = new Date(2026, 9, 21, 23, 30).toISOString();
    const byDay = groupRowsByDay(
      [
        row('x', { due: { start: day(20) } }),
        row('y', { due: { start: local, includeTime: true } }),
      ],
      'due',
    );
    expect(byDay.get('2026-10-20')?.map((r) => r.id)).toEqual(['x']);
    expect(byDay.get('2026-10-21')?.map((r) => r.id)).toEqual(['y']);
  });
});

describe('timeline on native', () => {
  const view = {
    id: 'view',
    type: 'timeline',
    config: { startPropertyId: 'due' },
  } as DatabaseView;

  it('draws a bar per row, moves its window and opens a row', () => {
    render(<ViewTimeline database={database} view={view} rows={rows} isLoading={false} />);
    expect(text()).not.toContain('webOnly');
    const first = JSON.stringify(useVisibleDatesStore.getState().byView.view);
    act(() => pressable('Row b').props.onPress());
    opened('b');
    act(() => pressable('databases.timeline.later').props.onPress());
    // The rows read follow the window.
    expect(JSON.stringify(useVisibleDatesStore.getState().byView.view)).not.toBe(first);
    expect(text()).toContain('databases.timeline.noRows');
  });

  it('spans a bar to the end property, else to the date’s own end', () => {
    const spanOf = (r: DatabaseRow, end: string | null) => {
      const span = rowSpan(r, 'due', end);
      return span && [span.start.getDate(), span.end.getDate()];
    };
    expect(spanOf(rows[1] as DatabaseRow, null)).toEqual([20, 23]);
    expect(
      spanOf(row('d', { due: { start: day(20) }, until: { start: day(25) } }), 'until'),
    ).toEqual([20, 25]);
    expect(spanOf(row('e', {}), null)).toBeNull();
  });
});

describe('board on native', () => {
  const view = {
    id: 'view',
    type: 'board',
    groupBy: { propertyId: 'stage' },
    hiddenProperties: [],
    config: {},
  } as unknown as DatabaseView;

  it('moves a card to another column through its accessible move button', () => {
    render(<ViewBoard database={database} view={view} rows={rows} isLoading={false} />);
    act(() => pressable('databases.board.moveCard').props.onPress());
    act(() => pressable('Done').props.onPress());
    expect(mockMutate).toHaveBeenCalledWith(
      {
        databaseId: 'db',
        rowId: 'a',
        properties: { stage: { optionId: 'done' } },
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );

    const card = pressable('Row b');
    const moveButton = card.findAll(
      (node) =>
        node.props.accessibilityLabel === 'databases.board.moveCard' &&
        typeof node.props.onPress === 'function',
    )[0];
    act(() => moveButton?.props.onPress());
    const none = pressable('databases.board.noStatus');
    // Where the card is now is checked.
    expect(none.props.selected).toBe(true);
    act(() => pressable('Row b').props.onPress());
    opened('b');
  });

  it('offers no move to a reader', () => {
    render(<ViewBoard database={database} view={view} rows={rows} isLoading={false} readOnly />);
    expect(
      renderer.root.findAll((n) => n.props.accessibilityLabel === 'databases.board.moveCard'),
    ).toHaveLength(0);
  });
});

it('a list opens its row as a page on native', () => {
  render(
    <ViewList
      database={database}
      view={{ id: 'view', type: 'list', hiddenProperties: [] } as unknown as DatabaseView}
      rows={rows}
      isLoading={false}
    />,
  );
  act(() => pressable('Row c').props.onPress());
  opened('c');
});
