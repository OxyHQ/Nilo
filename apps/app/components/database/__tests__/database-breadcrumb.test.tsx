import { Children, isValidElement, type ComponentType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import { Breadcrumb, type BreadcrumbItemProps } from '@oxy.so/bloom/breadcrumb';
import { PopoverTrigger } from '@oxy.so/bloom/popover';
import { IdentityPopover } from '@/components/page-chrome/identity-popover';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import apiClient from '@/lib/api/client';
import { queryKeys } from '@/lib/hooks/query-keys';
import { invalidateLiveQueries, useWorkspaceLive } from '@/lib/realtime/use-live-updates';
import type { BreadcrumbEntry, BreadcrumbResponse } from '@/lib/types/pages';
import { DatabaseBreadcrumb } from '../database-breadcrumb';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('@/lib/realtime/socket', () => ({ acquireSocket: jest.fn(), releaseSocket: jest.fn() }));
jest.mock('@/lib/realtime/use-live-updates', () => ({
  ...jest.requireActual('@/lib/realtime/use-live-updates'),
  useWorkspaceLive: jest.fn(),
}));
jest.mock('@/components/page-chrome/icon-display', () => ({ IconDisplay: () => null }));

const Trail = (Breadcrumb as unknown as { type: ComponentType }).type;
const database = {
  id: 'database',
  workspaceId: 'workspace',
  parentPageId: 'parent' as string | null,
  name: 'Projects',
  icon: '📌' as string | null,
};
let renderer: ReactTestRenderer;
let client: QueryClient;
function tree(
  current = database,
  actions: { onRename?: (title: string) => Promise<unknown>; onChooseIcon?: () => void } = {},
) {
  return (
    <QueryClientProvider client={client}>
      <BloomTestProviders>
        <DatabaseBreadcrumb database={current} {...actions} />
      </BloomTestProviders>
    </QueryClientProvider>
  );
}
async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function mount(current = database) {
  await act(async () => {
    renderer = create(tree(current));
  });
  await settle();
}
function crumbs() {
  return Children.toArray(renderer.root.findByType(Trail).props.children).filter(
    isValidElement<BreadcrumbItemProps>,
  );
}
function titles() {
  return crumbs().map((crumb) => crumb.props.children);
}
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  jest.mocked(apiClient.get).mockResolvedValue({
    data: { breadcrumb: [{ id: 'parent', title: 'Shared parent', icon: null }] },
  });
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
});

it('keeps all authorized page destinations, including the parent, before the current database', async () => {
  const authorized: BreadcrumbEntry[] = Array.from({ length: 12 }, (_, index) => ({
    id: index === 11 ? 'parent' : `ancestor-${index}`,
    title: `Authorized ${index}`,
    icon: index === 11 ? '📁' : null,
  }));
  jest.mocked(apiClient.get).mockResolvedValue({ data: { breadcrumb: authorized } });
  await mount();
  expect(renderer.root.findByType(Trail).props.overflow).toBe('collapse');
  expect(titles()).toEqual([...authorized.map((page) => page.title), 'Projects']);
  expect(
    crumbs()
      .slice(0, -1)
      .map((crumb) => crumb.props.href),
  ).toEqual(authorized.map((page) => `/p/${page.id}`));
  for (const crumb of crumbs().slice(0, -1)) act(() => crumb.props.onPress?.());
  expect(mockPush.mock.calls.map(([href]) => href)).toEqual(
    authorized.map((page) => `/p/${page.id}`),
  );
  expect(crumbs().at(-1)?.props).toMatchObject({ current: true });
  expect(crumbs().at(-1)?.props.href).toBeUndefined();
  expect(crumbs().at(-1)?.props.onPress).toBeUndefined();
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.get).toHaveBeenCalledWith('/pages/parent/breadcrumb');
  expect(useWorkspaceLive).toHaveBeenCalledWith('workspace');
});

it('shows only the database at workspace root and never invents a workspace destination', async () => {
  await mount({ ...database, parentPageId: null, name: ' ', icon: null });
  expect(titles()).toEqual(['databases.untitledDatabase']);
  expect(apiClient.get).not.toHaveBeenCalled();
});

