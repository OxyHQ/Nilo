import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import type {
  WorkspaceGuest,
  WorkspaceInvite,
  WorkspaceInviteLink,
} from '@/lib/hooks/use-workspace-admin';
import {
  GuestsSection,
  InviteLinkSection,
  PendingInvitesSection,
} from '../workspace-access-sections';

const mockPush = jest.fn();
const mockConfirm = jest.fn(async (_options: unknown) => true);
const mockCopy = jest.fn(async (_text: string) => true);
const mockMutations = {
  link: jest.fn(),
  revoke: jest.fn(),
  removeGuest: jest.fn(),
};
let mockLink: WorkspaceInviteLink | null = null;
let mockInvites: WorkspaceInvite[] = [];
let mockGuests: WorkspaceGuest[] = [];

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/hooks/use-workspace-members', () => ({
  memberProfileName: (m: { user: { name?: { full?: string } } | null }) =>
    m.user?.name?.full ?? null,
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: (text: string) => mockCopy(text) }));
jest.mock('@oxy.so/bloom/surfaces', () => ({
  confirm: (options: unknown) => mockConfirm(options),
}));
jest.mock('@/components/page-chrome/icon-display', () => ({ IconDisplay: () => null }));
jest.mock('@/components/settings/settings-provider', () => ({
  useNiloSettings: () => ({ close: jest.fn(), afterClose: (run: () => void) => run() }),
}));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join('|')}` : key,
  }),
}));
jest.mock('@/lib/hooks/use-workspace-admin', () => ({
  INVITE_LINK_ROLES: ['editor', 'commenter', 'viewer'],
  useInviteLink: () => ({ data: mockLink, isLoading: false }),
  useUpdateInviteLink: () => ({ mutate: mockMutations.link, isPending: false }),
  usePendingInvites: () => ({ data: mockInvites }),
  useRevokeInvite: () => ({ mutate: mockMutations.revoke, isPending: false }),
  useWorkspaceGuests: () => ({ data: mockGuests, isLoading: false, isError: false }),
  useRemoveGuest: () => ({ mutate: mockMutations.removeGuest, isPending: false }),
}));

let renderer: ReactTestRenderer | undefined;
const mount = (node: React.ReactNode) =>
  act(() => {
    renderer = create(<BloomTestProviders>{node}</BloomTestProviders>);
  });
const root = () => (renderer as ReactTestRenderer).root;
const text = () => JSON.stringify(renderer?.toJSON());
const pressable = (label: string) => {
  const found = root().findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      (typeof node.props.onPress === 'function' ||
        typeof node.props.onCheckedChange === 'function'),
  )[0];
  if (!found) throw new Error(`nothing labelled ${label}`);
  return found;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLink = null;
  mockInvites = [];
  mockGuests = [];
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('the invite link', () => {
  it('is enabled with the role chosen', () => {
    mount(<InviteLinkSection workspaceId="w" />);
    act(() => pressable('workspace.inviteLink.enable').props.onCheckedChange(true));
    expect(mockMutations.link).toHaveBeenCalledWith(
      { action: 'create', role: 'editor' },
      expect.anything(),
    );
  });

  it('is copied, regenerated after confirming, and disabled', async () => {
    mockLink = {
      id: 'l',
      token: 'tok',
      url: 'https://nilo.so/join/tok',
      role: 'viewer',
      createdBy: 'me',
      createdAt: '2026-10-20T00:00:00Z',
    };
    mount(<InviteLinkSection workspaceId="w" />);
    expect(text()).toContain('https://nilo.so/join/tok');

    await act(async () => pressable('workspace.inviteLink.copy').props.onPress());
    expect(mockCopy).toHaveBeenCalledWith('https://nilo.so/join/tok');

    await act(async () => pressable('workspace.inviteLink.regenerate').props.onPress());
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockMutations.link).toHaveBeenLastCalledWith(
      { action: 'create', role: 'viewer' },
      expect.anything(),
    );

    act(() => pressable('workspace.inviteLink.enable').props.onCheckedChange(false));
    expect(mockMutations.link).toHaveBeenLastCalledWith({ action: 'disable' }, expect.anything());
  });
});

describe('pending invitations', () => {
  it('are hidden when there are none', () => {
    mount(<PendingInvitesSection workspaceId="w" />);
    expect(text()).not.toContain('workspace.pendingInvites');
  });

  it('are listed with their role or expiry, and revoked', () => {
    mockInvites = [
      {
        id: 'i1',
        email: 'new@example.com',
        role: 'editor',
        invitedBy: 'me',
        createdAt: '2026-10-20T00:00:00Z',
        expiresAt: '2026-11-19T00:00:00Z',
        expired: false,
        url: 'https://nilo.so/invite/tok-new',
      },
      {
        id: 'i2',
        email: 'late@example.com',
        role: 'viewer',
        invitedBy: 'me',
        createdAt: '2026-09-01T00:00:00Z',
        expiresAt: '2026-10-01T00:00:00Z',
        expired: true,
        url: 'https://nilo.so/invite/tok-late',
      },
    ];
    mount(<PendingInvitesSection workspaceId="w" />);
    expect(text()).toContain('new@example.com');
    expect(text()).toContain('workspace.pendingInvites.expired');
    act(() => pressable('workspace.pendingInvites.revokeFor:new@example.com').props.onPress());
    expect(mockMutations.revoke).toHaveBeenCalledWith('i1', expect.anything());
  });

  it('each copy their own link, but an expired one or one with no link offers none', async () => {
    mockInvites = [
      {
        id: 'i1',
        email: 'new@example.com',
        role: 'editor',
        invitedBy: 'me',
        createdAt: '2026-10-20T00:00:00Z',
        expiresAt: '2026-11-19T00:00:00Z',
        expired: false,
        url: 'https://nilo.so/invite/tok-new',
      },
      {
        id: 'i2',
        email: 'late@example.com',
        role: 'viewer',
        invitedBy: 'me',
        createdAt: '2026-09-01T00:00:00Z',
        expiresAt: '2026-10-01T00:00:00Z',
        expired: true,
        url: 'https://nilo.so/invite/tok-late',
      },
      {
        id: 'i3',
        email: 'old@example.com',
        role: 'viewer',
        invitedBy: 'me',
        createdAt: '2026-10-10T00:00:00Z',
        expiresAt: '2026-11-09T00:00:00Z',
        expired: false,
        url: null,
      },
    ];
    mount(<PendingInvitesSection workspaceId="w" />);
    await act(async () => {
      await pressable('workspace.pendingInvites.copyFor:new@example.com').props.onPress();
    });
    expect(mockCopy).toHaveBeenCalledWith('https://nilo.so/invite/tok-new');
    expect(() => pressable('workspace.pendingInvites.copyFor:late@example.com')).toThrow();
    expect(() => pressable('workspace.pendingInvites.copyFor:old@example.com')).toThrow();
  });
});

describe('guests', () => {
  it('lists each guest with the pages shared with them, and removes one', async () => {
    mockGuests = [
      {
        userId: 'g1',
        user: {
          id: 'g1',
          username: 'grace',
          email: 'grace@example.com',
          name: { full: 'Grace Hopper' },
          avatar: null,
        },
        pages: [
          {
            pageId: 'p1',
            title: 'Roadmap',
            icon: null,
            role: 'commenter',
            grantedBy: 'me',
            sharedAt: '2026-10-20T00:00:00Z',
          },
        ],
      },
    ];
    mount(<GuestsSection workspaceId="w" />);
    expect(text()).toContain('Grace Hopper');
    expect(text()).toContain('Roadmap');

    act(() => pressable('pages.openPage:Roadmap').props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/p/p1');

    act(() => pressable('workspace.members.moreActions:Grace Hopper').props.onPress());
    const remove = root().findAll(
      (node) => node.props.children === 'workspace.guests.remove' && node.props.onPress,
    )[0];
    await act(async () => remove.props.onPress());
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockMutations.removeGuest).toHaveBeenCalledWith('g1', expect.anything());
  });

  it('says so when there are none', () => {
    mount(<GuestsSection workspaceId="w" />);
    expect(text()).toContain('workspace.guests.empty');
  });
});
