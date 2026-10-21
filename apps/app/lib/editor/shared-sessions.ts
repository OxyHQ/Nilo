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
  deps: SessionDeps;
  beforeStart: Promise<void> | null;
  closing: Promise<void> | null;
  holders: Set<SessionHolder>;
  doc: Y.Doc | null;
  status: SyncStatus;
  unavailable: Unavailable | null;
}

const entries = new Map<string, Entry>();
/** A new session must not read a base document while it is being deleted. */
const removals = new Map<string, Promise<void>>();
/** Reopening must not load a base still being compacted by its previous holder. */
const closings = new Map<string, { persisted: Promise<void>; done: Promise<void> }>();
let draining = 0;

function closeEntry(pageId: string, entry: Entry, flush = true): Promise<void> {
  if (entry.closing) return entry.closing;
  if (entries.get(pageId) === entry) entries.delete(pageId);
  // Dispose synchronously to detach callbacks and cancel a deferred start.
  const previous = closings.get(pageId);
  const disposed = entry.session.dispose({ flush });
  // Retention uses OfflinePages' serial index queue. A download removal already
  // holding that queue may wait for persistence, but must not wait for retention.
  const persisted = Promise.allSettled([previous?.persisted, disposed]).then(() => {});
  const closed = Promise.all([entry.beforeStart?.catch(() => {}), disposed])
    .then(([, bytes]) => entry.deps.closed(pageId, bytes))
    .finally(() => {
      entry.deps.releaseSocket();
      if (closings.get(pageId)?.done === closed) closings.delete(pageId);
    });
  entry.closing = closed;
  closings.set(pageId, { persisted, done: closed });
  return closed;
}

/**
 * The account boundary: no new holder or late write may cross the device purge.
 * Disposes without sending queued edits and waits for existing closures/removals.
 * It does not change which accounts retain or clear their documents.
 */
export async function withPageSessionsDrained<T>(purge: () => Promise<T>): Promise<T> {
  draining += 1;
  try {
    const closing = [...entries].map(([pageId, entry]) => closeEntry(pageId, entry, false));
    await Promise.allSettled([
      ...closing,
      ...Array.from(closings.values(), (closing) => closing.done),
      ...removals.values(),
    ]);
    return await purge();
  } finally {
    draining -= 1;
  }
}

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
  // AuthSetup mounts the next account only after its boundary has completed.
  // A stale holder arriving during a purge must never start later.
  if (draining > 0) return () => {};
  let entry = entries.get(pageId);
  if (!entry) {
    const socket = deps.acquireSocket();
    const holders = new Set<SessionHolder>();
    const barriers = [removals.get(pageId), closings.get(pageId)?.done].filter(
      (pending): pending is Promise<void> => pending !== undefined,
    );
    const beforeStart = barriers.length ? Promise.allSettled(barriers).then(() => {}) : null;
    const created: Entry = {
      deps,
      beforeStart,
      closing: null,
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
    if (beforeStart) {
      void beforeStart.then(() => created.session.start());
    } else {
      void created.session.start();
    }
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
    void closeEntry(pageId, held).catch(() => {});
  };
}

/** Download removal must retain the base document until the last editor closes. */
export function isPageSessionOpen(pageId: string): boolean {
  return (entries.get(pageId)?.holders.size ?? 0) > 0;
}

/** Remove a closed clean copy; starts arriving during deletion wait for it. */
export async function removeClosedPageDocument(
  pageId: string,
  store: PageDocStore | null,
): Promise<void> {
  if (isPageSessionOpen(pageId) || !store) return;
  const pending = removals.get(pageId);
  if (pending) return pending;
  const removal = Promise.resolve(closings.get(pageId)?.persisted)
    .catch(() => {})
    .then(() => store.remove(pageId));
  removals.set(pageId, removal);
  try {
    await removal;
  } finally {
    if (removals.get(pageId) === removal) removals.delete(pageId);
  }
}

/** For tests: how many places hold `pageId` open. */
export function holdersOf(pageId: string): number {
  return entries.get(pageId)?.holders.size ?? 0;
}
