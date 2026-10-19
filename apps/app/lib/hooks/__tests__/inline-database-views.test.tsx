import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import apiClient from '@/lib/api/client';
import { useInlineDatabaseViews } from '../use-inline-database-views';
import { useUpdateView, useDeleteView } from '../use-database-views';
import { queryKeys } from '../query-keys';
import type { Database, DatabaseView } from '@/lib/types/databases';

jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
let client: QueryClient;
let renderer: ReactTestRenderer;
let state: ReturnType<typeof useInlineDatabaseViews>;
let update: ReturnType<typeof useUpdateView>;
let remove: ReturnType<typeof useDeleteView>;
const own = { id: 'own', name: 'Own', type: 'table' } as DatabaseView;
const linked = {
  id: 'linked',
  databaseId: 'db',
  blockId: 'block',
  name: 'Linked',
  type: 'table',
} as DatabaseView;
let props: Parameters<typeof useInlineDatabaseViews>[0];
function Hooks() {
  state = useInlineDatabaseViews(props);
  update = useUpdateView();
  remove = useDeleteView();
  return null;
}
const tree = () => (
  <QueryClientProvider client={client}>
    <Hooks />
  </QueryClientProvider>
);
const tick = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
};
async function mount() {
  await act(async () => {
    renderer = create(tree());
  });
  await tick();
}
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  props = {
    database: { id: 'db', parentPageId: 'elsewhere' } as Database,
    ownViews: [own],
    pageId: 'page',
    blockId: 'block',
    readOnly: false,
    saved: true,
    defaultName: 'Table',
  };
  jest.mocked(apiClient.get).mockResolvedValue({ data: { views: [linked] } });
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
  client.clear();
});
it('uses owned views for a database hosted on this page', async () => {
  props.database = { ...props.database, parentPageId: 'page' } as Database;
  await mount();
  expect(state.linked).toBe(false);
  expect(state.views).toEqual([own]);
  expect(apiClient.get).not.toHaveBeenCalled();
});
it('loads block views instead of source views, including for page viewers', async () => {
  props.readOnly = true;
  await mount();
  expect(state.views).toEqual([linked]);
  expect(apiClient.get).toHaveBeenCalledWith('/databases/db/views', {
    params: { blockId: 'block' },
  });
  expect(apiClient.post).not.toHaveBeenCalled();
});
it('creates the first table view exactly once after the block has saved', async () => {
  props.saved = false;
  jest
    .mocked(apiClient.get)
    .mockResolvedValueOnce({ data: { views: [] } })
    .mockResolvedValue({ data: { views: [linked] } });
  jest.mocked(apiClient.post).mockResolvedValue({ data: { view: linked } });
  await mount();
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(apiClient.post).not.toHaveBeenCalled();
  props.saved = true;
  await act(async () => renderer.update(tree()));
  await tick();
  await tick();
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apiClient.post).toHaveBeenCalledWith('/databases/db/views', {
    blockId: 'block',
    name: 'Table',
    type: 'table',
  });
  expect(state.views).toEqual([linked]);
  props.saved = false;
  await act(async () => renderer.update(tree()));
  expect(state.views).toEqual([linked]);
  expect(state.isLoading).toBe(false);
});
it('never creates a view for a read-only page', async () => {
  props.readOnly = true;
  jest.mocked(apiClient.get).mockResolvedValue({ data: { views: [] } });
  await mount();
  expect(state.views).toEqual([]);
  expect(apiClient.post).not.toHaveBeenCalled();
});
it('does not retry or create views on no access', async () => {
  const error = new AxiosError('No access');
  Object.assign(error, { response: { status: 403 } });
  jest.mocked(apiClient.get).mockRejectedValue(error);
  await mount();
  await tick();
  expect(state.error).toBe(error);
  expect(state.views).toEqual([]);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.post).not.toHaveBeenCalled();
});
it('editing and deleting a linked view invalidate its block scope, not the source list or other rows', async () => {
  await mount();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  jest.mocked(apiClient.patch).mockResolvedValue({ data: { view: linked } });
  await act(async () => {
    await update.mutateAsync({ databaseId: 'db', viewId: 'linked', name: 'Renamed' });
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: queryKeys.databases.blockViews('db', 'block'),
    exact: true,
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.databases.rows('db', 'linked') });
  expect(invalidate).not.toHaveBeenCalledWith(
    expect.objectContaining({ queryKey: queryKeys.databases.detail('db') }),
  );
  invalidate.mockClear();
  await act(async () => {
    await remove.mutateAsync({ databaseId: 'db', viewId: 'linked', blockId: 'block' });
  });
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: queryKeys.databases.blockViews('db', 'block'),
    exact: true,
  });
});
