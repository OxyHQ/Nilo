import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dialog } from '@oxy.so/bloom/dialog';
import { Button } from '@oxy.so/bloom/button';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import apiClient from '@/lib/api/client';
import { queryKeys } from '@/lib/hooks/query-keys';
import type { Page } from '@/lib/types/pages';
import { PageHistoryDialog, historyVersionTime } from '../page-history-dialog';

const mockGetProfiles = jest.fn();

jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('@/lib/config', () => ({
  __esModule: true,
  default: { apiUrl: 'https://api.example.test' },
}));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({
    isAuthenticated: true,
    oxyServices: { users: { getMany: mockGetProfiles } },
  }),
}));
jest.mock('@/lib/realtime/use-live-updates', () => ({ useWorkspaceLive: jest.fn() }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
// Dialog animation/portaling and document block rendering are separate owners.
// History selection, live access queries and restore actions run unchanged.
jest.mock('@oxy.so/bloom/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => children,
  useDialogControl: () => ({}),
}));
jest.mock('@/components/sharing/shared-block-renderer', () => ({ SharedBlockTree: () => null }));
jest.mock('@oxy.so/bloom/app-shell', () => ({
  AppShellPanels: ({ children }: { children: React.ReactNode }) => children,
  AppShellPanel: ({ children }: { children: React.ReactNode }) => children,
  useAppShellPanel: () => ({ alone: false, framed: false }),
}));
jest.mock('@oxy.so/bloom/screen', () => ({
  Screen: ({
    header,
    children,
    bottomBar,
  }: {
    header: React.ReactNode;
    children: React.ReactNode;
    bottomBar?: React.ReactNode;
  }) => (
    <>
      {header}
      {children}
      {bottomBar}
    </>
  ),
  ScreenScrollView: ({ children }: { children: React.ReactNode }) => children,
}));

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
  mockGetProfiles.mockResolvedValue([{ id: 'owner', name: { displayName: 'Page author' } }]);
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  jest.mocked(apiClient.get).mockImplementation(async (url) => {
    if (url === '/pages/page') return { data: { page, role } };
    if (url === '/pages/page/versions') return { data: { versions } };
    if (url === '/pages/page/versions/v2') return { data: { version: versions[1], blocks: [] } };
    throw new Error(`Unexpected request ${url}`);
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
});

function beginRestore() {
  return renderer.root.find(
    (node) => node.type === Button && node.props.children === 'pages.history.beginRestore',
  );
}

it('opens the version selected in activity for an editor', async () => {
  await mount();
  expect(apiClient.get).toHaveBeenCalledWith('/pages/page/versions/v2', expect.any(Object));
  expect(apiClient.get).not.toHaveBeenCalledWith('/pages/page/versions/v1', expect.any(Object));
  expect(beginRestore().props).toMatchObject({ disabled: false });
  expect(apiClient.post).not.toHaveBeenCalled();
});

it('hydrates historical authors for a page-only editor without requesting workspace membership', async () => {
  await mount();
  expect(mockGetProfiles).toHaveBeenCalledWith(['owner']);
  const rows = renderer.root.findAll(
    (node) => node.props.accessibilityHint === 'pages.history.preview' && node.props.title,
  );
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => row.props.subtitle === 'Page author')).toBe(true);
  expect(
    jest.mocked(apiClient.get).mock.calls.some(([url]) => String(url).includes('/members')),
  ).toBe(false);
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
  expect(beginRestore().props.disabled).toBe(false);
  act(() => beginRestore().props.onPress());
  const staleRestore = renderer.root.find(
    (node) => node.type === Button && node.props.children === 'pages.history.restore',
  ).props.onPress;
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

it('formats distinct saved times and handles an invalid snapshot date', () => {
  const a = historyVersionTime('2026-10-21T12:00:00Z', 'en', 'Unknown date');
  const b = historyVersionTime('2026-10-21T12:01:00Z', 'en', 'Unknown date');
  expect(a).not.toBe(b);
  expect(a).toContain('2026');
  expect(historyVersionTime('invalid', 'es', 'Fecha desconocida')).toBe('Fecha desconocida');
});
