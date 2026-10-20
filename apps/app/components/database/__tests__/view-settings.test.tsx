import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Animated, Platform } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Switch } from '@oxy.so/bloom/switch';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Tabs } from '@oxy.so/bloom/tabs';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { SettingSelect, ViewSettings } from '../view-settings';
import { DatabaseHeader, ViewTab } from '../database-header';
import { ViewTable } from '../view-table';
import { ViewSearch } from '../view-search';
import { ViewGallery } from '../view-gallery';
import { PropertyCell } from '../property-cell';
import { CoverDisplay } from '@/components/page-chrome/cover-display';
import { useViewSearchStore } from '@/lib/stores/view-search-store';
import type { Database, DatabaseView } from '@/lib/types/databases';

const mockUpdateView = jest.fn();
const mockUpdateRow = jest.fn();
const mockUpdateViewAsync = jest.fn();
const mockReorder = jest.fn();
let mockViews: DatabaseView[] = [];
// A group of people shows their profiles, which these tests do not read.
jest.mock('../person-cell', () => ({ PersonChips: () => null }));
jest.mock('@/lib/hooks/use-view-data', () => ({
  useViewCalculations: () => ({ data: undefined }),
  useViewChart: () => ({ data: undefined, isLoading: false }),
}));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
    locale: 'en',
  }),
}));
jest.mock('@/lib/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/hooks/use-database-views', () => ({
  useUpdateView: () => ({
    mutate: mockUpdateView,
    mutateAsync: mockUpdateViewAsync,
    isPending: false,
  }),
  useDeleteView: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useCreateView: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDatabaseViews: () => ({ data: undefined }),
}));
jest.mock('@/lib/hooks/use-database-properties', () => ({
  useReorderProperties: () => ({ mutate: mockReorder, isPending: false }),
}));
jest.mock('@/lib/hooks/use-databases', () => ({
  useDatabase: () => ({ data: { views: mockViews, role: 'editor' } }),
  useUpdateDatabase: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/hooks/use-database-rows', () => ({
  useCreateRow: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useUpdateRow: () => ({ mutate: mockUpdateRow }),
}));
jest.mock('../property-cell', () => ({ PropertyCell: () => null }));
jest.mock('../property-config-modal', () => ({ PropertyHeaderMenu: () => null }));
jest.mock('../database-actions-menu', () => ({ DatabaseActionsMenu: () => null }));
jest.mock('../database-chrome', () => ({ DatabaseChromePickers: () => null }));
// The header draws the database's cover and icon, which resolve uploaded files through the API.
jest.mock('@/components/page-chrome/cover-display', () => ({ CoverDisplay: () => null }));
jest.mock('@/components/page-chrome/icon-display', () => ({ IconDisplay: () => null }));

const database = {
  id: 'db',
  systemKey: null,
  locked: false,
  name: 'Tasks',
  icon: null,
  cover: null,
  schema: {
    properties: [
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'stage', name: 'Stage', type: 'status', config: { options: [] } },
      { id: 'kind', name: 'Kind', type: 'select', config: { options: [] } },
      { id: 'done', name: 'Done', type: 'checkbox' },
      { id: 'notes', name: 'Notes', type: 'text' },
      { id: 'due', name: 'Due', type: 'date' },
    ],
  },
} as unknown as Database;

function makeView(overrides: Partial<DatabaseView> = {}): DatabaseView {
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
    ...overrides,
  };
}

let renderer: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  mockViews = [];
});
afterEach(() => act(() => renderer?.unmount()));

function render(node: React.ReactNode) {
  act(() => {
    renderer = create(<BloomTestProviders>{node}</BloomTestProviders>);
  });
}
const text = () => JSON.stringify(renderer.toJSON());
const setting = (label: string) =>
  renderer.root.findAllByType(SettingSelect).find((s) => s.props.label === label);

