import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { ShareButton } from '../share-button';
import { ShareModal } from '../share-modal';

const mockCreateLink = jest.fn();
const mockInvite = jest.fn();
const mockRestrict = jest.fn();
const mockIdle = { isPending: false, isError: false, isSuccess: false, reset: jest.fn() };
jest.mock('../build-share-url', () => ({
  buildShareUrl: (token: string) => `https://nilo.test/s/${token}`,
  buildPublishUrl: (slug: string) => `https://nilo.test/pub/${slug}`,
}));
jest.mock('@/lib/hooks/use-workspace-members', () => ({
  memberProfileName: (grant: { user: { email: string } | null }) => grant.user?.email,
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/hooks/use-pages', () => ({
  usePage: () => ({
    data: {
      page: { id: 'page', title: 'Roadmap', ownerId: 'me', workspaceId: 'w' },
      role: 'admin',
    },
  }),
}));
jest.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspaces: () => ({ data: [{ id: 'w', name: 'Acme' }] }),
}));
jest.mock('@/lib/hooks/use-page-extras', () => ({
  usePublishPage: () => ({ ...mockIdle, mutate: jest.fn() }),
}));
jest.mock('@/lib/hooks/use-share-links', () => ({
  SHARE_LINK_SCOPES: ['read', 'comment', 'edit'],
  useShareLinks: () => ({ data: [], isLoading: false, isError: false }),
  useCreateShareLink: () => ({ mutate: mockCreateLink, isPending: false }),
  useRevokeShareLink: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/hooks/use-page-permissions', () => ({
  usePagePermissions: () => ({
    isLoading: false,
    isError: false,
    data: {
      pageId: 'page',
      restricted: false,
      restrictedFrom: null,
      openToWorkspace: true,
      role: 'admin',
      grants: [
        {
          userId: 'ana',
          user: { email: 'ana@example.test', avatar: null },
          role: 'editor',
          grantedBy: 'me',
          inheritedFrom: null,
          viaShareLink: false,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  }),
  useSharedPages: () => ({ data: undefined }),
  useSharePageByEmail: () => ({ ...mockIdle, mutate: mockInvite }),
  useUpdatePageAccess: () => ({ ...mockIdle, mutate: jest.fn() }),
  useRemovePageAccess: () => ({ ...mockIdle, mutate: jest.fn() }),
  useSetPageRestricted: () => ({ ...mockIdle, mutate: mockRestrict }),
}));

let renderer: ReactTestRenderer;

const byLabel = (label: string, handler: string) =>
  renderer.root.findAll(
    (node) => node.props.accessibilityLabel === label && node.props[handler],
  )[0];
const text = () =>
  renderer.root
    .findAll((node) => typeof node.type === 'string')
    .flatMap((node) => [node.props.children].flat())
    .filter((child) => typeof child === 'string')
    .join(' ');

beforeEach(async () => {
  jest.clearAllMocks();
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <ShareButton pageId="page" />
      </BloomTestProviders>,
    );
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
});

it('opens the share dialog with people, general access and the public link', async () => {
  expect(text()).not.toContain('sharing.modal.anyoneWithLink');
  await act(async () => byLabel('sharing.button.label', 'onPress').props.onPress());
  expect(text()).toContain('sharing.people.title');
  expect(text()).toContain('ana@example.test');
  expect(text()).toContain('sharing.modal.empty');

  await act(async () =>
    byLabel('sharing.people.email', 'onChangeText').props.onChangeText('bo@example.test'),
  );
  await act(async () => byLabel('sharing.people.invite', 'onPress').props.onPress());
  expect(mockInvite).toHaveBeenCalledWith(
    { email: 'bo@example.test', role: 'viewer' },
    expect.anything(),
  );

  await act(async () =>
    byLabel('sharing.general.restrict', 'onCheckedChange').props.onCheckedChange(true),
  );
  expect(mockRestrict).toHaveBeenCalledWith(true);

  await act(async () =>
    byLabel('sharing.modal.anyoneWithLink', 'onCheckedChange').props.onCheckedChange(true),
  );
  expect(mockCreateLink).toHaveBeenCalledWith(
    { scope: 'read', expiresAt: null },
    expect.anything(),
  );
});

it('keeps the open share dialog and invitation draft when the header changes presentation', async () => {
  await act(async () => byLabel('sharing.button.label', 'onPress').props.onPress());
  await act(async () =>
    byLabel('sharing.people.email', 'onChangeText').props.onChangeText('draft@example.test'),
  );
  const share = renderer.root.findByType(ShareButton);
  const modal = renderer.root.findByType(ShareModal);
  for (const compact of [true, false]) {
    await act(async () =>
      renderer.update(
        <BloomTestProviders>
          <ShareButton pageId="page" compact={compact} />
        </BloomTestProviders>,
      ),
    );
    expect(renderer.root.findByType(ShareButton)).toBe(share);
    expect(renderer.root.findByType(ShareModal)).toBe(modal);
    expect(byLabel('sharing.button.label', 'onPress').props.iconOnly).toBe(compact);
    expect(byLabel('sharing.people.email', 'onChangeText').props.value).toBe('draft@example.test');
    expect(text()).toContain('sharing.people.title');
  }
});
