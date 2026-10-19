import { EditorStore, emptyDocument } from '@oxy.so/bloom-editor/model';
import { YjsBinding } from '@oxy.so/bloom-editor/yjs';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { queryKeys } from '@/lib/hooks/query-keys';
import { uuidv7 } from '@/lib/ids';
import { acquireSocket, releaseSocket } from '@/lib/realtime/socket';
import { offlinePages } from './offline-pages';
import type { SyncStatus } from './page-session';
import { holdPageSession } from './shared-sessions';

export type { SyncStatus };

/** Someone else on the page, and the block their caret is in. */
export interface Collaborator {
  userId: string;
  blockId: string | null;
}

export interface PageEditorState {
  store: EditorStore | null;
  status: SyncStatus;
  /**
   * The server's last refusal of this person's change and why (read-only,
   * locked, too large); `count` tells one refusal from the next.
   */
  rejected: { count: number; code: string } | null;
  collaborators: Collaborator[];
  error: Error | null;
}

/** How the page is shown: as the page itself, or inside another (a synced block). */
export interface PageEditorOptions {
  /**
   * Shown inside another page: its blocks are edited there, but the page is
   * not opened — not kept as a recent page, and the room is not told where
   * this member's caret is (the page they are on says so).
   */
  embedded?: boolean;
}

/**
 * A page's live editing session: its document (`page-session.ts`, one per
 * page on the device however many places show it: `shared-sessions.ts`),
 * shown in an `EditorStore` bound to it (`@oxy.so/bloom-editor/yjs`), so
 * every edit goes into the document and every change to the document reaches
 * the editor. Who else is on the page, and which block they are in, comes
 * from the page's room.
 */
export function usePageEditor(
  pageId: string,
  readOnly: boolean,
  { embedded = false }: PageEditorOptions = {},
): PageEditorState {
  const { t } = useTranslation();
  // Read when a message is needed: a new `t` must not reopen the page.
  const translate = useRef(t);
  translate.current = t;
  const queryClient = useQueryClient();
  const [store, setStore] = useState<EditorStore | null>(null);
  const [status, setStatus] = useState<SyncStatus>('saved');
  const [rejected, setRejected] = useState<{ count: number; code: string } | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setStore(null);
    setError(null);
    setStatus('saved');
    setCollaborators([]);
    const socket = acquireSocket();
    let binding: YjsBinding | null = null;
    let stopFocus: (() => void) | null = null;

    // This page's own record ("edited … by …"), once changes pause.
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshPageInfo = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.pages.detail(pageId),
          exact: true,
        });
      }, 1000);
    };

    const release = holdPageSession(pageId, {
      readOnly,
      onReady: (doc) => {
        if (binding) return;
        const next = new EditorStore({
          document: emptyDocument(),
          schema: NILO_SCHEMA,
          newId: uuidv7,
        });
        binding = new YjsBinding(next, doc, { readOnly });
        if (!readOnly && !embedded) {
          // Tell the room which block this member is in.
          let lastFocus: string | null = null;
          stopFocus = next.subscribe(() => {
            const selection = next.selection;
            const blockId = selection?.kind === 'text' ? selection.blockId : null;
            if (blockId === lastFocus) return;
            lastFocus = blockId;
            socket.emit('page:focus', { pageId, blockId });
          });
        }
        setError(null);
        setStore(next);
        // Opened: kept as a recent page on devices that keep pages offline.
        if (!embedded) void offlinePages.opened(pageId);
      },
      onStatus: setStatus,
      onRejected: (code) => {
        setRejected((last) => ({ count: (last?.count ?? 0) + 1, code }));
        // Someone locked the page: read it again so it shows as locked.
        if (code === 'PAGE_LOCKED') refreshPageInfo();
      },
      onUnavailable: (reason) => {
        if (reason !== 'offline') void offlinePages.forget(pageId);
        setError(
          new Error(
            translate.current(
              reason === 'forbidden'
                ? 'editor.unavailable.forbidden'
                : reason === 'not_found'
                  ? 'editor.unavailable.notFound'
                  : 'editor.unavailable.offline',
            ),
          ),
        );
      },
    });

    const onRemote = (event: { pageId: string }) => {
      if (event.pageId === pageId) refreshPageInfo();
    };
    const onPresence = (event: { pageId: string; users: Collaborator[] }) => {
      if (event.pageId === pageId) setCollaborators(event.users);
    };
    const clearPresence = () => setCollaborators([]);
    socket.on('doc:update', onRemote);
    socket.on('page:presence', onPresence);
    socket.on('disconnect', clearPresence);

    return () => {
      clearTimeout(refreshTimer);
      socket.off('doc:update', onRemote);
      socket.off('page:presence', onPresence);
      socket.off('disconnect', clearPresence);
      stopFocus?.();
      binding?.dispose();
      release();
      releaseSocket();
    };
  }, [pageId, readOnly, embedded, queryClient]);

  return { store, status, rejected, collaborators, error };
}
