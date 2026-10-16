/**
 * URLs for attachments in Oxy's file manager (`@oxy.so/nilo-contracts` `files.ts`).
 * A block holds a file id; the API, after checking the reader may see the
 * page, answers with a URL that works for a few minutes. Each reader asks
 * through what gave them the page: membership, a share link or a published
 * page (`FileScopeProvider`).
 */
import type { FileUrl, FileUrlScope, FileUrlsResponse } from '@oxy.so/nilo-contracts';
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

/**
 * The file's URL; `'removed'` when Oxy has said it no longer serves it
 * (deleted, trashed by its owner, taken down); null when the reader may not
 * have it.
 */
async function requestFileUrl(
  scope: FileUrlScope,
  fileId: string,
): Promise<FileUrl | 'removed' | null> {
  const [path, body] =
    scope.kind === 'page'
      ? [API_ROUTES.files.pageUrls(scope.pageId), { ids: [fileId] }]
      : scope.kind === 'share'
        ? [API_ROUTES.files.shareUrls(scope.token), { ids: [fileId] }]
        : [API_ROUTES.files.publishedUrls(scope.slug), { pageId: scope.pageId, ids: [fileId] }];
  const res = await apiClient.post<FileUrlsResponse>(path, body);
  if (res.data.removed?.includes(fileId)) return 'removed';
  return res.data.files.find((file) => file.id === fileId) ?? null;
}

/** A URL as the cache keeps it: until when it works. */
interface CachedFileUrl {
  url: string;
  expiresAt: number;
}

/** A file Oxy no longer serves, as the cache keeps it. */
interface RemovedFile {
  removed: true;
}

type CachedFile = CachedFileUrl | RemovedFile;

const isUrl = (data: CachedFile | null | undefined): data is CachedFileUrl =>
  Boolean(data && 'url' in data);

function fileUrlQuery(scope: FileUrlScope, fileId: string) {
  return queryOptions({
    queryKey: queryKeys.files.url(scopeKey(scope), fileId),
    queryFn: async (): Promise<CachedFile | null> => {
      const file = await requestFileUrl(scope, fileId);
      if (file === 'removed') return { removed: true };
      return file ? { url: file.url, expiresAt: Date.now() + file.expiresIn * 1000 } : null;
    },
    // Fresh until a minute before it expires; a refused or removed file is
    // asked again later (an owner can restore it).
    staleTime: (query) => {
      const data = query.state.data;
      return isUrl(data) ? Math.max(0, data.expiresAt - Date.now() - RENEW_BEFORE_MS) : 30_000;
    },
  });
}

function useFileQuery(scope: FileUrlScope | null, fileId: string | null, fetch = true) {
  return useQuery({
    ...fileUrlQuery(scope ?? { kind: 'page', pageId: '' }, fileId ?? ''),
    enabled: fetch && Boolean(scope && fileId),
  });
}

/** The URL to show `fileId` with, or null while there is none (loading, refused, removed, offline). */
export function useFileUrl(scope: FileUrlScope | null, fileId: string | null): string | null {
  const data = useFileQuery(scope, fileId).data;
  return isUrl(data) ? data.url : null;
}

/**
 * Whether Oxy has said it no longer serves `fileId`: deleted, moved to its
 * owner's trash, or taken down. Such a file is shown as removed — not as a
 * file still loading, and never from a copy kept on the device.
 */
export function useFileRemoved(
  scope: FileUrlScope | null,
  fileId: string | null,
  options: { fetch?: boolean } = {},
): boolean {
  const data = useFileQuery(scope, fileId, options.fetch !== false).data;
  return Boolean(data && 'removed' in data);
}

/** Whether the last answer about `fileId` was that Oxy removed it; asks nothing. */
export function isFileRemoved(
  queryClient: QueryClient,
  scope: FileUrlScope,
  fileId: string,
): boolean {
  const data = queryClient.getQueryData<CachedFile | null>(
    queryKeys.files.url(scopeKey(scope), fileId),
  );
  return Boolean(data && 'removed' in data);
}

/**
 * What to show an attached image with: a minted URL, cached under the file's
 * id (the URL changes every few minutes, the id does not); or, when no URL can
 * be had (offline, even after a cold start), the copy `expo-image` already
 * keeps on disk under that id. Null when there is neither, and for a file Oxy
 * has removed (`useFileRemoved`): a takedown must not live on in a device cache.
 */
export function useFileImageSource(
  scope: FileUrlScope | null,
  fileId: string | null,
): { uri: string; cacheKey?: string } | null {
  const query = useFileQuery(scope, fileId);
  const url = isUrl(query.data) ? query.data.url : null;
  const removed = Boolean(query.data && 'removed' in query.data);
  // The disk copy only once the API has answered without a URL, failed, or
  // cannot be asked (offline): never before knowing the file was not removed.
  const settled =
    query.status === 'error' || query.fetchStatus === 'paused' || query.status === 'success';
  const cached = useQuery({
    queryKey: queryKeys.files.cachedImage(fileId ?? ''),
    // `getCachePathAsync` reads the device's disk: it needs no network.
    queryFn: () => ExpoImage.getCachePathAsync(fileId as string),
    enabled: Boolean(fileId) && settled && !url && !removed,
    networkMode: 'always',
    staleTime: 0,
  });
  if (!fileId || removed) return null;
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
  return isUrl(data) ? data.url : null;
}

/** Remember a URL the API just handed out, so the uploader sees their file at once. */
export function rememberFileUrl(
  queryClient: QueryClient,
  scope: FileUrlScope,
  file: FileUrl,
): void {
  const cached: CachedFile = { url: file.url, expiresAt: Date.now() + file.expiresIn * 1000 };
  queryClient.setQueryData(queryKeys.files.url(scopeKey(scope), file.id), cached);
}
