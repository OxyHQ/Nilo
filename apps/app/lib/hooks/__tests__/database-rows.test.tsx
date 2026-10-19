import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import apiClient from '@/lib/api/client';
import { useDatabaseRows, useUpdateRow } from '../use-database-rows';
import { invalidateLiveQueries } from '@/lib/realtime/use-live-updates';
import { queryKeys } from '../query-keys';
import { useVisibleDatesStore } from '@/lib/stores/visible-dates-store';
import { useViewSearchStore } from '@/lib/stores/view-search-store';
import { visibleDatesFilter } from '@/lib/visible-dates';
import type { DatabaseRowsResponse, DatabaseViewType } from '@/lib/types/databases';

jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/realtime/socket', () => ({}));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), patch: jest.fn() },
}));
/** Every read names the reader's zone: a view grouped by date groups in it. */
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
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
  useVisibleDatesStore.setState({ byView: {} });
  useViewSearchStore.setState({ byView: {} });
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

it.each(['table', 'list', 'gallery', 'board'] as const)(
  '%s fetches its load limit initially and only fetches more on demand',
  async (viewType) => {
    type = viewType;
    await mount();
    expect(rows.data?.rows).toHaveLength(100);
    expect(rows.data?.total).toBe(300);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(apiClient.get).toHaveBeenCalledWith(
      '/databases/db/rows',
      // No page size: the API reads the view's own (its load limit).
      expect.objectContaining({ params: { viewId: 'view', timeZone: ZONE } }),
    );
    await act(async () => {
      await rows.fetchNextPage();
    });
    await tick();
    expect(rows.data?.rows).toHaveLength(200);
    expect(apiClient.get).toHaveBeenLastCalledWith(
      '/databases/db/rows',
      expect.objectContaining({ params: { viewId: 'view', cursor: '100', timeZone: ZONE } }),
    );
    await act(async () => {
      await rows.fetchNextPage();
    });
    await tick();
    expect(rows.hasNextPage).toBe(false);
    expect(rows.data?.rows).toHaveLength(300);
  },
);
it.each(['calendar', 'timeline'] as const)(
  '%s reads nothing until it shows its dates, then every row of those dates only',
  async (viewType) => {
    type = viewType;
    await mount();
    expect(apiClient.get).not.toHaveBeenCalled();
    const dates = visibleDatesFilter({
      startPropertyId: 'due',
      from: new Date('2026-10-01T00:00:00Z'),
      to: new Date('2026-10-31T00:00:00Z'),
    });
    act(() => useVisibleDatesStore.getState().show('view', dates));
    await tick();
    expect(rows.data?.rows).toHaveLength(300);
    expect(rows.hasNextPage).toBe(false);
    expect(apiClient.get).toHaveBeenCalledTimes(3);
    expect(apiClient.get).toHaveBeenCalledWith(
      '/databases/db/rows',
      expect.objectContaining({
        params: { viewId: 'view', pageSize: '100', filter: JSON.stringify(dates), timeZone: ZONE },
      }),
    );

    // Another month is read on its own, the one it leaves shown meanwhile.
    jest.mocked(apiClient.get).mockClear();
    const next = visibleDatesFilter({
      startPropertyId: 'due',
      from: new Date('2026-11-01T00:00:00Z'),
      to: new Date('2026-11-30T00:00:00Z'),
    });
    act(() => useVisibleDatesStore.getState().show('view', next));
    expect(rows.data?.rows).toHaveLength(300);
    await tick();
    expect(apiClient.get).toHaveBeenCalledWith(
      '/databases/db/rows',
      expect.objectContaining({
        params: expect.objectContaining({ filter: JSON.stringify(next) }),
      }),
    );
  },
);
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

it('reads the rows a view is searched for, showing the last ones until they come', async () => {
  await mount();
  let resolve!: (value: unknown) => void;
  jest.mocked(apiClient.get).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => useViewSearchStore.getState().search('view', '  Row 7 '));
  await tick();
  expect(apiClient.get).toHaveBeenLastCalledWith(
    '/databases/db/rows',
    expect.objectContaining({ params: { viewId: 'view', search: 'Row 7', timeZone: ZONE } }),
  );
  expect(rows.data?.rows).toHaveLength(100);
  await act(async () =>
    resolve({
      data: { rows: [{ id: 'row-7', title: 'Row 7', properties: {} }], cursor: null, total: 1 },
    }),
  );
  await tick();
  expect(rows.data?.rows.map((r) => r.id)).toEqual(['row-7']);
  act(() => useViewSearchStore.getState().search('view', ''));
  await tick();
  expect(rows.data?.rows).toHaveLength(100);
});