it('keeps current metadata visible during loading and failed ancestry reads', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(apiClient.get).mockReturnValue(
    new Promise<{ data: BreadcrumbResponse }>((_resolve, refuse) => {
      reject = refuse;
    }),
  );
  await mount();
  expect(titles()).toEqual(['Projects']);
  await act(async () => reject(new Error('Offline')));
  await settle();
  expect(titles()).toEqual(['Projects']);
  await act(async () => renderer.update(tree({ ...database, name: 'Renamed', icon: '✅' })));
  expect(titles()).toEqual(['Renamed']);
  const icon = crumbs().at(-1)?.props.leading;
  expect(isValidElement<{ value: string }>(icon) && icon.props.value).toBe('✅');
});

it('drops cached ancestry when a permission recheck fails', async () => {
  await mount();
  expect(titles()).toEqual(['Shared parent', 'Projects']);
  jest.mocked(apiClient.get).mockRejectedValue(
    new AxiosError('Forbidden', undefined, undefined, undefined, {
      status: 403,
    } as AxiosResponse),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: queryKeys.pages.breadcrumb('parent', 'workspace') });
  });
  await settle();
  expect(titles()).toEqual(['Projects']);
});

it('refreshes hierarchy for its workspace without refetching other paths or page detail', async () => {
  await mount();
  const unrelated = queryKeys.pages.breadcrumb('other-parent', 'other-workspace');
  client.setQueryData(unrelated, { breadcrumb: [] });
  client.setQueryData(queryKeys.pages.detail('parent'), {
    page: { id: 'parent', workspaceId: 'workspace' },
  });
  jest.mocked(apiClient.get).mockClear();
  jest.mocked(apiClient.get).mockResolvedValue({
    data: {
      breadcrumb: [
        { id: 'new-grandparent', title: 'Moved into', icon: null },
        { id: 'parent', title: 'Renamed parent', icon: null },
      ],
    },
  });
  await act(async () => invalidateLiveQueries(client, 'workspace', 'workspace'));
  await settle();
  expect(titles()).toEqual(['Moved into', 'Renamed parent', 'Projects']);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.get).toHaveBeenCalledWith('/pages/parent/breadcrumb');
  expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
});

it('follows a changed parent key without reusing the old authorized chain', async () => {
  await mount();
  jest.mocked(apiClient.get).mockResolvedValue({
    data: { breadcrumb: [{ id: 'other-parent', title: 'Other parent', icon: null }] },
  });
  await act(async () => renderer.update(tree({ ...database, parentPageId: 'other-parent' })));
  await settle();
  expect(titles()).toEqual(['Other parent', 'Projects']);
  expect(apiClient.get).toHaveBeenLastCalledWith('/pages/other-parent/breadcrumb');
  await act(async () => renderer.update(tree({ ...database, parentPageId: null })));
  expect(titles()).toEqual(['Projects']);
});

it('keeps reader navigation static and supplies a current trigger only to an editable identity', async () => {
  await mount();
  expect(crumbs().every((crumb) => crumb.props.trigger === undefined)).toBe(true);
  expect(renderer.root.findAllByType(IdentityPopover)).toHaveLength(0);
  const onRename = jest.fn().mockResolvedValue(undefined);
  const onChooseIcon = jest.fn();
  await act(async () => renderer.update(tree(database, { onRename, onChooseIcon })));
  expect(crumbs()[0].props.trigger).toBeUndefined();
  const trigger = crumbs().at(-1)?.props.trigger;
  expect(isValidElement(trigger) && trigger.type).toBe(PopoverTrigger);
  expect(crumbs().at(-1)?.props.href).toBeUndefined();
  expect(renderer.root.findByType(IdentityPopover).props).toMatchObject({
    onSave: onRename,
    onChooseIcon,
  });
  await act(async () => renderer.update(tree(database, { onChooseIcon })));
  expect(crumbs().at(-1)?.props.trigger).toBeUndefined();
  expect(renderer.root.findAllByType(IdentityPopover)).toHaveLength(0);
});

it('uses a placeholder for an iconless database without inventing a page file scope', async () => {
  await mount({ ...database, icon: null });
  const icon = crumbs().at(-1)?.props.leading;
  expect(
    isValidElement<{ value: string | null; showPlaceholder: boolean; pageId?: string }>(icon) &&
      icon.props,
  ).toMatchObject({ value: null, showPlaceholder: true });
  expect(isValidElement<{ pageId?: string }>(icon) && icon.props.pageId).toBeUndefined();
});
