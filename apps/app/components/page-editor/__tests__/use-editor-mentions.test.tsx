import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api/client';
import { useEditorMentions } from '../use-editor-mentions';

jest.mock('@/lib/api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/lib/hooks/use-pages', () => ({
  usePages: () => ({
    data: {
      pages: [
        { id: 'recent', title: 'Recent', updatedAt: '2026-10-15', archived: false },
        { id: 'old', title: 'Old', updatedAt: '2026-10-01', archived: false },
      ],
    },
  }),
}));
jest.mock('@/lib/hooks/use-page-permissions', () => ({
  usePagePermissions: () => ({ data: { openToWorkspace: true, grants: [] } }),
}));
jest.mock('@/lib/hooks/use-workspace-members', () => ({
  useWorkspaceMembers: () => ({ data: [{ userId: 'oxy-user', user: { name: 'José' } }] }),
  memberProfileName: (person: { user: { name: string } }) => person.user.name,
}));
let source: ReturnType<typeof useEditorMentions>;
function Consumer() {
  source = useEditorMentions('page', 'workspace');
  return null;
}
let renderer: ReactTestRenderer;
let client: QueryClient;
beforeEach(async () => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Consumer />
      </QueryClientProvider>,
    );
  });
});
afterEach(() => {
  act(() => renderer.unmount());
  client.clear();
});
it('uses recent pages for empty queries without making an empty search request', async () => {
  const result = await source.search({ indicator: '@', text: '' });
  expect(
    result.filter((item) => item.attributes.kind !== 'date').map((item) => item.attributes.id),
  ).toEqual(['oxy-user', 'recent', 'old']);
  expect(apiClient.get).not.toHaveBeenCalled();
});
it('keeps its source stable across data rerenders', async () => {
  const first = source;
  await act(async () =>
    renderer.update(
      <QueryClientProvider client={client}>
        <Consumer />
      </QueryClientProvider>,
    ),
  );
  expect(source).toBe(first);
});
it('ignores a slow stale answer and sends normalized search through the query cache', async () => {
  let resolveOld!: (value: unknown) => void;
  jest.mocked(apiClient.get).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  jest.mocked(apiClient.get).mockResolvedValueOnce({
    data: { results: [{ page: { id: 'plan', title: 'Planificación' } }] },
  });
  const old = source.search({ indicator: '@', text: 'old' });
  const current = await source.search({ indicator: '@', text: 'PLANIFICACIÓN' });
  expect(current[0].attributes).toEqual({ kind: 'page', id: 'plan' });
  expect(apiClient.get).toHaveBeenLastCalledWith('/search', {
    params: { workspaceId: 'workspace', q: 'planificacion', limit: 50 },
    signal: expect.anything(),
  });
  resolveOld({ data: { results: [{ page: { id: 'stale', title: 'Old' } }] } });
  expect(await old).toEqual([]);
});
it('retains people when page search fails', async () => {
  jest.mocked(apiClient.get).mockRejectedValueOnce(new Error('offline'));
  const result = await source.search({ indicator: '@', text: 'jose' });
  expect(result[0].attributes).toEqual({ kind: 'user', id: 'oxy-user' });
});
