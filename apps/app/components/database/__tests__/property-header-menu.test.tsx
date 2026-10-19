import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import { RiSortAlphabetAsc } from '@oxy.so/bloom/icons/RiSortAlphabetAsc';
import { RiSortAlphabetDesc } from '@oxy.so/bloom/icons/RiSortAlphabetDesc';
import { toast } from '@oxy.so/bloom/toast';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { PropertyHeaderMenu } from '../property-config-modal';
import type { Database, DatabaseView } from '@/lib/types/databases';

const mockDelete = jest.fn();
jest.mock('../button-settings', () => ({ ButtonSettings: () => null }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}));
jest.mock('@/lib/i18n', () => ({
  __esModule: true,
  default: {
    t: (key: string, options?: { app?: string }) => (options?.app ? `${key}:${options.app}` : key),
  },
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
jest.mock('@/lib/hooks/use-database-properties', () => ({
  useAddProperty: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateProperty: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteProperty: () => ({ mutateAsync: mockDelete, isPending: false }),
}));
jest.mock('@/lib/hooks/use-databases', () => ({ useDatabase: () => ({ data: undefined }) }));
jest.mock('@/lib/hooks/use-database-views', () => ({
  useUpdateView: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock('../relation-settings', () => ({ RelationSettings: () => null }));
jest.mock('../formula-editor', () => ({ FormulaEditor: () => null }));
jest.mock('../unique-id-editor', () => ({ UniqueIdEditor: () => null }));

const view = { id: 'view', sorts: [], hiddenProperties: [] } as unknown as DatabaseView;
const property = { id: 'labels', name: 'Labels', type: 'multi_select' } as const;

function Menu({ database }: { database: Database }) {
  const control = useDialogControl();
  React.useEffect(() => control.open(), [control]);
  return (
    <PropertyHeaderMenu control={control} database={database} view={view} property={property} />
  );
}

let renderer: ReactTestRenderer;
beforeEach(() => jest.clearAllMocks());
afterEach(() => act(() => renderer?.unmount()));

function render(systemKey: Database['systemKey']) {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <Menu database={{ id: 'db', systemKey } as Database} />
      </BloomTestProviders>,
    );
  });
}
function item(title: string) {
  const found = renderer.root.findAll(
    (node) => node.props.title === title && typeof node.props.onPress === 'function',
  )[0];
  if (!found) throw new Error(`no item ${title}`);
  return found;
}

it('shows A→Z for ascending and Z→A for descending', () => {
  render(null);
  expect(item('databases.properties.sortAscending').props.leading.type).toBe(RiSortAlphabetAsc);
  expect(item('databases.properties.sortDescending').props.leading.type).toBe(RiSortAlphabetDesc);
});

it('says why an app’s own property cannot be deleted, and nothing about relations', async () => {
  mockDelete.mockRejectedValue({
    isAxiosError: true,
    response: { status: 409, data: { code: 'SYSTEM_PROPERTY' } },
  });
  render('notes');
  await act(async () => {
    await item('databases.properties.delete').props.onPress();
  });
  expect(toast.error).toHaveBeenCalledWith('databases.system.property:Noted');

  render(null);
  mockDelete.mockRejectedValue(new Error('offline'));
  await act(async () => {
    await item('databases.properties.delete').props.onPress();
  });
  expect(toast.error).toHaveBeenLastCalledWith('databases.properties.deleteFailed');
});
