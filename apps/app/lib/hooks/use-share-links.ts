import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
import axios from 'axios';
import apiClient from '../api/client';
import config from '../config';
import { invalidatePageAccess } from './use-page-permissions';
import { shareLinkKeys } from './workspace-keys';

export type ShareLinkScope = 'read' | 'comment' | 'edit';

export const SHARE_LINK_SCOPES: ShareLinkScope[] = ['read', 'comment', 'edit'];

/** An active share link, as `GET /pages/:pageId/share` lists it. */
export interface ShareLink {
  id: string;
  token: string;
  /** The public URL the API built for this link. */
  url: string;
  scope: ShareLinkScope;
  createdBy: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateShareLinkInput {
  scope: ShareLinkScope;
  expiresAt?: string | null;
}

export interface SharedBlock {
  id: string;
  pageId: string;
  parentBlockId: string | null;
  type: string;
  content: Record<string, unknown>;
  order: number;
}

export interface SharedPage {
  page: {
    id: string;
    title: string;
    icon: string | null;
    cover: string | null;
    updatedAt: string;
  };
  blocks: SharedBlock[];
  share: {
    scope: ShareLinkScope;
    expiresAt: string | null;
  };
}

function shareLinksPath(pageId: string) {
  return `/pages/${pageId}/share`;
}

export function useShareLinks(
  pageId: string | null | undefined,
  options?: Partial<UseQueryOptions<ShareLink[]>>,
) {
  const { isAuthenticated } = useOxy();
  const enabled = Boolean(isAuthenticated && pageId);

  return useQuery<ShareLink[]>({
    queryKey: shareLinkKeys.list(pageId ?? ''),
    queryFn: async () => {
      const res = await apiClient.get<{ shareLinks: ShareLink[] }>(shareLinksPath(pageId ?? ''));
      return res.data.shareLinks;
    },
    enabled,
    staleTime: 1000 * 30,
    ...options,
  });
}

export function useCreateShareLink(pageId: string) {
  const queryClient = useQueryClient();

  return useMutation<ShareLink, Error, CreateShareLinkInput>({
    mutationFn: async (input) => {
      const res = await apiClient.post<{ shareLink: ShareLink }>(shareLinksPath(pageId), input);
      return res.data.shareLink;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: shareLinkKeys.list(pageId),
      });
    },
  });
}

export function useRevokeShareLink(pageId: string) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (linkId) => {
      await apiClient.delete(`/share-links/${linkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: shareLinkKeys.list(pageId),
      });
      void invalidatePageAccess(queryClient);
    },
  });
}

/**
 * useSharedPage — public, unauthenticated read of a shared page by
 * token. Uses a bare axios client (no Bearer header) so the call goes
 * through even when the visitor isn't logged in.
 */
export function useSharedPage(token: string | null | undefined) {
  return useQuery<SharedPage>({
    queryKey: shareLinkKeys.public(token ?? ''),
    queryFn: async () => {
      const res = await axios.get<SharedPage>(`${config.apiUrl}/share/${token}`, {
        timeout: 15000,
      });
      return res.data;
    },
    enabled: Boolean(token),
    staleTime: 1000 * 60,
    retry: false,
  });
}
