import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import { TextInput } from 'react-native';
import PageDetailRoute from '@/app/(app)/p/[pageId]';
import { PageEditor } from '@/components/page-editor/page-editor';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import apiClient from '@/lib/api/client';
import { queryKeys } from '@/lib/hooks/query-keys';
import { invalidateLiveQueries } from '@/lib/realtime/use-live-updates';
import type { Page, PageResponse } from '@/lib/types/pages';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ pageId: 'page' }),
  useRouter: () => ({ replace: jest.fn() }),
}));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), patch: jest.fn() },
}));
jest.mock('@/lib/realtime/socket', () => ({ acquireSocket: jest.fn(), releaseSocket: jest.fn() }));
jest.mock('@/lib/hooks/use-route-workspace', () => ({ useRouteWorkspace: jest.fn() }));
jest.mock('@/lib/hooks/use-track-recent-page', () => ({ useTrackRecentPage: jest.fn() }));
jest.mock('@/lib/hooks/use-comments', () => ({ usePageComments: () => ({}) }));
jest.mock('@/lib/hooks/use-databases', () => ({ useDatabase: () => ({}) }));
jest.mock('@/components/page-editor/page-editor', () => ({ PageEditor: jest.fn(() => null) }));
jest.mock('@/components/page-editor/page-editor-context', () => ({
  PageEditorProvider: ({ children }: { children: React.ReactNode }) => children,
  PageEditorToolbar: () => null,
  usePageEditorContext: () => ({ readOnly: false }),
}));
jest.mock('@/components/sharing', () => ({ ShareButton: () => null }));
jest.mock('@/components/comments/comment-panel', () => ({ CommentPanel: () => null }));
jest.mock('@/components/database/row-properties-panel', () => ({ RowPropertiesPanel: () => null }));
jest.mock('../page-actions-menu', () => ({ PageActionsMenu: () => null }));
jest.mock('../breadcrumb', () => ({ Breadcrumb: () => null }));
jest.mock('../favorite-button', () => ({ FavoriteButton: () => null }));
jest.mock('../icon-display', () => ({ IconDisplay: () => null }));
jest.mock('../icon-picker', () => ({ IconPicker: () => null }));
jest.mock('../cover-picker', () => ({ CoverPicker: () => null }));
jest.mock('../page-info', () => ({ PageInfo: () => null }));
jest.mock('../use-cover-media', () => ({ useCoverMedia: () => ({ hasCover: false }) }));
jest.mock('@oxy.so/bloom/app-shell', () => ({
  AppShellPanels: ({
    layout,
  }: {
    layout: { panels: { id: string; content: React.ReactNode }[] };
  }) =>
    layout.panels.map((panel) =>
      require('react').createElement(
        require('react-native').View,
        { key: panel.id },
        panel.content,
      ),
    ),
}));

let renderer: ReactTestRenderer;
let client: QueryClient;
const page = {
  id: 'page',
  workspaceId: 'workspace',
  title: 'Saved title',
  font: 'default',
  mode: 'document',
  locked: false,
  archived: false,
  databaseId: null,
} as Page;
function httpError(status: number) {
  return new AxiosError('Request failed', undefined, undefined, undefined, {
    status,
    data: { code: 'NO_PAGE_ACCESS' },
  } as AxiosResponse);
}
async function tick() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function mount(cached = true) {
  if (cached)
    client.setQueryData<PageResponse>(queryKeys.pages.detail(page.id), { page, role: 'editor' });
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <QueryClientProvider client={client}>
          <PageDetailRoute />
        </QueryClientProvider>
      </BloomTestProviders>,
    );
  });
  await tick();
}
async function workspaceChanged() {
  await act(async () => invalidateLiveQueries(client, 'workspace', page.workspaceId));
  // The real hook retries recoverable reads twice, with a zero test delay.
  for (let i = 0; i < 6; i++) await tick();
}
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retryDelay: 0, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  jest.mocked(apiClient.get).mockResolvedValue({ data: { page, role: 'editor' } });
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
});
it.each([new AxiosError('Network error'), httpError(500)])(
  'preserves the mounted editor and unsaved title during a failed metadata refetch: %s',
  async (error) => {
    await mount();
    const editor = renderer.root.findByType(PageEditor);
    const title = renderer.root.findByType(TextInput);
    act(() => title.props.onChangeText('Unsaved title draft'));
    jest.mocked(apiClient.get).mockRejectedValue(error);
    await workspaceChanged();
    expect(client.getQueryState(queryKeys.pages.detail(page.id))?.status).toBe('error');
    expect(renderer.root.findByType(PageEditor)).toBe(editor);
    expect(renderer.root.findByType(TextInput)).toBe(title);
    expect(title.props.value).toBe('Unsaved title draft');
    expect(apiClient.patch).not.toHaveBeenCalled();
    jest
      .mocked(apiClient.get)
      .mockResolvedValue({ data: { page: { ...page, title: 'Remote title' }, role: 'editor' } });
    await workspaceChanged();
    expect(renderer.root.findByType(PageEditor)).toBe(editor);
    expect(title.props.value).toBe('Unsaved title draft');
  },
);
it.each([401, 403, 404])(
  'removes cached document content immediately when metadata returns %s',
  async (status) => {
    await mount();
    expect(renderer.root.findAllByType(PageEditor)).toHaveLength(1);
    jest.mocked(apiClient.get).mockRejectedValue(httpError(status));
    await workspaceChanged();
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByType(PageEditor)).toHaveLength(0);
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
    expect(client.getQueryState(queryKeys.pages.detail(page.id))?.status).toBe('error');
  },
);
it('still shows the failure state when an initial read fails without a cached document', async () => {
  jest.mocked(apiClient.get).mockRejectedValue(new AxiosError('Network error'));
  await mount(false);
  for (let i = 0; i < 6; i++) await tick();
  expect(client.getQueryState(queryKeys.pages.detail(page.id))?.status).toBe('error');
  expect(renderer.root.findAllByType(PageEditor)).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('pages.loadFailed');
});
