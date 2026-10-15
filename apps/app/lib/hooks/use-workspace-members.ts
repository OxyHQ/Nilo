import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services';
import apiClient from '../api/client';
import { workspaceMemberKeys } from './workspace-keys';
import type { WorkspaceRole } from './use-workspaces';

export interface WorkspaceMemberUser {
  id: string;
  username: string | null;
  email: string | null;
  name: {
    first?: string;
    last?: string;
    full?: string;
  } | null;
  avatar: string | null;
}

/** A workspace member. A member is identified by its Oxy `userId`. */
export interface WorkspaceMember {
  userId: string;
  role: WorkspaceRole;
  invitedBy: string | null;
  joinedAt: string;
  /**
   * The Oxy profile the list endpoint hydrates in one batch lookup. Null when
   * that lookup failed; absent on invite/role-change responses.
   */
  user?: WorkspaceMemberUser | null;
}

/**
 * The name to show for a member: the profile's full name, else first/last,
 * else username, else email; `null` when Oxy returned no profile.
 */
export function memberProfileName(member: Pick<WorkspaceMember, 'user'>): string | null {
  const profile = member.user;
  if (!profile) return null;
  const full = profile.name?.full?.trim();
  if (full) return full;
  const parts = [profile.name?.first?.trim(), profile.name?.last?.trim()].filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  return profile.username ?? profile.email ?? null;
}

export interface InviteMemberInput {
  email: string;
  role: WorkspaceRole;
}

export interface UpdateMemberRoleInput {
  userId: string;
  role: WorkspaceRole;
}

function membersBase(workspaceId: string) {
  return `/workspaces/${workspaceId}/members`;
}

export function useWorkspaceMembers(
  workspaceId: string | null | undefined,
  options?: Partial<UseQueryOptions<WorkspaceMember[]>>,
) {
  const { isAuthenticated } = useOxy();
  const enabled = Boolean(isAuthenticated && workspaceId);

  return useQuery<WorkspaceMember[]>({
    queryKey: workspaceMemberKeys.list(workspaceId ?? ''),
    queryFn: async () => {
      const res = await apiClient.get<{ members: WorkspaceMember[] }>(
        membersBase(workspaceId ?? ''),
      );
      return res.data.members;
    },
    enabled,
    staleTime: 1000 * 30,
    ...options,
  });
}

export function useInviteMember(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation<WorkspaceMember, Error, InviteMemberInput>({
    mutationFn: async (input) => {
      const res = await apiClient.post<{ member: WorkspaceMember }>(
        membersBase(workspaceId),
        input,
      );
      return res.data.member;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: workspaceMemberKeys.list(workspaceId),
      });
    },
  });
}

export function useUpdateMemberRole(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation<WorkspaceMember, Error, UpdateMemberRoleInput>({
    mutationFn: async ({ userId, role }) => {
      const res = await apiClient.patch<{ member: WorkspaceMember }>(
        `${membersBase(workspaceId)}/${userId}`,
        { role },
      );
      return res.data.member;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: workspaceMemberKeys.list(workspaceId),
      });
    },
  });
}

export function useRemoveMember(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (userId) => {
      await apiClient.delete(`${membersBase(workspaceId)}/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: workspaceMemberKeys.list(workspaceId),
      });
    },
  });
}
