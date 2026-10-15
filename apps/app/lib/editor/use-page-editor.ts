import {
  type EditorDocument,
  EditorStore,
  type PendingTransaction,
  type SendResult,
  SyncSession,
  type SyncSnapshot,
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
import { RemoteFollower } from './follower';
import { clearSavedPage, PendingClock, readSavedPage, writeSavedPage } from './offline';
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
  /** From `resume`: which of the keys sent the blocks already include. */
  applied?: string[];
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

    // Keep unconfirmed work on the device while there is some (see offline.ts).
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const clock = new PendingClock();
    const persist = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const snapshot = session?.snapshot();
        if (!snapshot) return;
        if (snapshot.pending.length === 0) void clearSavedPage(pageId);
        else {
          void writeSavedPage(pageId, {
            ...snapshot,
            orders: orders.toJSON(),
            oldestAt: clock.oldest(snapshot.pending),
          });
        }
      }, 400);
    };

    /** A store and session over `doc`, resuming `pending`; null for a read-only page. */
    const open = (doc: EditorDocument, version: number, pending: readonly PendingTransaction[]) => {
      session?.dispose();
      stopFocus?.();
      const nextStore = new EditorStore({ document: doc, schema: NILO_SCHEMA, newId: uuidv7 });
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
            version,
            onStatus: (next) => {
              setStatus(next);
              persist();
            },
            onRejected: setRejected,
            onDesync: () => void load(),
            reconcile: (current) => reconcileOrder(current, orders),
            resume: pending,
          },
        );
        nextStore.onTransaction((_tx, origin) => {
          if (origin !== 'remote') persist();
        });
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
      shown = nextStore;
      follower = readOnly ? new RemoteFollower(nextStore, () => orders, version) : null;
      setStore(nextStore);
    };

    // A reload hands over what the replaced session had not had confirmed
    // (`carry`, kept across a load a newer one supersedes) and anything typed
    // while it loads (`late`); remote changes arriving meanwhile wait in
    // `buffered` and are applied on top of what was loaded.
    let carry: SyncSnapshot | null = null;
    let late: PendingTransaction[] = [];
    let stopLate: (() => void) | null = null;
    let buffered: TransactionEvent[] | null = null;
    let shown: EditorStore | null = null;
    /** Keeps a read-only page live (an editable one has its session). */
    let follower: RemoteFollower | null = null;

    const settle = () => {
      carry = null;
      late = [];
      stopLate?.();
      stopLate = null;
    };

    /** Apply what arrived while loading, newer than `version`, then go live. */
    const drain = (version: number) => {
      const events = (buffered ?? [])
        .filter((e) => e.version > version)
        .sort((x, y) => x.version - y.version);
      buffered = null;
      for (const event of events) applyRemote(event);
    };

    const load = async () => {
      const run = ++generation.current;
      buffered = buffered ?? [];
      if (session) {
        carry = session.snapshot();
        session.dispose();
        session = null;
      }
      if (shown && !readOnly && !stopLate) {
        stopLate = shown.onTransaction((tx, origin) => {
          if (origin !== 'remote' && tx.ops.length > 0) late.push({ tx, key: uuidv7() });
        });
      }
      const saved = carry || readOnly ? null : await readSavedPage(pageId);
      if (saved) clock.seed(saved.pending, saved.oldestAt);
      // What the server may have applied already: the keys it was sent under.
      const sent = carry?.pending ?? saved?.pending ?? [];
      try {
        // The server also says which of those the blocks already include
        // (applied, the answer lost): those are not applied a second time.
        const res =
          sent.length > 0
            ? await apiClient.post<BlocksResponse>(API_ROUTES.pages.resumeBlocks(pageId), {
                keys: sent.map((p) => p.key),
              })
            : await apiClient.get<BlocksResponse>(API_ROUTES.pages.blocks(pageId));
        if (disposed || run !== generation.current) return;
        const applied = new Set(res.data.applied);
        const loaded = blocksToDocument(res.data.blocks, res.data.version);
        orders = loaded.orders;
        const pending = [...sent.filter((p) => !applied.has(p.key)), ...late];
        settle();
        open(loaded.doc, res.data.version, pending);
        drain(res.data.version);
        setError(null);
      } catch (err: unknown) {
        if (disposed || run !== generation.current) return;
        // No connection: keep editing what this client has, and sync when it is back.
        const local: SyncSnapshot | null = carry ?? saved;
        if (local && isAxiosError(err) && !err.response) {
          if (!carry && saved) orders = OrderBook.from(saved.orders);
          const pending = [...local.pending, ...late];
          settle();
          open(local.base, local.version, pending);
          drain(local.version);
          setStatus('offline');
          setError(null);
          return;
        }
        buffered = null;
        settle();
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    };

    const join = () => {
      socket.emit('page:join', pageId, (ack: { ok: boolean; version?: number }) => {
        // Changes made while this client was away are not replayed: reload.
        // Unsent changes carry over the reload.
        const current = session?.currentVersion ?? follower?.version;
        if (ack.ok && current !== undefined && (ack.version ?? 0) > current) void load();
      });
    };

    function applyRemote(event: TransactionEvent) {
      if (session) {
        session.receiveRemote({
          version: event.version,
          toOperations: (doc) => wireToOperations(doc, event.ops, orders, event.version),
        });
        return;
      }
      if (follower?.receive(event) === 'reload') void load();
    }

    const onTransaction = (event: TransactionEvent) => {
      if (event.pageId !== pageId) return;
      refreshPageInfo();
      if (buffered) buffered.push(event);
      else applyRemote(event);
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
      // Whatever is still unconfirmed is written now, not after the delay.
      clearTimeout(saveTimer);
      // Mid-reload, the work is what the reload was handing over.
      const last = session
        ? session.snapshot()
        : carry && { ...carry, pending: [...carry.pending, ...late] };
      if (last && last.pending.length > 0) {
        void writeSavedPage(pageId, {
          ...last,
          orders: orders.toJSON(),
          oldestAt: clock.oldest(last.pending),
        });
      }
      stopFocus?.();
      stopLate?.();
      session?.dispose();
      releaseSocket();
    };
  }, [pageId, readOnly, queryClient]);

  return { store, status, rejected, collaborators, error };
}
