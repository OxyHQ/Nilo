import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
import apiClient from '../api/client';
import { queryKeys } from './query-keys';
import { workspaceMemberKeys } from './workspace-keys';
import { hasRole } from './workspace-roles';
import type { WorkspaceRole } from './use-workspaces';

export type TeamspacePrivacy = 'open' | 'closed' | 'private';
export type TeamspaceRole = 'owner' | 'member';
export interface Teamspace {
  id: string;
  workspaceId: string;
  name: string;
  icon: string | null;
  description: string;
  privacy: TeamspacePrivacy;
  isDefault: boolean;
  archived: boolean;
  role: TeamspaceRole | null;
  createdAt: string;
}
export interface TeamspaceMember {
  userId: string;
  role: TeamspaceRole;
  joinedAt: string;
}
export interface TeamspaceInput {
  name: string;
  icon?: string | null;
  description?: string;
  privacy: TeamspacePrivacy;
}
export const teamspaceKeys = {
  list: (workspaceId: string | null) => ['teamspaces', workspaceId] as const,
  members: (id: string) => ['teamspace-members', id] as const,
};
export function canAddToTeamspace(teamspace: Teamspace, role: WorkspaceRole | undefined) {
  return (
    !teamspace.archived &&
    hasRole(role, 'editor') &&
    (hasRole(role, 'admin') || teamspace.privacy === 'open' || teamspace.role !== null)
  );
}
export function useTeamspaces(workspaceId: string | null) {
  const { isAuthenticated } = useOxy();
  return useQuery({
    queryKey: teamspaceKeys.list(workspaceId),
    queryFn: async () =>
      (await apiClient.get<{ teamspaces: Teamspace[] }>(`/workspaces/${workspaceId}/teamspaces`))
        .data.teamspaces,
    enabled: isAuthenticated && Boolean(workspaceId),
  });
}
export function useTeamspaceMembers(id: string | null) {
  const { isAuthenticated } = useOxy();
  return useQuery({
    queryKey: teamspaceKeys.members(id ?? ''),
    queryFn: async () =>
      (await apiClient.get<{ members: TeamspaceMember[] }>(`/teamspaces/${id}/members`)).data
        .members,
    enabled: isAuthenticated && Boolean(id),
  });
}

type TeamspaceAction =
  | { action: 'create'; input: TeamspaceInput }
  | { action: 'update'; id: string; input: Partial<TeamspaceInput> & { archived?: boolean } }
  | { action: 'join'; id: string }
  | { action: 'member'; id: string; userId: string; role: TeamspaceRole }
  | { action: 'remove'; id: string; userId: string };

/** Every membership/privacy change can change which trees the caller can open. */
export function useTeamspaceMutation(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (action: TeamspaceAction) => {
      if (action.action === 'create') {
        return (
          await apiClient.post<{ teamspace: Teamspace }>(
            `/workspaces/${workspaceId}/teamspaces`,
            action.input,
          )
        ).data.teamspace;
      }
      const url = `/teamspaces/${action.id}`;
      switch (action.action) {
        case 'update':
          await apiClient.patch(url, action.input);
          break;
        case 'join':
          await apiClient.post(`${url}/join`);
          break;
        case 'member':
          await apiClient.put(`${url}/members/${action.userId}`, { role: action.role });
          break;
        case 'remove':
          await apiClient.delete(`${url}/members/${action.userId}`);
          break;
      }
      return undefined;
    },
    onSuccess: async (created, action) => {
      const id = action.action === 'create' ? created?.id : action.id;
      await Promise.all([
        client.invalidateQueries({ queryKey: teamspaceKeys.list(workspaceId) }),
        ...(id ? [client.invalidateQueries({ queryKey: teamspaceKeys.members(id) })] : []),
        client.invalidateQueries({ queryKey: workspaceMemberKeys.list(workspaceId) }),
        client.invalidateQueries({ queryKey: queryKeys.pages.list(workspaceId) }),
        client.invalidateQueries({ queryKey: queryKeys.pages.shared }),
        client.invalidateQueries({ queryKey: queryKeys.databases.list(workspaceId) }),
        client.invalidateQueries({ queryKey: queryKeys.search.workspace(workspaceId) }),
        client.invalidateQueries({ queryKey: ['page'] }),
        client.invalidateQueries({ queryKey: ['page-permissions'] }),
        client.invalidateQueries({ queryKey: ['database'] }),
      ]);
    },
  });
}
