import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api/client';
import { useUpdateView } from '../use-database-views';
import { useReorderProperties } from '../use-database-properties';
import { queryKeys } from '../query-keys';
import type { DatabaseView } from '@/lib/types/databases';

jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { patch: jest.fn(), put: jest.fn() },
}));

let client: QueryClient;
let renderer: ReactTestRenderer;
let update: ReturnType<typeof useUpdateView>;
let reorder: ReturnType<typeof useReorderProperties>;
function Hooks() {
  update = useUpdateView();
  reorder = useReorderProperties();
  return null;
}
const view = (id: string, order: number, isDefault = false) =>
  ({ id, order, isDefault, blockId: null, name: id }) as unknown as DatabaseView;
const detail = () =>
  client.getQueryData<{
    views: DatabaseView[];
    database: { schema: { properties: { id: string }[] } };
  }>(queryKeys.databases.detail('db'));

beforeEach(async () => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  client.setQueryData(queryKeys.databases.detail('db'), {
    database: { id: 'db', schema: { properties: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } },
    views: [view('one', 0, true), view('two', 1)],
  });
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Hooks />
      </QueryClientProvider>,
    );
  });
});
afterEach(() => {
  act(() => renderer.unmount());
  client.clear();
});

it('shows a view moved or made the default at once, and puts it back if refused', async () => {
  let fail!: (error: Error) => void;
  jest.mocked(apiClient.patch).mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  act(() => update.mutate({ databaseId: 'db', viewId: 'two', order: -1, isDefault: true }));
  await act(async () => {});
  expect(detail()?.views.map((v) => [v.id, v.isDefault])).toEqual([
    ['two', true],
    ['one', false],
  ]);
  await act(async () => fail(new Error('offline')));
  expect(detail()?.views.map((v) => [v.id, v.isDefault])).toEqual([
    ['one', true],
    ['two', false],
  ]);
});

it('orders the properties at once, the ones not named after', async () => {
  jest.mocked(apiClient.put).mockImplementation(() => new Promise(() => {}));
  act(() => reorder.mutate({ databaseId: 'db', ids: ['c', 'a'] }));
  await act(async () => {});
  expect(detail()?.database.schema.properties.map((p) => p.id)).toEqual(['c', 'a', 'b']);
  expect(apiClient.put).toHaveBeenCalledWith('/databases/db/properties/order', {
    ids: ['c', 'a'],
  });
});
