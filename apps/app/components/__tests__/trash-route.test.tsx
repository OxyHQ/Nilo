import { AxiosError, AxiosHeaders } from 'axios';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button } from '@oxy.so/bloom/button';
import { toast } from '@oxy.so/bloom/toast';
import TrashRoute from '@/app/(app)/trash';
import { BloomTestProviders } from '@/test-support/bloom-providers';

/** What axios rejects with when the API refuses: its own message is "Request failed…". */
function refused(status: number, data: unknown): AxiosError {
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
      data,
    },
  );
}

let mockError: unknown;
const mockMutate = jest.fn((_input: unknown, options?: { onError?: (error: unknown) => void }) =>
  options?.onError?.(mockError),
);
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ user: { id: 'me' } }) }));
jest.mock('@oxy.so/bloom/toast', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/lib/stores/workspace-store', () => ({
  useWorkspaceStore: (select: (s: { currentWorkspaceId: string }) => unknown) =>
    select({ currentWorkspaceId: 'w' }),
}));
jest.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspace: () => ({ data: { ownerId: 'someone-else' } }),
}));
jest.mock('@/lib/hooks/use-pages', () => ({
  useArchivedPages: () => ({
    data: {
      pages: [{ id: 'p', title: 'Plan', icon: null, ownerId: 'me', updatedAt: '2026-10-19' }],
    },
    isLoading: false,
  }),
  useUpdatePage: () => ({ mutate: mockMutate }),
  useDeletePage: () => ({ mutate: mockMutate }),
  useEmptyTrash: () => ({ mutate: mockMutate, isPending: false }),
}));
jest.mock('@/lib/hooks/use-databases', () => ({
  useArchivedDatabases: () => ({ data: [], isLoading: false }),
  useUpdateDatabase: () => ({ mutate: mockMutate }),
  useDeleteDatabase: () => ({ mutate: mockMutate }),
}));
jest.mock('@/components/page-chrome', () => ({ IconDisplay: () => null }));

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer.unmount()));

const restore = () => {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <TrashRoute />
      </BloomTestProviders>,
    );
  });
  const button = renderer.root
    .findAllByType(Button)
    .find((node) => node.props.accessibilityLabel === 'trash.restorePage');
  act(() => button?.props.onPress());
};

it("says why the API refused, never axios's own text", () => {
  mockError = refused(409, { error: 'The page above it is gone' });
  restore();
  expect(toast.error).toHaveBeenCalledWith('The page above it is gone');
});

it('falls back to its own words when the API gives none', () => {
  mockError = refused(500, {});
  restore();
  expect(toast.error).toHaveBeenCalledWith('pages.toasts.restoreFailed');
});
