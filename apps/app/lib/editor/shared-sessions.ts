/**
 * One live document per page on this device, however many places show it.
 *
 * A page is open as an editor, and also wherever a synced block shows one of
 * its blocks (`components/editor/blocks/sync-block.tsx`) — on another page,
 * or on the same one. Each of those keeps its own `EditorStore` (its own
 * selection and undo), but they all bind to one `Y.Doc` and one session:
 *
 * - the server sends a change to every socket in the room but the one that
 *   made it, so two sessions of one page on one socket would never hear each
 *   other's changes;
 * - the room is joined and left per socket, so the first session to close
 *   would take the other out of it.
 *
 * A session opens with its first holder and closes with its last. It sends
 * this device's changes while any holder may edit (`PageSession.setReadOnly`).
 */
import type * as Y from 'yjs';
import { acquireSocket, releaseSocket } from '@/lib/realtime/socket';
import { pageDocStore } from './doc-store';
import type { PageDocStore } from './doc-store-types';
import { offlinePages } from './offline-pages';
import { PageSession, type SessionSocket, type SyncStatus } from './page-session';

type Unavailable = 'forbidden' | 'not_found' | 'offline';

/** One place a page is open, and what it hears of the page's session. */
export interface SessionHolder {
  readOnly: boolean;
  onReady: (doc: Y.Doc) => void;
  onStatus: (status: SyncStatus) => void;
  onRejected: (code: string) => void;
  onUnavailable: (reason: Unavailable) => void;
}

/** What a session needs from the app; replaced in tests. */
export interface SessionDeps {
  acquireSocket: () => SessionSocket;
  releaseSocket: () => void;
  store: PageDocStore | null;
  /** The session closed: keep the page on the device, or forget it. */
  closed: (pageId: string, bytes: number) => Promise<void>;
}

const defaultDeps: SessionDeps = {
  acquireSocket: () => acquireSocket() as unknown as SessionSocket,
  releaseSocket,
  store: pageDocStore,
  closed: async (pageId, bytes) => {
    // Kept for reading offline, or holding unsent work: stays. Otherwise not.
    if (await offlinePages.keeps(pageId)) await offlinePages.saved(pageId, bytes);
    else await pageDocStore?.remove(pageId);
  },
};

interface Entry {
  session: PageSession;
  holders: Set<SessionHolder>;
  doc: Y.Doc | null;
  status: SyncStatus;
  unavailable: Unavailable | null;
}

const entries = new Map<string, Entry>();

function sendsChanges(entry: Entry): boolean {
  for (const holder of entry.holders) if (!holder.readOnly) return true;
  return false;
}

/**
 * Open `pageId` for `holder`: it hears when the document is ready (at once
 * when it already is), how syncing goes, and what the server refused.
 * Returns the release; the session closes with its last holder.
 */
export function holdPageSession(
  pageId: string,
  holder: SessionHolder,
  deps: SessionDeps = defaultDeps,
): () => void {
  let entry = entries.get(pageId);
  if (!entry) {
    const socket = deps.acquireSocket();
    const holders = new Set<SessionHolder>();
    const created: Entry = {
      holders,
      doc: null,
      status: 'saved',
      unavailable: null,
      session: new PageSession({
        pageId,
        socket,
        store: deps.store,
        readOnly: holder.readOnly,
        onReady: (doc) => {
          created.doc = doc;
          created.unavailable = null;
          for (const each of [...holders]) each.onReady(doc);
        },
        onStatus: (status) => {
          created.status = status;
          for (const each of [...holders]) each.onStatus(status);
        },
        onRejected: (code) => {
          for (const each of [...holders]) each.onRejected(code);
        },
        onUnavailable: (reason) => {
          created.unavailable = reason;
          for (const each of [...holders]) each.onUnavailable(reason);
        },
      }),
    };
    entry = created;
    entries.set(pageId, created);
    holders.add(holder);
    void created.session.start();
  } else {
    entry.holders.add(holder);
    entry.session.setReadOnly(!sendsChanges(entry));
    if (entry.doc) {
      holder.onReady(entry.doc);
      holder.onStatus(entry.status);
    } else if (entry.unavailable) {
      holder.onUnavailable(entry.unavailable);
    }
  }

  const held = entry;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.holders.delete(holder);
    if (held.holders.size > 0) {
      held.session.setReadOnly(!sendsChanges(held));
      return;
    }
    entries.delete(pageId);
    void held.session
      .dispose()
      .then((bytes) => deps.closed(pageId, bytes))
      .catch(() => {});
    deps.releaseSocket();
  };
}

/** For tests: how many places hold `pageId` open. */
export function holdersOf(pageId: string): number {
  return entries.get(pageId)?.holders.size ?? 0;
}
