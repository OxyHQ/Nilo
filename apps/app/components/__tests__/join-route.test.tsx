import { AxiosError, AxiosHeaders } from 'axios';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import JoinWorkspaceRoute from '@/app/join/[token]';
import { BloomTestProviders } from '@/test-support/bloom-providers';

function refused(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    config,
    null,
    {
      status,
      statusText: '',
      headers: {},
      config,
      data: {},
    },
  );
}

const mockReplace = jest.fn();
const mockSetWorkspace = jest.fn();
const mockSignIn = jest.fn();
let mockAuthenticated = true;
let mockPreview: { data?: unknown; error: unknown; isPending: boolean };
let mockJoin: { mutate: jest.Mock; isPending: boolean; isError: boolean; error: unknown };

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => ({ token: 'tok' }),
}));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: mockAuthenticated, openAccountDialog: mockSignIn, user: null }),
}));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join('|')}` : key,
  }),
}));
jest.mock('@/lib/stores/workspace-store', () => ({
  useWorkspaceStore: (select: (s: { setCurrentWorkspaceId: jest.Mock }) => unknown) =>
    select({ setCurrentWorkspaceId: mockSetWorkspace }),
}));
jest.mock('@/lib/hooks/use-workspace-admin', () => ({
  useInviteLinkPreview: () => mockPreview,
  useJoinWorkspace: () => mockJoin,
}));

let renderer: ReactTestRenderer | undefined;
const mount = () =>
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <JoinWorkspaceRoute />
      </BloomTestProviders>,
    );
  });
const text = () => JSON.stringify(renderer?.toJSON());
const button = (label: string) =>
  (renderer as ReactTestRenderer).root.findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function',
  )[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthenticated = true;
  mockPreview = {
    data: { workspace: { id: 'w1', name: 'Acme', avatar: null }, role: 'editor' },
    error: null,
    isPending: false,
  };
  mockJoin = {
    mutate: jest.fn((_token: string, options?: { onSuccess?: (r: unknown) => void }) =>
      options?.onSuccess?.({ workspaceId: 'w1', role: 'editor', joined: true }),
    ),
    isPending: false,
    isError: false,
    error: null,
  };
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

it('says what the link leads to, then joins and opens the workspace', () => {
  mount();
  expect(text()).toContain('workspace.join.title:Acme');
  act(() => button('workspace.join.submit').props.onPress());
  expect(mockJoin.mutate).toHaveBeenCalledWith('tok', expect.anything());
  expect(mockSetWorkspace).toHaveBeenCalledWith('w1');
  expect(mockReplace).toHaveBeenCalledWith('/(app)');
});

it('asks someone signed out to sign in first', () => {
  mockAuthenticated = false;
  mount();
  expect(button('workspace.join.submit')).toBeUndefined();
  act(() => button('login.signInButton').props.onPress());
  expect(mockSignIn).toHaveBeenCalled();
});

it('tells a disabled link from one that never was', () => {
  mockPreview = { error: refused(410), isPending: false };
  mount();
  expect(text()).toContain('workspace.join.disabledTitle');
  act(() => renderer?.unmount());

  mockPreview = { error: refused(404), isPending: false };
  mount();
  expect(text()).toContain('workspace.join.notFoundTitle');
});
