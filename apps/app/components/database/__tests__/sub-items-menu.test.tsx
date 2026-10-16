import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DropdownMenuItem } from '@oxy.so/bloom/dropdown-menu';
import { confirm } from '@oxy.so/bloom/surfaces';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { DatabaseActionsMenu } from '../database-actions-menu';
import apiClient from '@/lib/api/client';
import type { Database } from '@/lib/types/databases';
let mockDatabase: Database;
jest.mock('@/lib/hooks/use-databases', () => ({
  useDatabase: () => ({ data: { database: mockDatabase } }),
}));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { post: jest.fn(), delete: jest.fn() },
}));
jest.mock('@/lib/hooks/use-page-transfer', () => ({ useExportDatabase: () => ({}) }));
jest.mock('@/lib/save-export', () => ({ saveExport: jest.fn() }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'databases.subItems.name' ? 'Sub-items' : key),
  }),
}));
jest.mock('@oxy.so/bloom/surfaces', () => ({ confirm: jest.fn() }));
let renderer: ReactTestRenderer;
let client: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  mockDatabase = { id: 'db', schema: { properties: [] } } as unknown as Database;
  client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: Infinity } } });
  jest.mocked(apiClient.post).mockResolvedValue({ data: { database: mockDatabase } });
  jest.mocked(apiClient.delete).mockResolvedValue({ data: { database: mockDatabase } });
});
afterEach(() => {
  act(() => renderer.unmount());
  client.clear();
});
async function mount() {
  client.setQueryData(['database', 'db'], { database: mockDatabase });
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <QueryClientProvider client={client}>
          <DatabaseActionsMenu databaseId="db" />
        </QueryClientProvider>
      </BloomTestProviders>,
    );
  });
  // The items render once the menu is open.
  act(() => {
    renderer.root
      .findAll(
        (node) => node.props.accessibilityLabel === 'databases.csv.menu' && node.props.onPress,
      )[0]
      .props.onPress();
  });
}
const subItemsItem = () => renderer.root.findAllByType(DropdownMenuItem)[0];
it('enables sub-items with a self-relation in one request', async () => {
  await mount();
  await act(async () => subItemsItem().props.onPress());
  expect(apiClient.post).toHaveBeenCalledWith('/databases/db/properties', {
    name: 'Sub-items',
    type: 'relation',
    config: { targetDatabaseId: 'db', twoWay: true },
  });
});
it('confirms before deleting the source property to turn sub-items off', async () => {
  mockDatabase.schema.properties = [
    {
      id: 'children',
      name: 'Sub-items',
      type: 'relation',
      config: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'parent' },
    },
    {
      id: 'parent',
      name: 'Sub-items (parent)',
      type: 'relation',
      config: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'children' },
    },
  ];
  let answer: (confirmed: boolean) => void = () => {};
  jest.mocked(confirm).mockReturnValue(
    new Promise<boolean>((resolve) => {
      answer = resolve;
    }),
  );
  await mount();
  act(() => subItemsItem().props.onPress());
  expect(apiClient.delete).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'databases.subItems.disable', destructive: true }),
  );
  await act(async () => {
    answer(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(apiClient.delete).toHaveBeenCalledWith('/databases/db/properties/children');
});
