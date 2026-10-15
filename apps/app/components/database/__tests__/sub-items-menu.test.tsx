import type React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DatabaseActionsMenu } from '../database-actions-menu';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
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
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
jest.mock('@/components/ui/confirmation-dialog', () => ({ ConfirmationDialog: () => null }));
jest.mock('@/components/ui/dropdown-menu', () => {
  const { View } = require('react-native');
  return {
    Root: View,
    Trigger: View,
    Content: View,
    Item: ({ children }: { children: React.ReactNode }) => children,
    ItemTitle: View,
  };
});
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
      <QueryClientProvider client={client}>
        <DatabaseActionsMenu databaseId="db" />
      </QueryClientProvider>,
    );
  });
}
it('enables sub-items with a self-relation in one request', async () => {
  await mount();
  await act(async () => renderer.root.findAllByType(DropdownMenu.Item)[0].props.onSelect());
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
  await mount();
  act(() => renderer.root.findAllByType(DropdownMenu.Item)[0].props.onSelect());
  expect(apiClient.delete).not.toHaveBeenCalled();
  expect(renderer.root.findByType(ConfirmationDialog).props.open).toBe(true);
  await act(async () => renderer.root.findByType(ConfirmationDialog).props.onConfirm());
  expect(apiClient.delete).toHaveBeenCalledWith('/databases/db/properties/children');
});