describe('view settings', () => {
  it.each(['board', 'gallery'] as const)(
    'saves %s card size and preview without losing other settings',
    (type) => {
      render(
        <ViewSettings
          database={database}
          view={makeView({ type, config: { openIn: 'full_page' } })}
        />,
      );
      act(() => setting('databases.viewSettings.cardSize')?.props.onChange('large'));
      expect(mockUpdateView).toHaveBeenCalledWith(
        expect.objectContaining({ config: { openIn: 'full_page', cardSize: 'large' } }),
        expect.anything(),
      );
      act(() => setting('databases.viewSettings.cardPreview')?.props.onChange('pageCover'));
      expect(mockUpdateView).toHaveBeenCalledWith(
        expect.objectContaining({ config: { openIn: 'full_page', coverSource: 'pageCover' } }),
        expect.anything(),
      );
    },
  );

  it('groups a board by an option or checkbox property only', () => {
    render(<ViewSettings database={database} view={makeView({ type: 'board' })} />);
    const groupBy = setting('databases.viewSettings.groupBy');
    expect(groupBy?.props.options.map((o: { value: string }) => o.value)).toEqual([
      'stage',
      'kind',
      'done',
    ]);
    act(() => groupBy?.props.onChange('done'));
    expect(mockUpdateView).toHaveBeenCalledWith(
      expect.objectContaining({ viewId: 'view', groupBy: { propertyId: 'done' } }),
      expect.anything(),
    );
  });

  it('shows a hidden property again, and freezes a table up to a column', () => {
    render(
      <ViewSettings database={database} view={makeView({ hiddenProperties: ['notes', 'due'] })} />,
    );
    const notes = renderer.root
      .findAllByType(Switch)
      .find((s) => s.props.accessibilityLabel === 'databases.viewSettings.show:Notes');
    expect(renderer.root.findAllByType(Switch).map((s) => s.props.checked)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    act(() => notes?.props.onCheckedChange(true));
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({ hiddenProperties: ['due'] }),
      expect.anything(),
    );
    // Its columns as the table shows them: the Name, then the shown properties.
    const freeze = setting('databases.viewSettings.freezeUpTo');
    act(() => freeze?.props.onChange('kind'));
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({ frozenProperties: ['name', 'stage', 'kind'] }),
      expect.anything(),
    );
  });

  it('moves a property in the view’s own order, leaving the database’s as it is', () => {
    render(<ViewSettings database={database} view={makeView()} />);
    const down = renderer.root.findAll(
      (n) =>
        n.props.accessibilityLabel === 'databases.viewSettings.moveDown:Stage' && n.props.onPress,
    );
    act(() => down[0]?.props.onPress());
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: { propertyOrder: ['name', 'kind', 'stage', 'done', 'notes', 'due'] },
      }),
      expect.anything(),
    );
    expect(mockReorder).not.toHaveBeenCalled();
    act(() => renderer.unmount());
    // Listed as the view orders them, a property it does not name after the rest.
    render(
      <ViewSettings
        database={database}
        view={makeView({ config: { propertyOrder: ['due', 'name', 'notes'] } })}
      />,
    );
    const names = renderer.root
      .findAll(
        (n) =>
          typeof n.props.accessibilityLabel === 'string' &&
          n.props.accessibilityLabel.startsWith('databases.viewSettings.moveUp:') &&
          n.props.onPress,
      )
      .map((n) => String(n.props.accessibilityLabel).split(':')[1]);
    expect([...new Set(names)]).toEqual(['Due', 'Name', 'Notes', 'Stage', 'Kind', 'Done']);
  });

  it('groups a table by any property that groups, by month for a date, hiding empty groups', () => {
    render(<ViewSettings database={database} view={makeView()} />);
    const groupBy = setting('databases.viewSettings.groupBy');
    expect(groupBy?.props.options.map((o: { value: string }) => o.value)).toEqual([
      '__none__',
      'name',
      'stage',
      'kind',
      'done',
      'notes',
      'due',
    ]);
    act(() => groupBy?.props.onChange('due'));
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupBy: { propertyId: 'due' } }),
      expect.anything(),
    );
    act(() => renderer.unmount());
    render(
      <ViewSettings database={database} view={makeView({ groupBy: { propertyId: 'due' } })} />,
    );
    act(() => setting('databases.viewSettings.granularity')?.props.onChange('month'));
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupBy: { propertyId: 'due', granularity: 'month' } }),
      expect.anything(),
    );
    const hide = renderer.root
      .findAllByType(Switch)
      .find((s) => s.props.accessibilityLabel === 'databases.viewSettings.hideEmpty');
    act(() => hide?.props.onCheckedChange(true));
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupBy: { propertyId: 'due', hideEmpty: true } }),
      expect.anything(),
    );
  });

  it('sub-groups a board, opens rows where the view says, and sets a chart’s axes', () => {
    render(<ViewSettings database={database} view={makeView({ type: 'board' })} />);
    act(() => setting('databases.viewSettings.subGroupBy')?.props.onChange('done'));
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({ subGroupBy: { propertyId: 'done' } }),
      expect.anything(),
    );
    act(() => setting('databases.viewSettings.openIn')?.props.onChange('center_peek'));
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({ config: { openIn: 'center_peek' } }),
      expect.anything(),
    );
    act(() => renderer.unmount());
    render(
      <ViewSettings
        database={database}
        view={makeView({ type: 'chart', config: { chart: { type: 'bar' } } })}
      />,
    );
    expect(setting('databases.viewSettings.openIn')).toBeUndefined();
    act(() => setting('databases.viewSettings.chartType')?.props.onChange('donut'));
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({ config: { chart: { type: 'donut' } } }),
      expect.anything(),
    );
    act(() => setting('databases.viewSettings.xAxis')?.props.onChange('stage'));
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: { chart: { type: 'bar', xAxis: { propertyId: 'stage' } } },
      }),
      expect.anything(),
    );
  });

  it('dates a calendar and a timeline, and loads a chosen number of rows', () => {
    render(<ViewSettings database={database} view={makeView({ type: 'timeline' })} />);
    act(() => setting('databases.viewSettings.end')?.props.onChange('due'));
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({ config: { endPropertyId: 'due' } }),
      expect.anything(),
    );
    expect(setting('databases.viewSettings.loadLimit')).toBeUndefined();
    act(() => renderer.unmount());
    render(<ViewSettings database={database} view={makeView({ type: 'list' })} />);
    act(() => setting('databases.viewSettings.loadLimit')?.props.onChange('25'));
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageSize: 25 }),
      expect.anything(),
    );
  });

  it('groups a gallery and a timeline, but not a calendar', () => {
    for (const type of ['gallery', 'timeline'] as const) {
      render(<ViewSettings database={database} view={makeView({ type })} />);
      act(() => setting('databases.viewSettings.groupBy')?.props.onChange('kind'));
      expect(mockUpdateView).toHaveBeenLastCalledWith(
        expect.objectContaining({ groupBy: { propertyId: 'kind' } }),
        expect.anything(),
      );
      act(() => renderer.unmount());
    }
    render(<ViewSettings database={database} view={makeView({ type: 'calendar' })} />);
    expect(setting('databases.viewSettings.groupBy')).toBeUndefined();
  });

  it('sets a number’s ranges, shows a hidden group again, and forgets the old groups when regrouped', () => {
    const numbers = {
      ...database,
      schema: {
        properties: [
          ...database.schema.properties,
          { id: 'points', name: 'Points', type: 'number' },
          { id: 'double', name: 'Double', type: 'formula', config: { expression: '1' } },
        ],
      },
    } as Database;
    const grouped = makeView({
      groupBy: { propertyId: 'points' },
      config: {
        openIn: 'full_page',
        numberGrouping: { from: 0, to: 100, step: 10 },
        hiddenGroups: ['2', null],
        collapsedGroups: ['1'],
      },
    });
    render(<ViewSettings database={numbers} view={grouped} />);
    // A formula's numbers group too.
    expect(
      setting('databases.viewSettings.groupBy')?.props.options.map(
        (o: { value: string }) => o.value,
      ),
    ).toContain('double');
    const fields = ['from', 'to', 'step'].map(
      (name) =>
        renderer.root
          .findAllByType(TextFieldInput)
          .find((f) => f.props.label === `databases.viewSettings.ranges.${name}`) ?? null,
    );
    expect(fields.map((f) => f?.props.value)).toEqual(['0', '100', '10']);
    const apply = () =>
      renderer.root
        .findAllByType(Button)
        .find((b) => b.props.children === 'databases.viewSettings.ranges.apply');
    // A thousand ranges are too many: nothing is saved.
    act(() => fields[2]?.props.onChangeText('0.1'));
    expect(apply()?.props.disabled).toBe(true);
    expect(text()).toContain('databases.viewSettings.ranges.invalid');
    act(() => fields[2]?.props.onChangeText('25'));
    act(() => apply()?.props.onPress());
    // Other ranges name other groups: the old ones' keys go.
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: { openIn: 'full_page', numberGrouping: { from: 0, to: 100, step: 25 } },
      }),
      expect.anything(),
    );

    // The hidden groups, named by their ranges, each shown again.
    const show = renderer.root
      .findAllByType(Button)
      .filter((b) => String(b.props.accessibilityLabel).startsWith('databases.groups.show'));
    expect(show.map((b) => b.props.accessibilityLabel)).toEqual([
      'databases.groups.show:databases.groups.range',
      'databases.groups.show:databases.groups.none:Points',
    ]);
    act(() => show[0]?.props.onPress());
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ hiddenGroups: [null], collapsedGroups: ['1'] }),
      }),
      expect.anything(),
    );

    act(() => setting('databases.viewSettings.groupBy')?.props.onChange('kind'));
    expect(mockUpdateView).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupBy: { propertyId: 'kind' }, config: { openIn: 'full_page' } }),
      expect.anything(),
    );
  });
});

