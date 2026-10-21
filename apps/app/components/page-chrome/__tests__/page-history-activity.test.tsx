import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dialog } from '@oxy.so/bloom/dialog';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import apiClient from '@/lib/api/client';
import { queryKeys } from '@/lib/hooks/query-keys';
import type { Page } from '@/lib/types/pages';
import { PageHistoryDialog } from '../page-history-dialog';

jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('@/lib/config', () => ({
  __esModule: true,
  default: { apiUrl: 'https://api.example.test' },
}));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/realtime/use-live-updates', () => ({ useWorkspaceLive: jest.fn() }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
// Dialog animation/portaling and document block rendering are separate owners.
// History selection, live access queries and restore actions run unchanged.
jest.mock('@oxy.so/bloom/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => children,
  useDialogControl: () => ({}),
}));
jest.mock('@/components/sharing/shared-block-renderer', () => ({ SharedBlockTree: () => null }));
const page = { id: 'page', workspaceId: 'workspace', font: 'default', fullWidth: false } as Page;
const versions = [
  { id: 'v1', createdBy: 'owner', createdAt: '2026-10-21T12:00:00Z', blockCount: 1 },
  { id: 'v2', createdBy: 'owner', createdAt: '2026-10-20T12:00:00Z', blockCount: 2 },
];
let client: QueryClient;
let renderer: ReactTestRenderer;
let role: 'viewer' | 'commenter' | 'editor';
async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}
async function mount() {
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <QueryClientProvider client={client}>
          <PageHistoryDialog page={page} initialVersionId="v2" onClose={jest.fn()} />
        </QueryClientProvider>
      </BloomTestProviders>,
    );
  });
  await settle();
}
beforeEach(() => {
  role = 'editor';
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  jest.mocked(apiClient.get).mockImplementation(async (url) => {
    if (url === '/pages/page') return { data: { page, role } };
    if (url === '/pages/page/versions') return { data: { versions } };
    if (url === '/workspaces/workspace/members') return { data: { members: [] } };
    if (url === '/pages/page/versions/v2') return { data: { version: versions[1], blocks: [] } };
    throw new Error(`Unexpected request ${url}`);
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
});

it('opens the version selected in activity for an editor', async () => {
  await mount();
  expect(apiClient.get).toHaveBeenCalledWith('/pages/page/versions/v2', expect.any(Object));
  expect(apiClient.get).not.toHaveBeenCalledWith('/pages/page/versions/v1', expect.any(Object));
  expect(renderer.root.findByType(Dialog).props.actions[0]).toMatchObject({ disabled: false });
  expect(apiClient.post).not.toHaveBeenCalled();
});

it.each(['viewer', 'commenter'] as const)(
  'does not request or reveal history to a %s, even with cached versions',
  async (value) => {
    role = value;
    client.setQueryData(queryKeys.versions.list(page.id), { versions });
    client.setQueryData(queryKeys.versions.detail(page.id, 'v2'), {
      version: versions[1],
      blocks: [{ id: 'private-history' }],
    });
    await mount();
    expect(renderer.root.findAllByType(Dialog)).toHaveLength(0);
    expect(
      jest.mocked(apiClient.get).mock.calls.filter(([url]) => String(url).includes('/versions')),
    ).toHaveLength(0);
    expect(client.getQueryData(queryKeys.versions.list(page.id))).toBeNull();
    expect(client.getQueryData(queryKeys.versions.detail(page.id, 'v2'))).toBeNull();
  },
);

it('revokes restore permission while an editor is in the confirmation step', async () => {
  role = 'editor';
  await mount();
  expect(renderer.root.findByType(Dialog).props.actions[0].disabled).toBe(false);
  act(() => renderer.root.findByType(Dialog).props.actions[0].onPress());
  const staleRestore = renderer.root.findByType(Dialog).props.actions[0].onPress;
  role = 'viewer';
  await act(async () =>
    client.invalidateQueries({ queryKey: queryKeys.pages.detail(page.id), exact: true }),
  );
  await settle();
  expect(renderer.root.findAllByType(Dialog)).toHaveLength(0);
  expect(client.getQueryData(queryKeys.versions.list(page.id))).toBeNull();
  expect(client.getQueryData(queryKeys.versions.detail(page.id, 'v2'))).toBeNull();
  await act(async () => staleRestore());
  expect(apiClient.post).not.toHaveBeenCalled();
});
