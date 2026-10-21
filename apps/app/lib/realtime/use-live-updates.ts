import { useEffect } from 'react';
import { useOxy } from '@oxy.so/services/ui/client';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { acquireSocket, releaseSocket } from './socket';
import { queryKeys } from '../hooks/query-keys';
import type { PageResponse } from '../types/pages';
import type { DatabaseDetail } from '../types/databases';
import type { CommentsListResponse } from '../types/comments';

type Kind = 'workspace' | 'database' | 'comments';
const subscriptions = new WeakMap<
  QueryClient,
  Map<string, { count: number; dispose: () => void }>
>();

export function invalidateLiveQueries(client: QueryClient, kind: Kind, id: string) {
  if (kind === 'workspace') {
    void client.invalidateQueries({ queryKey: queryKeys.pageActivity.workspace(id) });
    void client.invalidateQueries({ queryKey: queryKeys.breadcrumbNeighbors.workspace(id) });
    void client.invalidateQueries({ queryKey: queryKeys.pages.list(id) });
    void client.invalidateQueries({ queryKey: queryKeys.databases.list(id) });
    // A parent page can move or disappear without a database-room event. Refresh
    // its database metadata/access while leaving row queries and edits alone.
    void client.invalidateQueries({
      predicate: (query) =>
        query.queryKey.length === 2 &&
        query.queryKey[0] === 'database' &&
        (query.state.data as DatabaseDetail | undefined)?.database?.workspaceId === id &&
        client.isMutating({
          mutationKey: ['database-update'],
          predicate: (mutation) =>
            (mutation.state.variables as { id?: string } | undefined)?.id === query.queryKey[1],
        }) === 0,
    });
    // An ancestor can move or change its title independently of this page's metadata.
    void client.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'page' &&
        query.queryKey[2] === 'breadcrumb' &&
        query.queryKey[3] === id,
    });
    // Metadata belongs to PageResponse, not the editor's Yjs/blocks. A pending
    // page mutation already refreshes this query on settle; don't overwrite it.
    void client.invalidateQueries({
      predicate: (query) =>
        query.queryKey.length === 2 &&
        query.queryKey[0] === 'page' &&
        (query.state.data as PageResponse | undefined)?.page?.workspaceId === id &&
        client.isMutating({
          mutationKey: ['page-update'],
          predicate: (mutation) =>
            (mutation.state.variables as { id?: string } | undefined)?.id === query.queryKey[1],
        }) === 0,
    });
    // Favorites and page templates are derived from the workspace's pages queries.
  } else if (kind === 'database') {
    void client.invalidateQueries({ queryKey: queryKeys.pageActivity.all });
    // Row anchors deliberately do not infer access or a database id from private
    // cached metadata. Revalidate open neighbor menus on a database-room change;
    // disabled menus merely become stale and will load on their next opening.
    void client.invalidateQueries({ queryKey: queryKeys.breadcrumbNeighbors.all });
    // This prefix covers detail, every view's rows, single rows and templates,
    // but never the page or blocks currently held by the editor.
    void client.invalidateQueries({ queryKey: queryKeys.databases.detail(id) });
  } else {
    void client.invalidateQueries({ queryKey: ['comments', 'page', id] });
    void client.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'comments' &&
        query.queryKey[1] === 'block' &&
        Boolean(
          (query.state.data as CommentsListResponse | undefined)?.comments.some(
            (c) => c.pageId === id,
          ),
        ),
    });
  }
}

function useLiveUpdates(kind: Kind, id: string | null | undefined) {
  const client = useQueryClient();
  const { isAuthenticated } = useOxy();
  useEffect(() => {
    if (!id || !isAuthenticated) return;
    let entries = subscriptions.get(client);
    if (!entries) {
      entries = new Map();
      subscriptions.set(client, entries);
    }
    const key = `${kind}:${id}`;
    let entry = entries.get(key);
    if (!entry) {
      const socket = acquireSocket();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let disposed = false;
      const refresh = () => {
        if (disposed) return;
        clearTimeout(timer);
        timer = setTimeout(() => invalidateLiveQueries(client, kind, id), 120);
      };
      const join = () => {
        if (kind === 'comments') {
          refresh();
          return;
        }
        socket.emit(`${kind}:join`, id, (ack: { ok?: boolean } | undefined) => {
          if (ack?.ok) refresh();
        });
      };
      const event = kind === 'comments' ? 'page:comments' : `${kind}:changed`;
      const changed = (payload: { workspaceId?: string; databaseId?: string; pageId?: string }) => {
        if (
          payload?.[
            kind === 'comments' ? 'pageId' : kind === 'workspace' ? 'workspaceId' : 'databaseId'
          ] === id
        )
          refresh();
      };
      // A reset personal workspace is emptied, not changed: anything cached
      // may be a page that is gone, so everything refetches.
      const reset = (payload: { workspaceId?: string }) => {
        if (payload?.workspaceId === id) void client.invalidateQueries();
      };
      socket.on('connect', join);
      socket.on(event, changed);
      if (kind === 'workspace') socket.on('workspace:reset', reset);
      if (socket.connected) join();
      entry = {
        count: 0,
        dispose: () => {
          disposed = true;
          clearTimeout(timer);
          socket.off('connect', join);
          socket.off(event, changed);
          socket.off('workspace:reset', reset);
          // The editor owns the page room; a panel must never leave it.
          if (kind !== 'comments') socket.emit(`${kind}:leave`, id);
          releaseSocket();
        },
      };
      entries.set(key, entry);
    }
    entry.count++;
    return () => {
      if (--entry.count === 0) {
        entry.dispose();
        entries.delete(key);
      }
    };
  }, [client, kind, id, isAuthenticated]);
}
export const useWorkspaceLive = (id: string | null | undefined) => useLiveUpdates('workspace', id);
export const useDatabaseLive = (id: string | null | undefined) => useLiveUpdates('database', id);
export const useCommentsLive = (id: string | null | undefined) => useLiveUpdates('comments', id);
