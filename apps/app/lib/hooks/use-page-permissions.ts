import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import { useAuthQuery } from './create-query';
import { queryKeys } from './query-keys';
import type { Page, PageResponse } from '../types/pages';
import type { WorkspaceRole } from './use-workspaces';
import type { WorkspaceMemberUser } from './use-workspace-members';

export type PageRole = WorkspaceRole;
export type PageGrantRole = Exclude<PageRole, 'owner'>;
export interface PageGrant {
  userId: string;
  user: WorkspaceMemberUser | null;
  role: PageGrantRole;
  grantedBy: string;
  inheritedFrom: string | null;
  viaShareLink: boolean;
  createdAt: string;
}
export interface PagePermissions {
  pageId: string;
  restricted: boolean;
  restrictedFrom: string | null;
  openToWorkspace: boolean;
  role: PageRole;
  grants: PageGrant[];
}
export interface SharedPagesResponse {
  shared: Array<{
    workspace: { id: string; name: string; icon: string | null };
    pages: Array<Page & { role: PageRole }>;
  }>;
}
interface GrantResponse {
  grant: Pick<PageGrant, 'userId' | 'role' | 'grantedBy'>;
}
export interface JoinShareResponse {
  pageId: string;
  workspaceId: string;
  role: PageRole;
}

// A grant/restriction also changes access throughout the subtree. Refresh all
// loaded page details and permissions, including descendants in other screens.
export async function invalidatePageAccess(client: QueryClient) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['page-permissions'] }),
    client.invalidateQueries({ queryKey: ['page'] }),
    client.invalidateQueries({ queryKey: ['pages'] }),
    client.invalidateQueries({ queryKey: queryKeys.pages.shared }),
  ]);
}

export function usePagePermissions(pageId: string) {
  return useAuthQuery<PagePermissions>(
    queryKeys.pages.permissions(pageId),
    API_ROUTES.pages.permissions(pageId),
    undefined,
    { staleTime: 30_000, retry: false },
  );
}
export function useSharePageByEmail(pageId: string) {
  const client = useQueryClient();
  return useMutation<GrantResponse, Error, { email: string; role: PageGrantRole }>({
    mutationFn: async (input) =>
      (await apiClient.post<GrantResponse>(API_ROUTES.pages.permissions(pageId), input)).data,
    onSuccess: () => invalidatePageAccess(client),
  });
}
export function useUpdatePageAccess(pageId: string) {
  const client = useQueryClient();
  return useMutation<GrantResponse, Error, { userId: string; role: PageGrantRole }>({
    mutationFn: async ({ userId, role }) =>
      (await apiClient.put<GrantResponse>(API_ROUTES.pages.permission(pageId, userId), { role }))
        .data,
    onSuccess: () => invalidatePageAccess(client),
  });
}
export function useRemovePageAccess(pageId: string) {
  const client = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (userId) => {
      await apiClient.delete(API_ROUTES.pages.permission(pageId, userId));
    },
    onSuccess: () => invalidatePageAccess(client),
  });
}
export function useSetPageRestricted(pageId: string) {
  const client = useQueryClient();
  return useMutation<PageResponse, Error, boolean>({
    mutationFn: async (restricted) =>
      (await apiClient.patch<PageResponse>(API_ROUTES.pages.update(pageId), { restricted })).data,
    onSuccess: () => invalidatePageAccess(client),
  });
}
export function useSharedPages() {
  return useAuthQuery<SharedPagesResponse>(
    queryKeys.pages.shared,
    API_ROUTES.pages.shared,
    undefined,
    { staleTime: 30_000 },
  );
}
export function useJoinShareLink() {
  const client = useQueryClient();
  return useMutation<JoinShareResponse, Error, string>({
    mutationFn: async (token) =>
      (await apiClient.post<JoinShareResponse>(API_ROUTES.share.join(token))).data,
    onSuccess: () => invalidatePageAccess(client),
  });
}
