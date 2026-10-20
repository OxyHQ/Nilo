import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import apiClient from '@/lib/api/client';
import { InlineDatabaseBlock } from '../inline-database-block';
import { DatabaseViewContainer } from '@/components/database/database-view';
import { ViewTab } from '@/components/database/database-header';
import type { Block } from '@/lib/types/pages';

const mockPush = jest.fn();
let sourceRole = 'viewer';
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/lib/realtime/use-live-updates', () => ({ useDatabaseLive: jest.fn() }));
jest.mock('@/lib/hooks/use-pages', () => ({
  usePage: () => ({ data: { page: { workspaceId: 'workspace' } } }),
}));
jest.mock('@/components/page-editor/page-editor-context', () => ({
  usePageEditorContext: () => ({ status: 'saved' }),
}));
jest.mock('@/components/database/database-actions-menu', () => ({
  DatabaseActionsMenu: () => null,
}));
jest.mock('@/components/database/database-view', () => ({ DatabaseViewContainer: () => null }));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
let renderer: ReactTestRenderer;
let client: QueryClient;
const block = {
  id: 'block',
  pageId: 'page',
  type: 'inline_database',
  content: { databaseId: 'db' },
} as Block;
const own = { id: 'own', name: 'Own', type: 'table' };
const linked = { id: 'linked', name: 'Linked', type: 'table', blockId: 'block' };
const tick = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
};
async function mount(readOnly = false) {
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <QueryClientProvider client={client}>
          <InlineDatabaseBlock block={block} onChangeContent={jest.fn()} readOnly={readOnly} />
        </QueryClientProvider>
      </BloomTestProviders>,
    );
  });
  await tick();
  await tick();
}
beforeEach(() => {
  jest.clearAllMocks();
  sourceRole = 'viewer';
  client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity }, mutations: { gcTime: Infinity } },
  });
  jest.mocked(apiClient.get).mockImplementation(async (url) => {
    if (url === '/databases/db')
      return {
        data: {
          database: { id: 'db', name: 'Source database', parentPageId: 'source' },
          views: [own],
          role: sourceRole,
        },
      };
    if (url === '/databases/db/views') return { data: { views: [linked] } };
    return { data: { rows: [], total: 0, cursor: null } };
  });
});
afterEach(() => {
  act(() => renderer.unmount());
  client.clear();
});
it('shows a quiet no-access state when the source returns 403 without loading its views or rows', async () => {
  const error = new AxiosError('Forbidden');
  Object.assign(error, { response: { status: 403 } });
  jest.mocked(apiClient.get).mockRejectedValue(error);
  await mount();
  expect(JSON.stringify(renderer.toJSON())).toContain('editor.inlineDatabase.noAccess');
  expect(renderer.root.findAllByType(DatabaseViewContainer)).toHaveLength(0);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.post).not.toHaveBeenCalled();
});
it('shows the source name and link and allows view editing with read-only source access', async () => {
  await mount();
  expect(JSON.stringify(renderer.toJSON())).toContain('Source database');
  const view = renderer.root.findByType(DatabaseViewContainer);
  expect(view.props.view.id).toBe('linked');
  expect(view.props.readOnly).toBe(true);
  expect(view.props.viewsReadOnly).toBe(false);
  expect(renderer.root.findByType(ViewTab).props.readOnly).toBe(false);
  const open = renderer.root.findAllByProps({ accessibilityRole: 'link' })[0];
  act(() => open.props.onPress());
  expect(mockPush).toHaveBeenCalledWith('/db/db');
});
it('hides editing controls for page viewers even if the source is editable', async () => {
  sourceRole = 'editor';
  await mount(true);
  const view = renderer.root.findByType(DatabaseViewContainer);
  expect(view.props.readOnly).toBe(true);
  expect(view.props.viewsReadOnly).toBe(true);
  expect(renderer.root.findByType(ViewTab).props.readOnly).toBe(true);
});
