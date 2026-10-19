import type React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Linking, Platform } from 'react-native';
import { Path } from 'react-native-svg';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { DatabaseViewContainer } from '../database-view';
import { PropertyCell } from '../property-cell';
import { DatabaseCellScopeProvider } from '../cell-scope';
import { ViewChart } from '../view-chart';
import { ColumnResizeHandle } from '../column-resize-handle';
import type { Database, DatabaseRow, DatabaseView, RowGroup } from '@/lib/types/databases';

const mockPeek = jest.fn((_props: { rowId: string; mode: string; open: boolean }) => null);
const mockPush = jest.fn();
const mockUpdateView = jest.fn();
const mockUpdateRowAsync = jest.fn(async () => undefined);
const mockCreateRowAsync = jest.fn(async () => undefined);
const mockHeaderMenu = jest.fn((_props: { move?: { onMove: (by: -1 | 1) => void } }) => null);
let mockCalculations: Record<string, { function: string; value: number | null }> = {};
let mockPoints: { key: string | null; count: number; value: number | null }[] = [];

jest.mock('../row-peek', () => ({
  RowPeek: (props: { rowId: string; mode: string; open: boolean }) => mockPeek(props),
}));
jest.mock('@/lib/hooks/use-view-data', () => ({
  useViewCalculations: () => ({ data: { calculations: mockCalculations } }),
  useViewChart: () => ({ data: { points: mockPoints }, isLoading: false, isError: false }),
}));
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
jest.mock('@/lib/hooks/use-database-views', () => ({
  useUpdateView: () => ({ mutate: mockUpdateView, isPending: false }),
}));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && Object.keys(options).length > 0 ? `${key}:${JSON.stringify(options)}` : key,
    locale: 'en-US',
  }),
}));
jest.mock('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({ colors: {}, isDarkColorScheme: false }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/hooks/use-database-rows', () => ({
  useCreateRow: () => ({
    mutate: jest.fn(),
    mutateAsync: mockCreateRowAsync,
    isPending: false,
  }),
  useUpdateRow: () => ({ mutate: jest.fn(), mutateAsync: mockUpdateRowAsync }),
}));
jest.mock('../property-config-modal', () => ({
  AddPropertyButton: () => null,
  PropertyHeaderMenu: (props: { move?: { onMove: (by: -1 | 1) => void } }) => mockHeaderMenu(props),
}));
jest.mock('../filter-builder', () => ({ FilterBuilder: () => null }));
jest.mock('../sort-builder', () => ({ SortBuilder: () => null }));
jest.mock('../person-cell', () => ({ PersonChips: () => null, PersonCell: () => null }));

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
  systemKey: null,
  createdAt: '',
  updatedAt: '',
  schema: {
    properties: [
      { id: 'name', name: 'Name', type: 'text' },
      {
        id: 'stage',
        name: 'Stage',
        type: 'select',
        config: {
          options: [
            { id: 'todo', name: 'To do', color: 'gray' },
            { id: 'done', name: 'Done', color: 'green' },
          ],
        },
      },
      { id: 'checked', name: 'Checked', type: 'checkbox' },
      { id: 'points', name: 'Points', type: 'number' },
    ],
  },
};
const baseView: DatabaseView = {
  id: 'view',
  databaseId: 'db',
  name: 'View',
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
const row = (id: string, properties: DatabaseRow['properties'], groupKey?: string | null) =>
  ({
    id,
    workspaceId: 'workspace',
    parentId: null,
    databaseId: 'db',
    title: `Row ${id}`,
    icon: null,
    cover: null,
    ownerId: 'owner',
    archived: false,
    order: 0,
    properties,
    createdAt: '',
    updatedAt: '',
    ...(groupKey !== undefined && { groupKey }),
  }) as DatabaseRow;

let renderer: ReactTestRenderer;
const originalOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  mockCalculations = {};
  mockPoints = [];
});
afterEach(() => {
  act(() => renderer?.unmount());
  Platform.OS = originalOS;
});

function render(node: React.ReactNode) {
  act(() => {
    renderer = create(<BloomTestProviders>{node}</BloomTestProviders>);
  });
}
const text = () => JSON.stringify(renderer.toJSON());
const pressLink = (label: string) => {
  const link = renderer.root.find(
    (n) =>
      n.props.accessibilityRole === 'link' &&
      n.props.accessibilityLabel === label &&
      n.props.onPress,
  );
  act(() => link.props.onPress());
};

