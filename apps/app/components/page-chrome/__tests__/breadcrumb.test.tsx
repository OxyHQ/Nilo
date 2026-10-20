import { Children, isValidElement, type ComponentType, type ComponentProps } from 'react';
import { Button } from '@oxy.so/bloom/button';
import { Popover, PopoverTrigger } from '@oxy.so/bloom/popover';
import { AxiosError, type AxiosResponse } from 'axios';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Breadcrumb as BloomBreadcrumb,
  BreadcrumbItem,
  type BreadcrumbItemProps,
} from '@oxy.so/bloom/breadcrumb';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import apiClient from '@/lib/api/client';
import { queryKeys } from '@/lib/hooks/query-keys';
import { usePage, useUpdatePage } from '@/lib/hooks/use-pages';
import { invalidateLiveQueries, useWorkspaceLive } from '@/lib/realtime/use-live-updates';
import type { BreadcrumbEntry, BreadcrumbResponse } from '@/lib/types/pages';
import { Breadcrumb } from '../breadcrumb';
import { BreadcrumbNeighbors } from '../breadcrumb-neighbors';
import { IdentityPopover } from '../identity-popover';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/realtime/socket', () => ({ acquireSocket: jest.fn(), releaseSocket: jest.fn() }));
jest.mock('@/lib/realtime/use-live-updates', () => ({
  ...jest.requireActual('@/lib/realtime/use-live-updates'),
  useWorkspaceLive: jest.fn(),
  useDatabaseLive: jest.fn(),
}));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), patch: jest.fn() },
}));
jest.mock('../icon-display', () => ({ IconDisplay: () => null }));
const Trail = (BloomBreadcrumb as unknown as { type: ComponentType }).type;
const Item = (BreadcrumbItem as unknown as { type: ComponentType }).type;
let client: QueryClient;
let renderer: ReactTestRenderer;
const page = { id: 'current', workspaceId: 'shared-workspace', title: 'Current page', icon: null };
function tree(
  currentPage: ComponentProps<typeof Breadcrumb>['currentPage'] = page,
  actions: Pick<ComponentProps<typeof Breadcrumb>, 'onRename' | 'onChooseIcon'> = {},
) {
  return (
    <QueryClientProvider client={client}>
      <BloomTestProviders>
        <Breadcrumb currentPage={currentPage} {...actions} />
      </BloomTestProviders>
    </QueryClientProvider>
  );
}
async function mount(ancestors: BreadcrumbEntry[] = []) {
  jest.mocked(apiClient.get).mockResolvedValue({ data: { breadcrumb: [...ancestors, page] } });
  await act(async () => {
    renderer = create(tree());
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
// Nilo supplies every authorized destination; Bloom owns which ones fit and
// exposes the rest through its tested responsive menu.
function suppliedCrumbs() {
  return Children.toArray(renderer.root.findByType(Trail).props.children).filter(
    isValidElement<BreadcrumbItemProps>,
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
});
it('shows only the authorized guest ancestry and real ancestor destinations without a workspace request', async () => {
  await mount([{ id: 'shared-parent', title: 'Shared parent', icon: null }]);
  const crumbs = suppliedCrumbs();
  expect(crumbs.map((crumb) => crumb.props.children)).toEqual(['Shared parent', 'Current page']);
  expect(crumbs[0].props.href).toBe('/p/shared-parent');
  act(() => crumbs[0].props.onPress?.());
  expect(mockPush).toHaveBeenCalledWith('/p/shared-parent');
  expect(crumbs[1].props.current).toBe(true);
  expect(crumbs[1].props.onPress).toBeUndefined();
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.get).toHaveBeenCalledWith('/pages/current/breadcrumb');
  expect(useWorkspaceLive).toHaveBeenCalledWith('shared-workspace');
});
it('delegates all authorized destinations to Bloom collapse without hiding ancestors in app code', async () => {
  const ancestors = Array.from({ length: 12 }, (_, index) => ({
    id: `ancestor-${index}`,
    title: `Ancestor ${index}`,
    icon: null,
  }));
  await mount(ancestors);
  expect(renderer.root.findByType(Trail).props.overflow).toBe('collapse');
  const crumbs = suppliedCrumbs();
  expect(crumbs).toHaveLength(13);
  expect(crumbs.slice(0, -1).map((crumb) => crumb.props.href)).toEqual(
    ancestors.map((entry) => `/p/${entry.id}`),
  );
  for (const crumb of crumbs.slice(0, -1)) act(() => crumb.props.onPress?.());
  expect(mockPush.mock.calls.map(([href]) => href)).toEqual(
    ancestors.map((entry) => `/p/${entry.id}`),
  );
  expect(crumbs[12].props.current).toBe(true);
  expect(crumbs[12].props.href).toBeUndefined();
});
it('keeps the current page visible while ancestry is loading and after a failed request', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(apiClient.get).mockReturnValue(
    new Promise<{ data: BreadcrumbResponse }>((_resolve, refuse) => {
      reject = refuse;
    }),
  );
  await act(async () => {
    renderer = create(tree());
  });
  expect(renderer.root.findAllByType(Item).map((item) => item.props.children)).toEqual([
    'Current page',
  ]);
  await act(async () => {
    reject(new Error('Offline'));
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(renderer.root.findAllByType(Item).map((item) => item.props.children)).toEqual([
    'Current page',
  ]);
});
it('renders optimistic current-page changes without waiting for the ancestry cache to refresh', async () => {
  await mount();
  await act(async () => renderer.update(tree({ ...page, title: 'Renamed immediately' })));
  expect(renderer.root.findByType(Item).props.children).toBe('Renamed immediately');
});
it('treats a root page as the current item, and labels whitespace titles as untitled', async () => {
  await mount();
  await act(async () => renderer.update(tree({ ...page, title: '  ' })));
  const crumbs = renderer.root.findAllByType(Item);
  expect(crumbs).toHaveLength(1);
  expect(crumbs[0].props.current).toBe(true);
  expect(crumbs[0].props.children).toBe('pages.untitled');
});

it('composes the current editable item with the real Bloom popover trigger only when both actions are available', async () => {
  await mount([{ id: 'ancestor', title: 'Ancestor', icon: null }]);
  expect(suppliedCrumbs().every((crumb) => crumb.props.trigger === undefined)).toBe(true);
  const onRename = jest.fn().mockResolvedValue(undefined);
  const onChooseIcon = jest.fn();
  await act(async () => renderer.update(tree(page, { onRename })));
  expect(renderer.root.findAllByType(IdentityPopover)).toHaveLength(0);
  await act(async () => renderer.update(tree(page, { onRename, onChooseIcon })));
  const entries = suppliedCrumbs();
  expect(entries[0].props.trigger).toBeUndefined();
  expect(isValidElement(entries[1].props.trigger) && entries[1].props.trigger.type).toBe(
    PopoverTrigger,
  );
  expect(entries[1].props.href).toBeUndefined();
  const currentButton = renderer.root
    .findAllByType(Button)
    .find((button) => button.props.accessibilityLabel === 'Current page');
  expect(currentButton).toBeDefined();
  await act(async () => currentButton?.props.onPress?.());
  expect(renderer.root.findByType(Popover).props.open).toBe(true);
  expect(onRename).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
  expect(renderer.root.findByType(IdentityPopover).props.onSave).toBe(onRename);
});

it('renders a row database destination and scopes uploaded page icons only to page entries', async () => {
  jest.mocked(apiClient.get).mockImplementation(async (url) => ({
    data:
      url === '/databases/db'
        ? {
            database: {
              id: 'db',
              name: 'Projects',
              icon: null,
              parentPageId: 'parent',
              workspaceId: page.workspaceId,
            },
            views: [],
            role: 'viewer',
          }
        : { breadcrumb: [{ id: 'parent', title: 'Parent', icon: null }] },
  }));
  await act(async () => {
    renderer = create(tree({ ...page, databaseId: 'db' }));
  });
  await settleRender();
  await settleRender();
  const entries = suppliedCrumbs();
  expect(entries.map((entry) => entry.props.children)).toEqual([
    'Parent',
    'Projects',
    'Current page',
  ]);
  expect(entries.map((entry) => entry.props.href)).toEqual(['/p/parent', '/db/db', undefined]);
  const databaseMenu = entries[1].props.hoverMenu?.content;
  if (typeof databaseMenu !== 'function') throw new Error('Expected database neighbors');
  const databaseContent = databaseMenu({ open: true });
  expect(
    isValidElement<ComponentProps<typeof BreadcrumbNeighbors>>(databaseContent) &&
      databaseContent.props,
  ).toMatchObject({
    enabled: true,
    anchor: { kind: 'database', id: 'db', workspaceId: page.workspaceId },
    parentTitle: 'Parent',
  });

  act(() => entries[1].props.onPress?.());
  expect(mockPush).toHaveBeenCalledWith('/db/db');
  expect(
    entries.map((entry) => {
      const icon = entry.props.leading;
      return isValidElement<{ pageId?: string; showPlaceholder?: boolean }>(icon)
        ? icon.props
        : null;
    }),
  ).toEqual([
    expect.objectContaining({ pageId: 'parent', showPlaceholder: true }),
    expect.objectContaining({ pageId: undefined, showPlaceholder: true }),
    expect.objectContaining({ pageId: 'current', showPlaceholder: true }),
  ]);
});

it('never reveals a database destination to a row-only guest after a failed access check', async () => {
  jest.mocked(apiClient.get).mockRejectedValue(
    new AxiosError('Forbidden', undefined, undefined, undefined, {
      status: 403,
    } as AxiosResponse),
  );
  await act(async () => {
    renderer = create(tree({ ...page, databaseId: 'private-db' }));
  });
  await settleRender();
  expect(suppliedCrumbs().map((entry) => entry.props.children)).toEqual(['Current page']);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.get).toHaveBeenCalledWith('/databases/private-db');
});

let update!: ReturnType<typeof useUpdatePage>;
function PageRoute() {
  const detail = usePage(page.id);
  update = useUpdatePage();
  return <Breadcrumb currentPage={detail.data?.page ?? page} />;
}
async function settleRender() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function mountRoute() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <BloomTestProviders>
          <PageRoute />
        </BloomTestProviders>
      </QueryClientProvider>,
    );
  });
  await settleRender();
}
async function workspaceChanged() {
  await act(async () => invalidateLiveQueries(client, 'workspace', page.workspaceId));
  await settleRender();
}
it('refreshes metadata from its page owner and protects a pending rename until rollback refetches', async () => {
  let serverPage = page;
  jest.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: url.endsWith('/breadcrumb') ? { breadcrumb: [serverPage] } : { page: serverPage },
  }));
  await mountRoute();
  serverPage = { ...page, title: 'Remote rename' };
  await workspaceChanged();
  expect(renderer.root.findByType(Item).props.children).toBe('Remote rename');
  let reject!: (error: Error) => void;
  jest.mocked(apiClient.patch).mockReturnValue(
    new Promise((_resolve, refuse) => {
      reject = refuse;
    }),
  );
  let mutation!: Promise<unknown>;
  await act(async () => {
    mutation = update.mutateAsync({ id: page.id, title: 'Typing locally' }).catch(() => undefined);
  });
  await settleRender();
  expect(renderer.root.findByType(Item).props.children).toBe('Typing locally');
  jest.mocked(apiClient.get).mockClear();
  await workspaceChanged();
  expect(apiClient.get).toHaveBeenCalledWith('/pages/current/breadcrumb');
  expect(apiClient.get).not.toHaveBeenCalledWith(
    '/pages/current',
    expect.objectContaining({ signal: expect.anything() }),
  );
  expect(renderer.root.findByType(Item).props.children).toBe('Typing locally');
  await act(async () => {
    reject(new Error('Save failed'));
    await mutation;
  });
  await settleRender();
  expect(renderer.root.findByType(Item).props.children).toBe('Remote rename');
  expect(apiClient.get).toHaveBeenCalledWith(
    '/pages/current',
    expect.objectContaining({ signal: expect.anything() }),
  );
});
it.each(['success', 'failure'] as const)(
  'keeps remote metadata while toggling a favorite and refreshes changes deferred until %s',
  async (result) => {
    let serverPage = { ...page, favorited: false, locked: false, cover: null as string | null };
    jest.mocked(apiClient.get).mockImplementation(async (url) => ({
      data: url.endsWith('/breadcrumb') ? { breadcrumb: [serverPage] } : { page: serverPage },
    }));
    client.setQueryData(['blocks', page.id], { blocks: [{ id: 'editing' }] });
    await mountRoute();
    serverPage = { ...serverPage, title: 'Remote title', locked: true, cover: 'cover-id' };
    await workspaceChanged();
    expect(renderer.root.findByType(Item).props.children).toBe('Remote title');
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    jest.mocked(apiClient.patch).mockReturnValue(
      new Promise((accept, refuse) => {
        resolve = accept;
        reject = refuse;
      }),
    );
    let mutation!: Promise<unknown>;
    await act(async () => {
      mutation = update.mutateAsync({ id: page.id, favorited: true }).catch(() => undefined);
    });
    await settleRender();
    expect(renderer.root.findByType(Item).props.children).toBe('Remote title');
    serverPage = { ...serverPage, title: 'Updated while saving', locked: false };
    jest.mocked(apiClient.get).mockClear();
    await workspaceChanged();
    expect(apiClient.get).not.toHaveBeenCalledWith(
      '/pages/current',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(renderer.root.findByType(Item).props.children).toBe('Remote title');
    if (result === 'success') serverPage = { ...serverPage, favorited: true };
    await act(async () => {
      if (result === 'success') resolve({ data: { page: serverPage } });
      else reject(new Error('Save failed'));
      await mutation;
    });
    await settleRender();
    expect(renderer.root.findByType(Item).props.children).toBe('Updated while saving');
    expect(client.getQueryData(queryKeys.pages.detail(page.id))).toEqual({ page: serverPage });
    expect(client.getQueryState(['blocks', page.id])?.isInvalidated).toBe(false);
  },
);
it('ignores a metadata response cancelled when a local rename starts', async () => {
  let serverPage = page;
  jest.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: url.endsWith('/breadcrumb') ? { breadcrumb: [serverPage] } : { page: serverPage },
  }));
  await mountRoute();
  let resolveRead!: (value: unknown) => void;
  jest.mocked(apiClient.get).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
  );
  let fetch!: Promise<void>;
  await act(async () => {
    fetch = client.refetchQueries({ queryKey: queryKeys.pages.detail(page.id), exact: true });
  });
  let resolvePatch!: (value: unknown) => void;
  jest.mocked(apiClient.patch).mockReturnValue(
    new Promise((resolve) => {
      resolvePatch = resolve;
    }),
  );
  let mutation!: Promise<unknown>;
  await act(async () => {
    mutation = update.mutateAsync({ id: page.id, title: 'Typing locally' });
  });
  await act(async () => {
    resolveRead({ data: { page: { ...page, title: 'Old in-flight response' } } });
    await fetch;
  });
  await settleRender();
  expect(renderer.root.findByType(Item).props.children).toBe('Typing locally');
  serverPage = { ...page, title: 'Typing locally' };
  await act(async () => {
    resolvePatch({ data: { page: serverPage } });
    await mutation;
  });
  await settleRender();
  expect(renderer.root.findByType(Item).props.children).toBe('Typing locally');
});

it('supplies lazy neighbor menus for the current page and every authorized ancestor', async () => {
  await mount([{ id: 'parent', title: 'Parent', icon: null }]);
  const crumbs = suppliedCrumbs();
  for (const [index, crumb] of crumbs.entries()) {
    const content = crumb.props.hoverMenu?.content;
    if (typeof content !== 'function') throw new Error('Expected lazy neighbor content');
    const closed = content({ open: false });
    const opened = content({ open: true });
    expect(isValidElement(closed) && closed.type).toBe(BreadcrumbNeighbors);
    expect(
      isValidElement<ComponentProps<typeof BreadcrumbNeighbors>>(closed) && closed.props,
    ).toMatchObject({
      enabled: false,
      anchor: {
        kind: 'page',
        id: index === 0 ? 'parent' : 'current',
        workspaceId: page.workspaceId,
      },
      parentTitle: index === 0 ? undefined : 'Parent',
    });
    expect(
      isValidElement<ComponentProps<typeof BreadcrumbNeighbors>>(opened) && opened.props.enabled,
    ).toBe(true);
  }
  // Preparing hover slots must not load any sibling list or change the primary action.
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(crumbs[0].props.href).toBe('/p/parent');
  expect(crumbs[1].props.current).toBe(true);
});