describe('view tabs', () => {
  const views = [
    makeView({ id: 'a', name: 'A', order: 0 }),
    makeView({ id: 'b', name: 'B', order: 1, isDefault: false }),
    makeView({ id: 'c', name: 'C', order: 2, isDefault: false }),
  ];

  function openMenu(view: DatabaseView) {
    mockViews = views;
    render(
      <Tabs value={view.id} onValueChange={jest.fn()} label="views">
        <ViewTab view={view} database={database} />
      </Tabs>,
    );
    // A long press opens the tab's menu, as its settings button does.
    const trigger = renderer.root.findAll(
      (n) => n.props.value === view.id && typeof n.props.onLongPress === 'function',
    )[0];
    act(() => trigger?.props.onLongPress());
  }
  const item = (title: string) =>
    renderer.root.findAll((n) => n.props.title === title && 'disabled' in n.props)[0];

  it('moves a view left and makes it the default', async () => {
    openMenu(views[2] as DatabaseView);
    expect(item('databases.views.moveLeft')).toBeDefined();
    await act(async () => item('databases.views.moveLeft')?.props.onPress());
    expect(mockUpdateViewAsync.mock.calls.map(([input]) => input)).toEqual([
      { databaseId: 'db', viewId: 'c', order: 1 },
      { databaseId: 'db', viewId: 'b', order: 2 },
    ]);
    expect(item('databases.views.moveRight')?.props.disabled).toBe(true);
    await act(async () => item('databases.views.makeDefault')?.props.onPress());
    expect(mockUpdateViewAsync).toHaveBeenLastCalledWith({
      databaseId: 'db',
      viewId: 'c',
      isDefault: true,
    });
  });

  it('offers no settings for a locked database’s own views, and no new view', () => {
    mockViews = views;
    const locked = { ...database, locked: true };
    render(
      <DatabaseHeader database={locked} views={views} activeViewId="a" onSelectView={jest.fn()} />,
    );
    expect(
      renderer.root.findAll((n) =>
        String(n.props.accessibilityLabel).startsWith('databases.views.settings'),
      ),
    ).toHaveLength(0);
    expect(
      renderer.root.findAll((n) => n.props.children === 'databases.views.new' && n.props.onPress),
    ).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('databases.lock.badge');
  });
});

