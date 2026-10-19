import { FILTER_OPERATORS_BY_TYPE } from '@oxy.so/nilo-contracts';
import { toast } from '@oxy.so/bloom/toast';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { FilterBuilder } from '../filter-builder';
import type { Database, DatabaseView, FilterCondition } from '@/lib/types/databases';

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
  useWorkspaceMembers: () => ({ data: [{ userId: 'user-ana', user: { name: { full: 'Ana' } } }] }),
  memberProfileName: (member: { user?: { name?: { full?: string } } }) =>
    member.user?.name?.full ?? null,
}));
jest.mock('@/lib/hooks/use-database-rows', () => ({
  useRowSearch: (databaseId: string) => ({
    data: databaseId === 'projects' ? [{ id: 'row-launch', title: 'Launch' }] : [],
  }),
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
        type: 'select',
        config: {
          options: [
            { id: 'opt-idea', name: 'Idea', color: 'gray' },
            { id: 'opt-done', name: 'Done', color: 'green' },
          ],
        },
      },
      {
        id: 'tags',
        name: 'Tags',
        type: 'multi_select',
        config: { options: [{ id: 'opt-urgent', name: 'Urgent', color: 'red' }] },
      },
      { id: 'owner', name: 'Owner', type: 'person' },
      {
        id: 'project',
        name: 'Project',
        type: 'relation',
        config: { targetDatabaseId: 'projects' },
      },
      { id: 'due', name: 'Due', type: 'date' },
    ],
  },
} as Database;

const condition = (propertyId: string, operator: string): FilterCondition => ({
  kind: 'condition',
  propertyId,
  operator,
  value: '',
});
const view = {
  id: 'view',
  filters: {
    kind: 'group',
    combinator: 'and',
    filters: [
      condition('stage', 'is'),
      condition('tags', 'contains'),
      condition('owner', 'contains'),
      condition('project', 'contains'),
      condition('due', 'before'),
      // A property since removed: the API would refuse the whole filter.
      condition('gone', 'is_empty'),
    ],
  },
} as DatabaseView;

let renderer: ReactTestRenderer;
beforeEach(() => jest.clearAllMocks());
afterEach(() => act(() => renderer?.unmount()));

function render() {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <FilterBuilder database={database} view={view} rows={[]} />
      </BloomTestProviders>,
    );
  });
  // The toolbar button opens the dialog on the view's current filters.
  act(() => pressable('databases.toolbar.filterCount').props.onPress());
}
/** The outermost match: a Bloom control and the pressable inside it carry the same label. */
function pressable(label: string) {
  return renderer.root.findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function',
  )[0];
}
function choice(label: string) {
  const found = renderer.root.findAll(
    (node) => node.props.role === 'radio' && node.props.children === label && node.props.onPress,
  )[0];
  if (!found) throw new Error(`no choice ${label}`);
  return found;
}
async function apply() {
  await act(async () => {
    await pressable('databases.actions.apply').props.onPress();
  });
}

it('picks options, members, rows and days by what they are, never typed text', async () => {
  render();
  // No condition here takes typed text: each value is picked.
  expect(
    renderer.root.findAll(
      (node) =>
        node.props.label === 'databases.filters.value' &&
        typeof node.props.onChangeText === 'function',
    ),
  ).toHaveLength(0);
  act(() => choice('Done').props.onPress());
  act(() => choice('Urgent').props.onPress());
  act(() => choice('Ana').props.onPress());
  act(() => choice('Launch').props.onPress());
  const datePicker = renderer.root.findAll(
    (node) =>
      node.props.placeholder === 'databases.filters.pickDate' &&
      typeof node.props.onChange === 'function',
  )[0];
  act(() => datePicker?.props.onChange(new Date(2026, 9, 5)));
  await apply();
  expect(mockUpdate).toHaveBeenCalledWith({
    databaseId: 'db',
    viewId: 'view',
    filters: {
      kind: 'group',
      combinator: 'and',
      filters: [
        { ...condition('stage', 'is'), value: 'opt-done' },
        { ...condition('tags', 'contains'), value: 'opt-urgent' },
        { ...condition('owner', 'contains'), value: 'user-ana' },
        { ...condition('project', 'contains'), value: 'row-launch' },
        { ...condition('due', 'before'), value: '2026-10-05' },
      ],
    },
  });
});

it('offers each property the operators the API takes for its type', () => {
  render();
  const offered = renderer.root
    .findAll((node) => Array.isArray(node.props.items) && node.props.renderItem)
    .map((node) => (node.props.items as { value: string }[]).map((item) => item.value));
  for (const type of ['select', 'multi_select', 'person', 'relation', 'date'] as const) {
    expect(offered).toContainEqual([...FILTER_OPERATORS_BY_TYPE[type]]);
  }
});

it('says so when the view could not be saved', async () => {
  mockUpdate.mockRejectedValueOnce(new Error('400'));
  render();
  await apply();
  expect(toast.error).toHaveBeenCalledWith('databases.filters.saveFailed');
});