describe('opening a row', () => {
  const rows = [row('1', {})];
  it('opens it in a side peek by default, a centre peek, or as its page, as the view says', () => {
    render(
      <DatabaseViewContainer
        database={database}
        view={{ ...baseView, type: 'list' }}
        rows={rows}
        isLoading={false}
      />,
    );
    expect(mockPeek).not.toHaveBeenCalled();
    pressLink('Row 1');
    expect(mockPeek).toHaveBeenLastCalledWith({
      rowId: '1',
      open: true,
      mode: 'side',
      onClose: expect.any(Function),
      onOpenFullPage: expect.any(Function),
    });
    // "Open as full page" goes to the row's page.
    act(
      () =>
        mockPeek.mock.lastCall?.[0] &&
        (mockPeek.mock.lastCall[0] as unknown as { onOpenFullPage: () => void }).onOpenFullPage(),
    );
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/p/[pageId]', params: { pageId: '1' } });
    act(() => renderer.unmount());

    render(
      <DatabaseViewContainer
        database={database}
        view={{ ...baseView, type: 'list', config: { openIn: 'center_peek' } }}
        rows={rows}
        isLoading={false}
      />,
    );
    pressLink('Row 1');
    expect(mockPeek).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'center' }));
    act(() => renderer.unmount());

    mockPeek.mockClear();
    mockPush.mockClear();
    render(
      <DatabaseViewContainer
        database={database}
        view={{ ...baseView, type: 'table', config: { openIn: 'full_page' } }}
        rows={rows}
        isLoading={false}
      />,
    );
    pressLink('Row 1');
    expect(mockPeek).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/p/[pageId]', params: { pageId: '1' } });
  });
});

describe('a grouped table', () => {
  const groups: RowGroup[] = [
    { key: 'todo', count: 1 },
    { key: 'done', count: 2 },
    { key: null, count: 0 },
  ];
  const rows = [
    row('1', { stage: { optionId: 'todo' } }, 'todo'),
    row('2', { stage: { optionId: 'done' } }, 'done'),
    row('3', { stage: { optionId: 'done' } }, 'done'),
  ];
  const view = { ...baseView, groupBy: { propertyId: 'stage' } };

  it('shows each group with its count, collapses one, and hides the empty ones on request', () => {
    render(
      <DatabaseViewContainer
        database={database}
        view={view}
        rows={rows}
        groups={groups}
        hasMore={false}
        isLoading={false}
      />,
    );
    const sections = () =>
      renderer.root.findAll(
        (n) =>
          typeof n.props.testID === 'string' &&
          n.props.testID.startsWith('table-group-') &&
          typeof n.type === 'string',
      );
    expect(sections().map((n) => n.props.testID)).toEqual([
      'table-group-todo',
      'table-group-done',
      'table-group-none',
    ]);
    expect(text()).toContain('databases.groups.count:{\\"count\\":2}');
    const collapse = renderer.root.find(
      (n) =>
        n.props.accessibilityLabel === 'databases.groups.collapse:{"name":"Done"}' &&
        n.props.onPress,
    );
    act(() => collapse.props.onPress());
    expect(text()).not.toContain('Row 2');
    expect(text()).toContain('Row 1');
    act(() => renderer.unmount());

    render(
      <DatabaseViewContainer
        database={database}
        view={{ ...view, groupBy: { propertyId: 'stage', hideEmpty: true } }}
        rows={rows}
        groups={groups}
        hasMore={false}
        isLoading={false}
      />,
    );
    expect(sections().map((n) => n.props.testID)).toEqual(['table-group-todo', 'table-group-done']);
  });

  it('waits for the rows of the groups it has not reached', () => {
    render(
      <DatabaseViewContainer
        database={database}
        view={view}
        rows={rows.slice(0, 1)}
        groups={groups}
        hasMore
        isLoading={false}
      />,
    );
    expect(
      renderer.root
        .findAll(
          (n) =>
            typeof n.props.testID === 'string' &&
            n.props.testID.startsWith('table-group-') &&
            typeof n.type === 'string',
        )
        .map((n) => n.props.testID),
    ).toEqual(['table-group-todo']);
  });

  it('sub-groups a board into rows of its columns', () => {
    render(
      <DatabaseViewContainer
        database={database}
        view={{
          ...baseView,
          type: 'board',
          groupBy: { propertyId: 'stage' },
          subGroupBy: { propertyId: 'checked' },
        }}
        rows={[row('1', { checked: { checked: true } }, 'true'), row('2', {}, 'false')]}
        groups={[
          { key: 'true', count: 1 },
          { key: 'false', count: 1 },
        ]}
        hasMore={false}
        isLoading={false}
      />,
    );
    const lanes = renderer.root
      .findAll(
        (n) =>
          typeof n.props.testID === 'string' &&
          n.props.testID.startsWith('board-lane-') &&
          typeof n.type === 'string',
      )
      .map((n) => n.props.testID);
    expect(lanes).toEqual(['board-lane-true', 'board-lane-false']);
  });
});

