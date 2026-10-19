import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import apiClient from '@/lib/api/client';
import { useDatabaseRows, useUpdateRow } from '../use-database-rows';
import { invalidateLiveQueries } from '@/lib/realtime/use-live-updates';
import { queryKeys } from '../query-keys';
import type { DatabaseRowsResponse, DatabaseViewType } from '@/lib/types/databases';

jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/realtime/socket', () => ({}));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), patch: jest.fn() },
}));
let client: QueryClient;
let renderer: ReactTestRenderer;
let rows: ReturnType<typeof useDatabaseRows>;
let update: ReturnType<typeof useUpdateRow>;
let type: DatabaseViewType;
function Hooks() {
  rows = useDatabaseRows('db', 'view', type);
  update = useUpdateRow();
  return null;
}
const tick = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
};
async function mount() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Hooks />
      </QueryClientProvider>,
    );
  });
  await tick();
}
beforeEach(() => {
  jest.clearAllMocks();
  type = 'table';
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  jest.mocked(apiClient.get).mockImplementation(async (_url, config) => {
    const start = Number((config?.params as { cursor?: string } | undefined)?.cursor ?? 0);
    return {
      data: {
        rows: Array.from({ length: 100 }, (_, i) => ({
          id: `row-${start + i}`,
          title: `Row ${start + i}`,
          properties: { original: { text: 'kept' } },
        })),
        cursor: start < 200 ? String(start + 100) : null,
        total: 300,
      },
    };
  });
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
  client.clear();
});

it.each(['table', 'list', 'gallery'] as const)(
  '%s fetches 100 initially and only fetches more on demand',
  async (viewType) => {
    type = viewType;
    await mount();
    expect(rows.data?.rows).toHaveLength(100);
    expect(rows.data?.total).toBe(300);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(apiClient.get).toHaveBeenCalledWith(
      '/databases/db/rows',
      expect.objectContaining({ params: { viewId: 'view', pageSize: '100' } }),
    );
    await act(async () => {
      await rows.fetchNextPage();
    });
    await tick();
    expect(rows.data?.rows).toHaveLength(200);
    expect(apiClient.get).toHaveBeenLastCalledWith(
      '/databases/db/rows',
      expect.objectContaining({ params: { viewId: 'view', pageSize: '100', cursor: '100' } }),
    );
    await act(async () => {
      await rows.fetchNextPage();
    });
    await tick();
    expect(rows.hasNextPage).toBe(false);
    expect(rows.data?.rows).toHaveLength(300);
  },
);
it.each(['board', 'calendar', 'timeline'] as const)('%s still loads all rows', async (viewType) => {
  type = viewType;
  await mount();
  expect(rows.data?.rows).toHaveLength(300);
  expect(rows.hasNextPage).toBe(false);
});
it('a live database event refetches only the two loaded pages', async () => {
  await mount();
  await act(async () => {
    await rows.fetchNextPage();
  });
  await tick();
  jest.mocked(apiClient.get).mockClear();
  act(() => invalidateLiveQueries(client, 'database', 'db'));
  await tick();
  expect(apiClient.get).toHaveBeenCalledTimes(2);
  expect(rows.data?.rows).toHaveLength(200);
  expect(rows.hasNextPage).toBe(true);
});
it('updates a row on a later cached page optimistically, preserving properties, and rolls back on failure', async () => {
  await mount();
  await act(async () => {
    await rows.fetchNextPage();
  });
  await tick();
  let reject!: (reason: Error) => void;
  jest.mocked(apiClient.patch).mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const key = [...queryKeys.databases.rows('db', 'view'), 'paged'];
  const before = client.getQueryData<InfiniteData<DatabaseRowsResponse>>(key);
  act(() =>
    update.mutate({
      databaseId: 'db',
      rowId: 'row-150',
      title: 'Changed',
      properties: { extra: { number: 5 } },
    }),
  );
  await tick();
  expect(rows.data?.rows[150]).toMatchObject({
    title: 'Changed',
    properties: { original: { text: 'kept' }, extra: { number: 5 } },
  });
  expect(client.getQueryData<InfiniteData<DatabaseRowsResponse>>(key)?.pageParams).toEqual(
    before?.pageParams,
  );
  await act(async () => reject(new Error('offline')));
  await tick();
  expect(rows.data?.rows[150]).toMatchObject({
    title: 'Row 150',
    properties: { original: { text: 'kept' } },
  });
  expect(rows.data?.rows).toHaveLength(200);
});
