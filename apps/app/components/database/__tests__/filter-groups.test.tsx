import { DATABASE_PROPERTY_TYPES, FILTER_OPERATORS_BY_TYPE } from '@oxy.so/nilo-contracts';
import { Button } from '@oxy.so/bloom/button';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { FilterBuilder, withoutEmptyGroups } from '../filter-builder';
import type {
  Database,
  DatabaseProperty,
  DatabaseView,
  FilterCondition,
  FilterGroup,
} from '@/lib/types/databases';

const mockUpdate = jest.fn();
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
jest.mock('@/lib/hooks/use-database-views', () => ({
  useUpdateView: () => ({ mutateAsync: mockUpdate }),
}));
jest.mock('@/lib/hooks/use-workspace-members', () => ({
  useWorkspaceMembers: () => ({ data: [] }),
  memberProfileName: () => null,
}));
jest.mock('@/lib/hooks/use-database-rows', () => ({ useRowSearch: () => ({ data: [] }) }));

const condition = (propertyId: string, operator: string, value: unknown = ''): FilterCondition => ({
  kind: 'condition',
  propertyId,
  operator,
  value,
});
const group = (combinator: 'and' | 'or', ...filters: FilterGroup['filters']): FilterGroup => ({
  kind: 'group',
  combinator,
  filters,
});

const database = {
  id: 'db',
  workspaceId: 'workspace',
  systemKey: null,
  schema: {
    properties: [
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'points', name: 'Points', type: 'number' },
      { id: 'due', name: 'Due', type: 'date' },
    ],
  },
} as Database;

let renderer: ReactTestRenderer;
beforeEach(() => jest.clearAllMocks());
afterEach(() => act(() => renderer?.unmount()));

function render(filters: FilterGroup, source: Database = database) {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <FilterBuilder database={source} view={{ id: 'view', filters } as DatabaseView} rows={[]} />
      </BloomTestProviders>,
    );
  });
  const toolbar = renderer.root.findAll(
    (node) =>
      typeof node.props.accessibilityLabel === 'string' &&
      node.props.accessibilityLabel.startsWith('databases.toolbar.filter') &&
      typeof node.props.onPress === 'function',
  )[0];
  act(() => toolbar?.props.onPress());
}
/** Bloom buttons by their text, one node each (the pressable inside carries it too). */
function buttons(text: string) {
  return renderer.root.findAllByType(Button).filter((node) => node.props.children === text);
}
function labelled(label: string) {
  return renderer.root
    .findAllByType(Button)
    .filter((node) => node.props.accessibilityLabel === label);
}
/** The "and"/"or" control of each group, outermost first. */
function combinators() {
  return renderer.root.findAll(
    (node) =>
      node.props.label === 'databases.filters.combinator' &&
      typeof node.props.onValueChange === 'function',
  );
}
async function apply() {
  await act(async () => {
    await buttons('databases.actions.apply')[0]?.props.onPress();
  });
  return mockUpdate.mock.calls.at(-1)?.[0].filters;
}

it('edits groups nested in the view’s filter, which used to be kept but hidden', async () => {
  render(
    group('and', condition('name', 'contains', 'a'), group('or', condition('points', '>', 1))),
  );
  // The nested group is shown, with its own combinator.
  expect(combinators()).toHaveLength(2);
  act(() => combinators()[1]?.props.onValueChange('and'));
  act(() => combinators()[0]?.props.onValueChange('or'));
  expect(await apply()).toEqual(
    group('or', condition('name', 'contains', 'a'), group('and', condition('points', '>', 1))),
  );
});

it('adds a group with a condition, nests one in it, and no deeper', async () => {
  render(group('and'));
  act(() => buttons('databases.filters.addGroup')[0]?.props.onPress());
  // The new group offers a group of its own (its button comes first, above the
  // view's own); that one offers none.
  act(() => buttons('databases.filters.addGroup')[0]?.props.onPress());
  expect(combinators()).toHaveLength(3);
  expect(buttons('databases.filters.addGroup')).toHaveLength(2);
  expect(await apply()).toEqual(
    group(
      'and',
      group('and', condition('name', 'contains'), group('and', condition('name', 'contains'))),
    ),
  );
});

it('removes a group, and saves no group left empty', async () => {
  render(group('and', group('or', condition('name', 'is_empty')), condition('points', '=', 3)));
  act(() => labelled('databases.filters.removeGroup')[0]?.props.onPress());
  expect(await apply()).toEqual(group('and', condition('points', '=', 3)));

  render(group('and', group('or', condition('name', 'is_empty'))));
  // The group's only condition removed: the group goes with it on save.
  const deletes = labelled('common.delete');
  act(() => deletes[0]?.props.onPress());
  expect(await apply()).toEqual(group('and'));
});

it('offers every operator the API takes, for every type, and asks a value only where one counts', () => {
  const properties: DatabaseProperty[] = DATABASE_PROPERTY_TYPES.filter(
    (type) => type !== 'formula' && type !== 'rollup',
  ).map((type) => ({ id: type, name: type, type }));
  render(
    group(
      'and',
      ...properties.map((p) => condition(p.id, FILTER_OPERATORS_BY_TYPE[p.type][0] as string)),
    ),
    { ...database, schema: { properties } },
  );
  const offered = renderer.root
    .findAll((node) => Array.isArray(node.props.items) && node.props.renderItem)
    .map((node) => (node.props.items as { value: string }[]).map((item) => item.value));
  for (const property of properties) {
    expect(offered).toContainEqual([...FILTER_OPERATORS_BY_TYPE[property.type]]);
  }
});

it('takes no value for an emptiness test and a count of days for in the last', () => {
  render(group('and', condition('due', 'is_empty'), condition('due', 'in_last', 7)));
  const fields = renderer.root.findAll(
    (node) => typeof node.props.onChangeText === 'function' && node.props.label,
  );
  expect(fields.map((f) => f.props.label)).toEqual(['databases.filters.days']);
  expect(fields[0]?.props.value).toBe('7');
});

it('prunes the groups that hold no condition', () => {
  const tree = group('and', condition('a', 'x'), group('or', group('and')));
  expect(withoutEmptyGroups(tree)).toEqual(group('and', condition('a', 'x')));
});
