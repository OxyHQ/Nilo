import type React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { AcceptInvitation } from '../accept-invitation';

const mockReplace = jest.fn();
const mockOpenDialog = jest.fn();
const mockSetWorkspace = jest.fn();
const mockAccept = jest.fn();
const mockToast = jest.fn();
let mockAuthenticated = false;
let mockPreview: { isPending: boolean; data?: unknown; error?: unknown } = { isPending: true };
let mockAcceptState: { isPending: boolean; isError: boolean; error: unknown } = {
  isPending: false,
  isError: false,
  error: null,
};

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: mockAuthenticated, openAccountDialog: mockOpenDialog }),
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { success: (m: string) => mockToast(m) } }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join('|')}` : key,
  }),
}));
jest.mock('@/components/workspace/workspace-avatar', () => ({ WorkspaceAvatar: () => null }));
jest.mock('@/lib/stores/workspace-store', () => ({
  useWorkspaceStore: (pick: (s: { setCurrentWorkspaceId: () => void }) => unknown) =>
    pick({ setCurrentWorkspaceId: mockSetWorkspace }),
}));
jest.mock('@/lib/hooks/use-workspace-admin', () => ({
  useInvitationPreview: () => mockPreview,
  useAcceptInvitation: () => ({ mutate: mockAccept, ...mockAcceptState }),
}));

/** An axios-shaped refusal, as the API answers a dead link. */
function refusal(status: number, reason?: string) {
  return { isAxiosError: true, response: { status, data: { error: 'refused', reason } } };
}

let renderer: ReactTestRenderer | undefined;
const mount = (node: React.ReactNode) =>
  act(() => {
    renderer = create(<BloomTestProviders>{node}</BloomTestProviders>);
  });
const text = () => JSON.stringify(renderer?.toJSON());
const pressable = (label: string) => {
  const found = (renderer as ReactTestRenderer).root.findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function',
  )[0];
  if (!found) throw new Error(`nothing labelled ${label}`);
  return found;
};

const preview = {
  isPending: false,
  data: { workspace: { id: 'ws1', name: 'Product', avatar: null }, role: 'editor' },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthenticated = false;
  mockPreview = { isPending: true };
  mockAcceptState = { isPending: false, isError: false, error: null };
});
afterEach(() => {
  act(() => renderer?.unmount());
});

describe('an invitation link', () => {
  it('says which workspace and role, and asks a signed-out reader to sign in or sign up', () => {
    mockPreview = preview;
    mount(<AcceptInvitation token="tok" />);
    expect(text()).toContain('workspace.acceptInvite.title:Product');
    expect(text()).toContain('workspace.acceptInvite.signIn');
    act(() => pressable('login.signInButton').props.onPress());
    expect(mockOpenDialog).toHaveBeenCalled();
    expect(() => pressable('workspace.acceptInvite.submit')).toThrow();
  });

  it('is accepted signed in, and opens the workspace it joined', () => {
    mockAuthenticated = true;
    mockPreview = preview;
    mount(<AcceptInvitation token="tok" />);
    act(() => pressable('workspace.acceptInvite.submit').props.onPress());
    expect(mockAccept).toHaveBeenCalledWith('tok', expect.anything());
    const { onSuccess } = mockAccept.mock.calls[0][1];
    act(() => onSuccess({ workspaceId: 'ws1', role: 'editor', joined: true }));
    expect(mockToast).toHaveBeenCalledWith('workspace.acceptInvite.joined:Product');
    expect(mockSetWorkspace).toHaveBeenCalledWith('ws1');
    expect(mockReplace).toHaveBeenCalledWith('/(app)');
  });

  it.each([
    ['never made', refusal(404), 'workspace.acceptInvite.notFoundTitle'],
    ['expired', refusal(410, 'expired'), 'workspace.acceptInvite.expiredTitle'],
    ['already accepted', refusal(410, 'accepted'), 'workspace.acceptInvite.acceptedTitle'],
  ])('explains a link %s', (_label, error, title) => {
    mockPreview = { isPending: false, error };
    mount(<AcceptInvitation token="tok" />);
    expect(text()).toContain(title);
    expect(() => pressable('workspace.acceptInvite.submit')).toThrow();
  });

  it('explains a link someone else accepted meanwhile, and offers Nilo to a signed-in reader', () => {
    mockAuthenticated = true;
    mockPreview = preview;
    mockAcceptState = { isPending: false, isError: true, error: refusal(410, 'accepted') };
    mount(<AcceptInvitation token="tok" />);
    expect(text()).toContain('workspace.acceptInvite.acceptedTitle');
    act(() => pressable('workspace.acceptInvite.open').props.onPress());
    expect(mockReplace).toHaveBeenCalledWith('/(app)');
  });

  it('is not found without a token', () => {
    mount(<AcceptInvitation token={null} />);
    expect(text()).toContain('workspace.acceptInvite.notFoundTitle');
  });
});