describe('a table’s frozen columns', () => {
  const originalOS = Platform.OS;
  beforeEach(() => {
    Platform.OS = 'web';
  });
  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('come first and are moved back as far as the table scrolls', () => {
    render(
      <ViewTable
        database={database}
        view={makeView({ frozenProperties: ['name', 'notes'] })}
        rows={[]}
        isLoading={false}
      />,
    );
    const headers = renderer.root
      .findAll((n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('table-'))
      .filter((n) => typeof n.type !== 'string');
    const ids = [...new Set(headers.map((n) => n.props.testID as string))];
    expect(ids.slice(0, 3)).toEqual([
      'table-title-header',
      'table-header-notes',
      'table-header-stage',
    ]);
    const moved = renderer.root
      .findAllByType(Animated.View)
      .map((n) => n.props.testID)
      .filter(Boolean);
    expect(moved).toEqual(['table-title-header', 'table-header-notes']);
  });

  it('freeze nothing when the view freezes nothing', () => {
    render(<ViewTable database={database} view={makeView()} rows={[]} isLoading={false} />);
    expect(renderer.root.findAllByType(Animated.View).filter((n) => n.props.testID)).toHaveLength(
      0,
    );
  });
});

describe('searching a view', () => {
  it('searches its rows once typing pauses, and closing the search clears it', () => {
    jest.useFakeTimers();
    try {
      useViewSearchStore.setState({ byView: {} });
      render(<ViewSearch viewId="view" />);
      const press = (label: string) =>
        renderer.root
          .findAll((n) => n.props.accessibilityLabel === label && n.props.onPress)[0]
          ?.props.onPress();
      act(() => press('databases.search.open'));
      const field = renderer.root.findAll(
        (n) => n.props.label === 'databases.search.label' && n.props.onChangeText,
      )[0];
      act(() => field?.props.onChangeText('launch'));
      expect(useViewSearchStore.getState().byView.view).toBeUndefined();
      act(() => jest.advanceTimersByTime(300));
      expect(useViewSearchStore.getState().byView.view).toBe('launch');
      act(() => press('databases.search.clear'));
      expect(useViewSearchStore.getState().byView.view).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('a gallery’s cards', () => {
  const card = (overrides: Record<string, unknown>) =>
    ({
      id: 'row',
      title: 'Card',
      cover: null,
      properties: {},
      ...overrides,
    }) as never;
  const files = {
    ...database,
    schema: { properties: [{ id: 'shots', name: 'Shots', type: 'files' }] },
  } as unknown as Database;

  it('shows all enabled properties and saves inline edits', () => {
    render(
      <ViewGallery
        database={database}
        view={makeView({ type: 'gallery' })}
        rows={[card({})]}
        isLoading={false}
      />,
    );
    const cells = renderer.root.findAllByType(PropertyCell);
    expect(cells.map((cell) => cell.props.property.id)).toEqual([
      'stage',
      'kind',
      'done',
      'notes',
      'due',
    ]);
    act(() => cells[0]?.props.onChange({ optionId: 'todo' }));
    expect(mockUpdateRow).toHaveBeenCalledWith(
      {
        databaseId: 'db',
        rowId: 'row',
        properties: { stage: { optionId: 'todo' } },
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('resolves uploaded property previews through the row that grants access', () => {
    render(
      <ViewGallery
        database={files}
        view={makeView({
          type: 'gallery',
          config: { coverSource: 'property', coverPropertyId: 'shots', fit: 'contain' },
        })}
        rows={[
          card({ properties: { shots: { files: [{ name: 'Photo', fileId: 'private-file' }] } } }),
        ]}
        isLoading={false}
      />,
    );
    expect(renderer.root.findByType(CoverDisplay).props).toMatchObject({
      value: 'file:private-file',
      pageId: 'row',
      fit: 'contain',
    });
  });

  it('show a page’s cover as its page does, a file fitted if asked, or nothing', () => {
    render(
      <ViewGallery
        database={database}
        view={makeView({ type: 'gallery' })}
        rows={[card({ cover: 'gradient:1' })]}
        isLoading={false}
      />,
    );
    expect(renderer.root.findAllByType(CoverDisplay)[0]?.props.value).toBe('gradient:1');
    act(() => renderer.unmount());
    render(
      <ViewGallery
        database={files}
        view={makeView({
          type: 'gallery',
          config: { coverSource: 'property', coverPropertyId: 'shots', fit: 'contain' },
        })}
        rows={[
          card({ properties: { shots: { files: [{ name: 'a', url: 'https://x.test/a.png' }] } } }),
        ]}
        isLoading={false}
      />,
    );
    expect(renderer.root.findAllByType(CoverDisplay)[0]?.props).toMatchObject({
      value: 'image:https://x.test/a.png',
      pageId: 'row',
      fit: 'contain',
    });
    act(() => renderer.unmount());
    render(
      <ViewGallery
        database={database}
        view={makeView({ type: 'gallery', config: { coverSource: 'none' } })}
        rows={[card({ cover: 'gradient:1' })]}
        isLoading={false}
      />,
    );
    expect(renderer.root.findAllByType(CoverDisplay)).toHaveLength(0);
  });
});
