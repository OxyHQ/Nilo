import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@/lib/api/client';
import {
  useTeamspaces,
  useTeamspaceMembers,
  useTeamspaceMutation,
  teamspaceKeys,
  canAddToTeamspace,
  type Teamspace,
} from '../use-teamspaces';
import { queryKeys } from '../query-keys';
import { workspaceMemberKeys } from '../workspace-keys';

jest.mock('@oxy.so/services', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));
let client: QueryClient;
let renderer: ReactTestRenderer;
let mutation: ReturnType<typeof useTeamspaceMutation>;
function Hooks() {
  useTeamspaces('w');
  useTeamspaceMembers('t');
  mutation = useTeamspaceMutation('w');
  return null;
}
beforeEach(async () => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  jest.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: url.endsWith('/members') ? { members: [] } : { teamspaces: [] },
  }));
  jest.mocked(apiClient.post).mockResolvedValue({ data: { teamspace: { id: 't' } } });
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Hooks />
      </QueryClientProvider>,
    );
  });
});
afterEach(() => {
  act(() => renderer.unmount());
  client.clear();
});

it('loads the API lists with separate query keys', () => {
  expect(apiClient.get).toHaveBeenCalledWith('/workspaces/w/teamspaces');
  expect(apiClient.get).toHaveBeenCalledWith('/teamspaces/t/members');
});

it.each([
  { action: 'create', input: { name: 'Team', privacy: 'private' } },
  { action: 'update', id: 't', input: { privacy: 'closed' } },
  { action: 'join', id: 't' },
  { action: 'member', id: 't', userId: 'u', role: 'owner' },
  { action: 'remove', id: 't', userId: 'u' },
] as const)('refreshes placement, membership and access after $action', async (action) => {
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await act(async () => {
    await mutation.mutateAsync(action);
  });
  for (const key of [
    teamspaceKeys.list('w'),
    teamspaceKeys.members('t'),
    workspaceMemberKeys.list('w'),
    queryKeys.pages.list('w'),
    queryKeys.databases.list('w'),
    queryKeys.pages.shared,
    queryKeys.search.workspace('w'),
    ['page'],
    ['database'],
    ['page-permissions'],
  ]) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
  }
  if (action.action === 'create')
    expect(apiClient.post).toHaveBeenCalledWith('/workspaces/w/teamspaces', action.input);
  if (action.action === 'update')
    expect(apiClient.patch).toHaveBeenCalledWith('/teamspaces/t', action.input);
  if (action.action === 'join') expect(apiClient.post).toHaveBeenCalledWith('/teamspaces/t/join');
  if (action.action === 'member')
    expect(apiClient.put).toHaveBeenCalledWith('/teamspaces/t/members/u', { role: 'owner' });
  if (action.action === 'remove')
    expect(apiClient.delete).toHaveBeenCalledWith('/teamspaces/t/members/u');
});

it('does not invalidate on a refused membership change', async () => {
  jest.mocked(apiClient.delete).mockRejectedValue(new Error('last owner'));
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await act(async () => {
    await expect(mutation.mutateAsync({ action: 'remove', id: 't', userId: 'u' })).rejects.toThrow(
      'last owner',
    );
  });
  expect(invalidate).not.toHaveBeenCalled();
});

it('offers open spaces to editors, closed/private spaces to members or admins, and no archived spaces', () => {
  const team = { privacy: 'open', role: null, archived: false } as Teamspace;
  expect(canAddToTeamspace(team, 'viewer')).toBe(false);
  expect(canAddToTeamspace(team, 'editor')).toBe(true);
  expect(canAddToTeamspace({ ...team, privacy: 'closed' }, 'editor')).toBe(false);
  expect(canAddToTeamspace({ ...team, privacy: 'private', role: 'member' }, 'editor')).toBe(true);
  expect(canAddToTeamspace({ ...team, privacy: 'private' }, 'admin')).toBe(true);
  expect(canAddToTeamspace({ ...team, archived: true }, 'owner')).toBe(false);
});
