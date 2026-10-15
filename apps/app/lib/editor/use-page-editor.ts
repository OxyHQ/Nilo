import {
  EditorStore,
  type SendResult,
  SyncSession,
  type SyncStatus,
  type Transaction,
} from '@oxy.so/bloom-editor/model';
import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';
import apiClient from '@/lib/api/client';
import { queryKeys } from '@/lib/hooks/query-keys';
import { API_ROUTES } from '@/lib/api/routes';
import { uuidv7 } from '@/lib/ids';
import { acquireSocket, releaseSocket } from '@/lib/realtime/socket';
import type { Block } from '@/lib/types/pages';
import { NILO_SCHEMA } from './schema';
import {
  type AppliedOperation,
  blocksToDocument,
  OrderBook,
  reconcileOrder,
  transactionToWire,
  wireToOperations,
} from './wire';

/** Someone else on the page, and the block their caret is in. */
export interface Collaborator {
  userId: string;
  blockId: string | null;
}

export interface PageEditorState {
  store: EditorStore | null;
  status: SyncStatus;
  /** The server refused a change (it has been undone); the latest one. */
  rejected: Transaction | null;
  collaborators: Collaborator[];
  error: Error | null;
}

interface BlocksResponse {
  blocks: Block[];
  version: number;
}

interface TransactionEvent {
  pageId: string;
  version: number;
  actorId: string;
  ops: AppliedOperation[];
}

/**
 * A page's live editing session: loads its blocks into an `EditorStore`,
 * saves every local edit as a block transaction, and applies the
 * transactions other members make, arriving over the page's room. Reloads
 * the document whenever it cannot be reconciled (a missed change after a
 * reconnect, a change that no longer applies).
 */
export function usePageEditor(pageId: string, readOnly: boolean): PageEditorState {
  const queryClient = useQueryClient();
  const [store, setStore] = useState<EditorStore | null>(null);
  const [status, setStatus] = useState<SyncStatus>('saved');
  const [rejected, setRejected] = useState<Transaction | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    let disposed = false;
    setCollaborators([]);
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshPageInfo = () => {
      clearTimeout(refreshTimer);
      // Only this page's own record ("edited … by …"), once edits pause.
      refreshTimer = setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.pages.detail(pageId),
          exact: true,
        });
      }, 1000);
    };
    const clearPresence = () => setCollaborators([]);
    const socket = acquireSocket();
    let session: SyncSession | null = null;
    let orders = new OrderBook();
    let stopFocus: (() => void) | null = null;

    const load = async () => {
      const run = ++generation.current;
      try {
        const res = await apiClient.get<BlocksResponse>(API_ROUTES.pages.blocks(pageId));
        if (disposed || run !== generation.current) return;
        const loaded = blocksToDocument(res.data.blocks, res.data.version);
        orders = loaded.orders;
        session?.dispose();
        stopFocus?.();
        const nextStore = new EditorStore({
          document: loaded.doc,
          schema: NILO_SCHEMA,
          newId: uuidv7,
        });
        if (!readOnly) {
          session = new SyncSession(
            nextStore,
            {
              send: async (tx, before, key): Promise<SendResult> => {
                const ops = transactionToWire(tx, before);
                try {
                  const result = await apiClient.post<{ version: number; ops: AppliedOperation[] }>(
                    API_ROUTES.blocks.transactions(pageId),
                    { ops, key, socketId: socket.id },
                  );
                  refreshPageInfo();
                  // The orders the server chose for this change.
                  orders.recordApplied(result.data.ops, result.data.version);
                  return { ok: true, version: result.data.version };
                } catch (err: unknown) {
                  const code = isAxiosError(err) ? err.response?.status : undefined;
                  // No answer, a server fault or rate limiting: try again.
                  return { ok: false, retry: code === undefined || code >= 500 || code === 429 };
                }
              },
            },
            {
              version: res.data.version,
              onStatus: setStatus,
              onRejected: setRejected,
              onDesync: () => void load(),
              reconcile: (doc) => reconcileOrder(doc, orders),
            },
          );
          // Tell the room which block this member is in.
          let lastFocus: string | null = null;
          stopFocus = nextStore.subscribe(() => {
            const selection = nextStore.selection;
            const blockId = selection?.kind === 'text' ? selection.blockId : null;
            if (blockId === lastFocus) return;
            lastFocus = blockId;
            socket.emit('page:focus', { pageId, blockId });
          });
        }
        setStore(nextStore);
        setError(null);
      } catch (err: unknown) {
        if (!disposed) setError(err instanceof Error ? err : new Error(String(err)));
      }
    };

    const join = () => {
      socket.emit('page:join', pageId, (ack: { ok: boolean; version?: number }) => {
        // Changes made while this client was away are not replayed: reload.
        if (
          ack.ok &&
          session &&
          (ack.version ?? 0) > session.currentVersion &&
          !session.hasPending
        ) {
          void load();
        }
      });
    };

    const onTransaction = (event: TransactionEvent) => {
      if (event.pageId !== pageId) return;
      refreshPageInfo();
      session?.receiveRemote({
        version: event.version,
        toOperations: (doc) => wireToOperations(doc, event.ops, orders, event.version),
      });
    };

    const onPresence = (event: { pageId: string; users: Collaborator[] }) => {
      if (event.pageId === pageId) setCollaborators(event.users);
    };

    socket.on('page:transaction', onTransaction);
    socket.on('page:presence', onPresence);
    socket.on('connect', join);
    socket.on('disconnect', clearPresence);
    if (socket.connected) join();
    void load();

    return () => {
      disposed = true;
      socket.emit('page:leave', pageId);
      socket.off('page:transaction', onTransaction);
      socket.off('page:presence', onPresence);
      socket.off('connect', join);
      socket.off('disconnect', clearPresence);
      clearTimeout(refreshTimer);
      stopFocus?.();
      session?.dispose();
      releaseSocket();
    };
  }, [pageId, readOnly, queryClient]);

  return { store, status, rejected, collaborators, error };
}
