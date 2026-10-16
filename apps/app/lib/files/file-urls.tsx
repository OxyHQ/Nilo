/**
 * URLs for attachments in Oxy's file manager (`@oxy.so/nilo-contracts` `files.ts`).
 * A block holds a file id; the API, after checking the reader may see the
 * page, answers with a URL that works for a few minutes. Each reader asks
 * through what gave them the page: membership, a share link or a published
 * page (`FileScopeProvider`).
 */
import type { FileUrl, FileUrlScope } from '@oxy.so/nilo-contracts';
import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { Image as ExpoImage } from 'expo-image';
import * as React from 'react';
import apiClient from '../api/client';
import { API_ROUTES } from '../api/routes';
import { queryKeys } from '../hooks/query-keys';

/** A URL is asked for again this long before it stops working. */
const RENEW_BEFORE_MS = 60_000;

const FileScopeContext = React.createContext<FileUrlScope | null>(null);

/**
 * How the blocks below were reached. Without one, a block asks as a member of
 * the page it belongs to.
 */
export function FileScopeProvider({
  scope,
  children,
}: {
  scope: FileUrlScope;
  children: React.ReactNode;
}) {
  return <FileScopeContext.Provider value={scope}>{children}</FileScopeContext.Provider>;
}

/** The scope a block of `pageId` asks for its files in. */
export function useFileScope(pageId: string | undefined): FileUrlScope | null {
  const provided = React.useContext(FileScopeContext);
  if (provided) return provided;
  return pageId ? { kind: 'page', pageId } : null;
}

function scopeKey(scope: FileUrlScope): string {
  switch (scope.kind) {
    case 'page':
      return `page:${scope.pageId}`;
    case 'share':
      return `share:${scope.token}`;
    case 'published':
      return `published:${scope.slug}:${scope.pageId}`;
  }
}

async function requestFileUrl(scope: FileUrlScope, fileId: string): Promise<FileUrl | null> {
  const [path, body] =
    scope.kind === 'page'
      ? [API_ROUTES.files.pageUrls(scope.pageId), { ids: [fileId] }]
      : scope.kind === 'share'
        ? [API_ROUTES.files.shareUrls(scope.token), { ids: [fileId] }]
        : [API_ROUTES.files.publishedUrls(scope.slug), { pageId: scope.pageId, ids: [fileId] }];
  const res = await apiClient.post<{ files: FileUrl[] }>(path, body);
  return res.data.files.find((file) => file.id === fileId) ?? null;
}

/** A URL as the cache keeps it: until when it works. */
interface CachedFileUrl {
  url: string;
  expiresAt: number;
}

function fileUrlQuery(scope: FileUrlScope, fileId: string) {
  return queryOptions({
    queryKey: queryKeys.files.url(scopeKey(scope), fileId),
    queryFn: async (): Promise<CachedFileUrl | null> => {
      const file = await requestFileUrl(scope, fileId);
      return file ? { url: file.url, expiresAt: Date.now() + file.expiresIn * 1000 } : null;
    },
    // Fresh until a minute before it expires; a refused file is asked again later.
    staleTime: (query) => {
      const data = query.state.data;
      return data ? Math.max(0, data.expiresAt - Date.now() - RENEW_BEFORE_MS) : 30_000;
    },
  });
}

/** The URL to show `fileId` with, or null while there is none (loading, refused, offline). */
export function useFileUrl(scope: FileUrlScope | null, fileId: string | null): string | null {
  const query = useQuery({
    ...fileUrlQuery(scope ?? { kind: 'page', pageId: '' }, fileId ?? ''),
    enabled: Boolean(scope && fileId),
  });
  return query.data?.url ?? null;
}

/**
 * What to show an attached image with: a minted URL, cached under the file's
 * id (the URL changes every few minutes, the id does not); or, when no URL can
 * be had (offline, even after a cold start), the copy `expo-image` already
 * keeps on disk under that id. Null when there is neither.
 */
export function useFileImageSource(
  scope: FileUrlScope | null,
  fileId: string | null,
): { uri: string; cacheKey?: string } | null {
  const url = useFileUrl(scope, fileId);
  const cached = useQuery({
    queryKey: queryKeys.files.cachedImage(fileId ?? ''),
    // `getCachePathAsync` reads the device's disk: it needs no network.
    queryFn: () => ExpoImage.getCachePathAsync(fileId as string),
    enabled: Boolean(fileId) && !url,
    networkMode: 'always',
    staleTime: 0,
  });
  if (!fileId) return null;
  if (url) return { uri: url, cacheKey: fileId };
  const path = cached.data;
  if (!path) return null;
  return { uri: path.startsWith('file://') ? path : `file://${path}` };
}

/** A URL that works now, for opening or downloading a file on demand. */
export async function freshFileUrl(
  queryClient: QueryClient,
  scope: FileUrlScope,
  fileId: string,
): Promise<string | null> {
  const data = await queryClient.fetchQuery(fileUrlQuery(scope, fileId));
  return data?.url ?? null;
}

/** Remember a URL the API just handed out, so the uploader sees their file at once. */
export function rememberFileUrl(
  queryClient: QueryClient,
  scope: FileUrlScope,
  file: FileUrl,
): void {
  const cached: CachedFileUrl = { url: file.url, expiresAt: Date.now() + file.expiresIn * 1000 };
  queryClient.setQueryData(queryKeys.files.url(scopeKey(scope), file.id), cached);
}
