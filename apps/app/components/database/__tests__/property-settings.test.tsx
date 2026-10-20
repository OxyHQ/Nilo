import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import { confirm } from '@oxy.so/bloom/surfaces';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { PropertyHeaderMenu } from '../property-config-modal';
import { RollupSettings } from '../property-settings';
import { SettingSelect } from '../view-settings';
import type { Database, DatabaseProperty, DatabaseView } from '@/lib/types/databases';

const mockUpdate = jest.fn();
const mockUpdateAsync = jest.fn();
let mockRelated: Database | undefined;
jest.mock('../button-settings', () => ({ ButtonSettings: () => null }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@oxy.so/bloom/surfaces', () => ({ confirm: jest.fn() }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
    locale: 'en',
  }),
}));
jest.mock('@/lib/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('@/lib/hooks/use-database-properties', () => ({
  useAddProperty: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateProperty: () => ({ mutate: mockUpdate, mutateAsync: mockUpdateAsync, isPending: false }),
  useDeleteProperty: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useReorderProperties: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/hooks/use-databases', () => ({
  useDatabase: (id?: string) => ({
    data: id && mockRelated ? { database: mockRelated } : undefined,
  }),
}));
jest.mock('@/lib/hooks/use-database-views', () => ({
  useUpdateView: () => ({ mutateAsync: jest.fn(), mutate: jest.fn() }),
}));
jest.mock('../relation-settings', () => ({ RelationSettings: () => null }));
jest.mock('../formula-editor', () => ({ FormulaEditor: () => null }));
jest.mock('../unique-id-editor', () => ({ UniqueIdEditor: () => null }));

const view = { id: 'view', sorts: [], hiddenProperties: [] } as unknown as DatabaseView;
const database = { id: 'db', systemKey: null, schema: { properties: [] } } as unknown as Database;

function Menu({ property }: { property: DatabaseProperty }) {
  const control = useDialogControl();
  React.useEffect(() => control.open(), [control]);
  return (
    <PropertyHeaderMenu control={control} database={database} view={view} property={property} />
  );
}

let renderer: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  mockRelated = undefined;
  mockUpdateAsync.mockResolvedValue({});
});
afterEach(() => act(() => renderer?.unmount()));

function render(node: React.ReactNode) {
  act(() => {
    renderer = create(<BloomTestProviders>{node}</BloomTestProviders>);
  });
}
const pressable = (match: (props: Record<string, unknown>) => boolean) => {
  const found = renderer.root.findAll(
    (node) => match(node.props) && typeof node.props.onPress === 'function',
  )[0];
  if (!found) throw new Error('nothing to press');
  return found;
};
const item = (title: string) => pressable((props) => props.title === title);
const setting = (label: string) =>
  renderer.root.findAllByType(SettingSelect).find((s) => s.props.label === label);

it('changes a property’s type once its values’ fate is confirmed, never the Name’s', async () => {
  render(<Menu property={{ id: 'tag', name: 'Tag', type: 'text' }} />);
  act(() => item('databases.properties.changeType').props.onPress());
  // A relation is added with its database, not converted to.
  expect(() => item('databases.propertyTypes.relation')).toThrow();
  jest.mocked(confirm).mockResolvedValueOnce(false);
  await act(async () => item('databases.propertyTypes.select').props.onPress());
  expect(mockUpdateAsync).not.toHaveBeenCalled();
  jest.mocked(confirm).mockResolvedValueOnce(true);
  await act(async () => item('databases.propertyTypes.select').props.onPress());
  expect(mockUpdateAsync).toHaveBeenCalledWith({
    databaseId: 'db',
    propertyId: 'tag',
    type: 'select',
  });

  act(() => renderer.unmount());
  render(<Menu property={{ id: 'name', name: 'Name', type: 'text' }} />);
  expect(() => item('databases.properties.changeType')).toThrow();
});

it('renames, reorders and regroups a status’s options, its groups saved with them', async () => {
  const property: DatabaseProperty = {
    id: 'stage',
    name: 'Stage',
    type: 'status',
    config: {
      options: [
        { id: 'a', name: 'Not started', color: 'gray' },
        { id: 'b', name: 'Waiting', color: 'gray' },
        { id: 'c', name: 'Done', color: 'green' },
      ],
      groups: [
        { id: 'todo', optionIds: ['a', 'b'] },
        { id: 'in_progress', optionIds: [] },
        { id: 'complete', optionIds: ['c'] },
      ],
    },
  };
  render(<Menu property={property} />);
  act(() => item('databases.properties.editOptions').props.onPress());
  const groupSelects = () =>
    renderer.root
      .findAllByType(SettingSelect)
      .filter((s) => s.props.label === 'databases.options.group');
  expect(groupSelects().map((s) => s.props.value)).toEqual(['todo', 'todo', 'complete']);

  await act(async () => groupSelects()[1]?.props.onChange('in_progress'));
  expect(mockUpdateAsync).toHaveBeenLastCalledWith({
    databaseId: 'db',
    propertyId: 'stage',
    config: expect.objectContaining({
      groups: [
        { id: 'todo', optionIds: ['a'] },
        { id: 'in_progress', optionIds: ['b'] },
        { id: 'complete', optionIds: ['c'] },
      ],
    }),
  });

  // "Not started" is first of its group, "Done" last of its: neither moves further.
  expect(
    pressable((p) => p.accessibilityLabel === 'databases.options.moveUp:Not started').props
      .disabled,
  ).toBe(true);
  act(() =>
    pressable((p) => p.accessibilityLabel === 'databases.options.rename:Done').props.onPress(),
  );
  const field = renderer.root.findAll(
    (node) => node.props.label === 'databases.options.name' && node.props.onSubmitEditing,
  )[0];
  act(() => field?.props.onChangeText('Shipped'));
  await act(async () => field?.props.onSubmitEditing());
  expect(
    mockUpdateAsync.mock.lastCall?.[0].config.options.map((o: { name: string }) => o.name),
  ).toEqual(['Not started', 'Waiting', 'Shipped']);
});

it('rolls up a relation’s target property, read from the related database', () => {
  mockRelated = {
    id: 'other',
    schema: {
      properties: [
        { id: 'name', name: 'Name', type: 'text' },
        { id: 'pts', name: 'Points', type: 'number' },
      ],
    },
  } as unknown as Database;
  const withRelation = {
    ...database,
    schema: {
      properties: [
        { id: 'rel', name: 'Tasks', type: 'relation', config: { targetDatabaseId: 'other' } },
      ],
    },
  } as unknown as Database;
  const rollup: DatabaseProperty = {
    id: 'sum',
    name: 'Sum',
    type: 'rollup',
    config: { relationPropertyId: 'rel', function: 'sum' },
  };
  render(<RollupSettings database={withRelation} property={rollup} onDone={jest.fn()} />);
  const target = setting('databases.rollup.property');
  expect(target?.props.options.map((o: { label: string }) => o.label)).toEqual(['Name', 'Points']);
  act(() => target?.props.onChange('pts'));
  expect(mockUpdate).toHaveBeenLastCalledWith(
    {
      databaseId: 'db',
      propertyId: 'sum',
      config: { relationPropertyId: 'rel', function: 'sum', targetPropertyId: 'pts' },
    },
    expect.anything(),
  );
  const functions = setting('databases.rollup.function');
  expect(functions?.props.options.map((o: { value: string }) => o.value)).toEqual(
    expect.arrayContaining(['show_original', 'percent_empty', 'percent_not_empty']),
  );
});