describe('a table’s columns and footer', () => {
  it('moves a column in the view’s order and keeps a width dragged to', () => {
    Platform.OS = 'web';
    render(
      <DatabaseViewContainer
        database={database}
        view={baseView}
        rows={[row('1', {})]}
        isLoading={false}
      />,
    );
    // The menu of the first column ("Stage") moves it right, past "Checked".
    const stageMenu = mockHeaderMenu.mock.calls.find((call) => call[0].move)?.[0];
    act(() => stageMenu?.move?.onMove(1));
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: { propertyOrder: ['name', 'checked', 'stage', 'points'] },
      }),
      expect.anything(),
    );
    const handles = renderer.root.findAllByType(ColumnResizeHandle);
    expect(handles.length).toBe(4);
    act(() => handles[1]?.props.onCommit(150));
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({ config: { columnWidths: { stage: 150 } } }),
      expect.anything(),
    );
  });

  it('shows each column’s calculation over all the rows', () => {
    mockCalculations = {
      checked: { function: 'percent_checked', value: 50 },
      points: { function: 'sum', value: 1234.5 },
    };
    render(
      <DatabaseViewContainer
        database={database}
        view={{
          ...baseView,
          config: { calculations: { checked: 'percent_checked', points: 'sum' } },
        }}
        rows={[row('1', {})]}
        isLoading={false}
        readOnly
      />,
    );
    const footer = renderer.root
      .findAll((n) => n.props.testID === 'table-footer')[0]
      ?.findAll((n) => typeof n.props.children === 'string')
      .map((n) => n.props.children)
      .join(' ');
    expect(footer).toContain('50%');
    expect(footer).toContain('1234.50');
    expect(footer).toContain('databases.calculations.functions.sum');
  });
});

describe('a chart view', () => {
  const chartView = {
    ...baseView,
    type: 'chart' as const,
    config: { chart: { type: 'bar' as const, xAxis: { propertyId: 'stage' } } },
  };
  it('draws a bar per group, named for assistive tech, and lists every value', () => {
    mockPoints = [
      { key: 'todo', count: 1, value: 1 },
      { key: 'done', count: 3, value: 3 },
      { key: null, count: 0, value: 0 },
    ];
    render(<ViewChart database={database} view={chartView} />);
    const plot = renderer.root.find(
      (n) => n.props.accessibilityRole === 'image' && n.props.accessibilityLabel,
    );
    expect(plot.props.accessibilityLabel).toContain('To do 1');
    expect(plot.props.accessibilityLabel).toContain('Done 3');
    expect(
      renderer.root.findAll((n) => n.props.accessibilityLabel === 'Done, 3' && n.props.onPress)
        .length,
    ).toBeGreaterThan(0);
  });

  it('draws a donut of the groups that hold rows', () => {
    mockPoints = [
      { key: 'todo', count: 1, value: 1 },
      { key: 'done', count: 3, value: 3 },
      { key: null, count: 0, value: 0 },
    ];
    render(
      <ViewChart
        database={database}
        view={{ ...chartView, config: { chart: { ...chartView.config.chart, type: 'donut' } } }}
      />,
    );
    expect(renderer.root.findAllByType(Path)).toHaveLength(2);
    expect(text()).toContain('75%');
  });

  it('asks for an axis when it has none', () => {
    render(
      <ViewChart database={database} view={{ ...chartView, config: { chart: { type: 'bar' } } }} />,
    );
    expect(text()).toContain('databases.chart.needsAxis');
  });
});

describe('cells', () => {
  it('runs a button’s actions on its row', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    render(
      <DatabaseCellScopeProvider databaseId="db">
        <PropertyCell
          property={{
            id: 'go',
            name: 'Go',
            type: 'button',
            config: {
              actions: [
                { kind: 'set_property', propertyId: 'checked', value: { checked: true } },
                { kind: 'open_url', url: 'https://example.test' },
              ],
            },
          }}
          value={null}
          rowId="row-1"
          onChange={jest.fn()}
        />
      </DatabaseCellScopeProvider>,
    );
    const button = renderer.root.find(
      (n) => n.props.accessibilityLabel === 'Go' && n.props.onPress,
    );
    await act(async () => {
      button.props.onPress();
    });
    expect(mockUpdateRowAsync).toHaveBeenCalledWith({
      databaseId: 'db',
      rowId: 'row-1',
      properties: { checked: { checked: true } },
    });
    expect(open).toHaveBeenCalledWith('https://example.test');
  });

  it('shows a date in its property’s format', () => {
    render(
      <PropertyCell
        readOnly
        property={{ id: 'due', name: 'Due', type: 'date', config: { dateFormat: 'iso' } }}
        value={{ start: '2026-10-05T00:00:00.000Z' }}
        onChange={jest.fn()}
      />,
    );
    expect(text()).toContain('2026-10-05');
    act(() => renderer.unmount());
    render(
      <PropertyCell
        property={{ id: 'due', name: 'Due', type: 'date', config: { dateFormat: 'full' } }}
        value={{ start: '2026-10-05T00:00:00.000Z' }}
        onChange={jest.fn()}
      />,
    );
    expect(text()).toContain('October 5, 2026');
  });
});
