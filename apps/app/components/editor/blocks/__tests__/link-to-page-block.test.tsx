import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import { router } from 'expo-router';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import apiClient from '@/lib/api/client';
import { queryKeys } from '@/lib/hooks/query-keys';
import { usePage } from '@/lib/hooks/use-pages';
import type { Block, Page, PageResponse } from '@/lib/types/pages';
import { LinkToPageBlock } from '../link-to-page-block';

jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  const router = { push: jest.fn() };
  return {
    router,
    Link: ({ href, asChild, children }: { href: string; asChild: boolean; children: unknown }) => {
      if (!asChild) throw new Error('The router must delegate its rendering to Bloom');
      return React.cloneElement(children, { href, onPress: () => router.push(href) });
    },
  };
});
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('@/lib/realtime/socket', () => ({ acquireSocket: jest.fn(), releaseSocket: jest.fn() }));
jest.mock('@/components/page-chrome/icon-display', () => ({ IconDisplay: () => null }));
jest.mock('../../page-picker', () => ({ PagePicker: () => null }));

const page = {
  id: '01890000-0000-7000-8000-0000000000aa',
  workspaceId: 'workspace',
  title: 'Private project',
  icon: null,
} as Page;
const key = queryKeys.pages.detail(page.id);
const block = (pageId: string): Block => ({
  id: 'link',
  pageId: page.id,
  parentBlockId: null,
  type: 'link_to_page',
  content: { pageId },
  order: 0,
  createdAt: '',
  updatedAt: '',
});
let renderer: ReactTestRenderer;
let client: QueryClient;
let observed: ReturnType<typeof usePage>;

function PageReader() {
  observed = usePage(page.id);
  return null;
}
async function tick() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function mount(destination = page.id, withReader = true) {
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <QueryClientProvider client={client}>
          {withReader ? <PageReader /> : null}
          <LinkToPageBlock block={block(destination)} onChangeContent={jest.fn()} readOnly />
        </QueryClientProvider>
      </BloomTestProviders>,
    );
  });
  await tick();
}
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: false, retryDelay: 0, gcTime: Infinity },
    },
  });
  client.setQueryData<PageResponse>(key, { page, role: 'editor' });
  jest.mocked(apiClient.get).mockResolvedValue({ data: { page, role: 'editor' } });
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
});

it('opens the named page using the shared cached metadata', async () => {
  await mount();
  expect(JSON.stringify(renderer.toJSON())).toContain(page.title);
  const link = renderer.root.findByProps({ accessibilityRole: 'link' });
  expect(link.props.href).toBe(`/p/${page.id}`);
  expect(link.props.numberOfLines).toBe(1);
  act(() => link.props.onPress());
  expect(router.push).toHaveBeenCalledWith(`/p/${page.id}`);
  expect(apiClient.get).not.toHaveBeenCalled();
});

it.each([401, 403, 404])('retires both readers of the same page after HTTP %s', async (status) => {
  await mount();
  expect(observed.data?.page).toEqual(page);
  expect(client.getQueryCache().find({ queryKey: key })?.getObserversCount()).toBe(2);
  jest
    .mocked(apiClient.get)
    .mockRejectedValue(
      new AxiosError('Unavailable', undefined, undefined, undefined, { status } as AxiosResponse),
    );
  await act(async () => {
    await client.invalidateQueries({ queryKey: key, exact: true });
  });
  await tick();
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(key)).toBeNull();
  expect(observed.data).toBeUndefined();
  expect(renderer.root.findAllByProps({ accessibilityRole: 'link' })).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('editor.blocks.linkToPage.missing');
  expect(JSON.stringify(renderer.toJSON())).not.toContain(page.title);

  // A retry while offline cannot resurrect metadata retired by either reader.
  jest.mocked(apiClient.get).mockRejectedValue(new AxiosError('Network error'));
  await act(async () => {
    await client.refetchQueries({ queryKey: key, exact: true });
  });
  await tick();
  expect(client.getQueryData(key)).toBeNull();
  expect(observed.data).toBeUndefined();
});

it.each(['000000000000000000000000', 'invalid'])(
  'does not fetch unresolved target %s',
  async (id) => {
    await mount(id, false);
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer.toJSON())).toContain('editor.blocks.linkToPage.label');
    expect(renderer.root.findAllByProps({ accessibilityRole: 'link' })).toHaveLength(0);
  },
);
