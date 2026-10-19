/**
 * Administering a workspace beyond its member list: invitations waiting for
 * an Oxy account, the join link, handing the workspace over, and its guests
 * (`docs/access.md`, "Joining and leaving a workspace").
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import type { WorkspaceMemberUser } from './use-workspace-members';
import type { WorkspaceRole } from './use-workspaces';
import { workspaceAdminKeys, workspaceKeys, workspaceMemberKeys } from './workspace-keys';

/** An invitation by email still waiting for someone to sign up with it. */
export interface WorkspaceInvite {
  id: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

/** The roles a join link can give. */
export type InviteLinkRole = 'viewer' | 'commenter' | 'editor';
export const INVITE_LINK_ROLES: readonly InviteLinkRole[] = ['editor', 'commenter', 'viewer'];

export interface WorkspaceInviteLink {
  id: string;
  token: string;
  url: string;
  role: InviteLinkRole;
  createdBy: string;
  createdAt: string;
}

export interface GuestPage {
  pageId: string;
  title: string;
  icon: string | null;
  role: WorkspaceRole;
  grantedBy: string;
  sharedAt: string;
}

/** Someone pages are shared with who is not a member of the workspace. */
export interface WorkspaceGuest {
  userId: string;
  user: WorkspaceMemberUser | null;
  pages: GuestPage[];
}

function useAdminQuery<T>(
  key: readonly unknown[],
  url: string,
  enabled: boolean,
  pick: (d: never) => T,
) {
  const { isAuthenticated } = useOxy();
  return useQuery<T>({
    queryKey: key,
    queryFn: async ({ signal }) => pick((await apiClient.get(url, { signal })).data as never),
    enabled: Boolean(isAuthenticated && enabled),
    staleTime: 1000 * 30,
  });
}

export function usePendingInvites(workspaceId: string | null, enabled = true) {
  return useAdminQuery<WorkspaceInvite[]>(
    workspaceAdminKeys.invites(workspaceId ?? ''),
    API_ROUTES.workspaces.invites(workspaceId ?? ''),
    Boolean(workspaceId) && enabled,
    (data: { invites: WorkspaceInvite[] }) => data.invites,
  );
}

export function useRevokeInvite(workspaceId: string) {
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (inviteId) => {
      await apiClient.delete(API_ROUTES.workspaces.invite(workspaceId, inviteId));
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: workspaceAdminKeys.invites(workspaceId) }),
  });
}

export function useInviteLink(workspaceId: string | null, enabled = true) {
  return useAdminQuery<WorkspaceInviteLink | null>(
    workspaceAdminKeys.inviteLink(workspaceId ?? ''),
    API_ROUTES.workspaces.inviteLink(workspaceId ?? ''),
    Boolean(workspaceId) && enabled,
    (data: { link: WorkspaceInviteLink | null }) => data.link,
  );
}

/** Enable, regenerate (`regenerate`), re-role or disable (`null`) the join link. */
export function useUpdateInviteLink(workspaceId: string) {
  const client = useQueryClient();
  return useMutation<
    WorkspaceInviteLink | null,
    Error,
    | { action: 'create'; role: InviteLinkRole }
    | { action: 'role'; role: InviteLinkRole }
    | { action: 'disable' }
  >({
    mutationFn: async (input) => {
      const url = API_ROUTES.workspaces.inviteLink(workspaceId);
      if (input.action === 'disable') {
        await apiClient.delete(url);
        return null;
      }
      const res =
        input.action === 'create'
          ? await apiClient.post<{ link: WorkspaceInviteLink }>(url, { role: input.role })
          : await apiClient.patch<{ link: WorkspaceInviteLink }>(url, { role: input.role });
      return res.data.link;
    },
    onSuccess: (link) => client.setQueryData(workspaceAdminKeys.inviteLink(workspaceId), link),
  });
}

/** The owner hands the workspace to `userId` and becomes an admin. */
export function useTransferOwnership(workspaceId: string) {
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (userId) => {
      await apiClient.post(API_ROUTES.workspaces.transfer(workspaceId), { userId });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: workspaceMemberKeys.list(workspaceId) });
      client.invalidateQueries({ queryKey: workspaceKeys.list });
      client.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId) });
    },
  });
}

export function useWorkspaceGuests(workspaceId: string | null, enabled = true) {
  return useAdminQuery<WorkspaceGuest[]>(
    workspaceAdminKeys.guests(workspaceId ?? ''),
    API_ROUTES.workspaces.guests(workspaceId ?? ''),
    Boolean(workspaceId) && enabled,
    (data: { guests: WorkspaceGuest[] }) => data.guests,
  );
}

export function useRemoveGuest(workspaceId: string) {
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (userId) => {
      await apiClient.delete(API_ROUTES.workspaces.guest(workspaceId, userId));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: workspaceAdminKeys.guests(workspaceId) }),
  });
}

/** What a join link leads to, read before joining. */
export interface InviteLinkPreview {
  workspace: { id: string; name: string; avatar: string | null };
  role: InviteLinkRole;
}

export function useInviteLinkPreview(token: string | null) {
  return useQuery<InviteLinkPreview>({
    queryKey: workspaceAdminKeys.linkPreview(token ?? ''),
    queryFn: async ({ signal }) =>
      (await apiClient.get<InviteLinkPreview>(API_ROUTES.inviteLinks.get(token ?? ''), { signal }))
        .data,
    enabled: Boolean(token),
    retry: false,
  });
}

export interface JoinWorkspaceResponse {
  workspaceId: string;
  role: WorkspaceRole | null;
  joined: boolean;
}

export function useJoinWorkspace() {
  const client = useQueryClient();
  return useMutation<JoinWorkspaceResponse, Error, string>({
    mutationFn: async (token) =>
      (await apiClient.post<JoinWorkspaceResponse>(API_ROUTES.inviteLinks.join(token))).data,
    onSuccess: () => client.invalidateQueries({ queryKey: workspaceKeys.list }),
  });
}
