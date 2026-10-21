import {
  appendChild,
  EditorStore,
  emptyDocument,
  insertBlockAfter,
} from '@oxy.so/bloom-editor/model';
import { YjsBinding } from '@oxy.so/bloom-editor/yjs';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import * as Y from 'yjs';
import { FakeServer, FakeSocket, settle } from '@/test-support/fake-room';
import { MemoryPageDocStore } from '../doc-store-types';
import type { SessionSocket } from '../page-session';
import {
  type SessionDeps,
  holdersOf,
  holdPageSession,
  isPageSessionOpen,
  removeClosedPageDocument,
  withPageSessionsDrained,
} from '../shared-sessions';
import { OfflinePages } from '../offline-pages';

jest.mock('expo-sqlite', () => ({}));
// The app's socket is the default; these tests hand the session their own.
jest.mock('@/lib/realtime/socket', () => ({ acquireSocket: jest.fn(), releaseSocket: jest.fn() }));

let ids = 0;
const newId = () => {
  ids += 1;
  return `shared-${ids}`;
};

/** One device: one socket, shared by everything that holds a page open on it. */
function device(server: FakeServer) {
  const socket = new FakeSocket(server);
  socket.connect();
  const closed: string[] = [];
  let sockets = 0;
  const deps: SessionDeps = {
    acquireSocket: () => {
      sockets += 1;
      return socket as unknown as SessionSocket;
    },
    releaseSocket: () => {
      sockets -= 1;
    },
    store: new MemoryPageDocStore(),
    closed: async (pageId) => {
      closed.push(pageId);
    },
  };
  /** A place showing the page: its own store, bound to the shared document. */
  const hold = (readOnly = false) => {
    const held: { store: EditorStore | null; statuses: string[]; binding: YjsBinding | null } = {
      store: null,
      statuses: [],
      binding: null,
    };
    const release = holdPageSession(
      'page',
      {
        readOnly,
        onReady: (doc) => {
          const store = new EditorStore({ document: emptyDocument(), schema: NILO_SCHEMA, newId });
          held.binding = new YjsBinding(store, doc, { readOnly });
          held.store = store;
        },
        onStatus: (status) => held.statuses.push(status),
        onRejected: () => {},
        onUnavailable: () => {},
      },
      deps,
    );
    return {
      held,
      release: () => {
        held.binding?.dispose();
        release();
      },
    };
  };
  return { socket, closed, hold, deps, sockets: () => sockets };
}

const texts = (store: EditorStore | null) =>
  Object.values(store?.doc.blocks ?? {})
    .map((block) => block.type)
    .sort();

afterEach(() => {
  expect(holdersOf('page')).toBe(0);
});

it('shows one page in two places on one document, and hears the room in both', async () => {
  const server = new FakeServer();
  const phone = device(server);
  const page = phone.hold();
  await settle();
  // The same page shown again (a synced block of it): no second join.
  const embedded = phone.hold();
  expect(holdersOf('page')).toBe(2);
  expect(embedded.held.store).not.toBeNull();
  expect(phone.socket.sent.filter((e) => e === 'page:join')).toHaveLength(1);

  // An edit in one place is in the other at once, and reaches the server.
  const store = embedded.held.store as EditorStore;
  store.run((c) => insertBlockAfter(c, null, 'sync_block'));
  const original = store.doc.root[0] as string;
  store.run((c) => appendChild(c, original, 'paragraph'));
  expect(texts(page.held.store)).toEqual(['paragraph', 'sync_block']);
  await settle();
  const onServer = new Y.Doc();
  Y.applyUpdate(onServer, Y.encodeStateAsUpdate(server.doc));
  expect(onServer.getMap('blocks').size).toBe(2);

  // Someone else's edit reaches both.
  const laptop = device(server);
  // A second device would hold its own session; this one only writes.
  const writer = new Y.Doc();
  Y.applyUpdate(writer, Y.encodeStateAsUpdate(server.doc));
  const writerStore = new EditorStore({ document: emptyDocument(), schema: NILO_SCHEMA, newId });
  const binding = new YjsBinding(writerStore, writer);
  writerStore.run((c) => insertBlockAfter(c, original, 'divider'));
  const update = Y.encodeStateAsUpdate(writer, Y.encodeStateVector(server.doc));
  laptop.socket.emit('doc:update', { pageId: 'page', update }, () => {});
  await settle();
  expect(texts(page.held.store)).toEqual(['divider', 'paragraph', 'sync_block']);
  expect(texts(embedded.held.store)).toEqual(['divider', 'paragraph', 'sync_block']);
  binding.dispose();

  // Closing one place keeps the page in the room for the other.
  embedded.release();
  expect(phone.socket.sent).not.toContain('page:leave');
  expect(phone.closed).toEqual([]);
  page.release();
  await settle();
  expect(phone.socket.sent.filter((e) => e === 'page:leave')).toHaveLength(1);
  expect(phone.closed).toEqual(['page']);
  expect(phone.sockets()).toBe(0);
});

it('sends changes while anyone holding the page may edit it', async () => {
  const server = new FakeServer();
  const phone = device(server);
  // First opened by a reader: nothing is sent.
  const reader = phone.hold(true);
  await settle();
  expect(phone.socket.sent).not.toContain('doc:update');

  // Then by someone who edits it here as well: their edits go out.
  const editor = phone.hold(false);
  await settle();
  (editor.held.store as EditorStore).run((c) => insertBlockAfter(c, null, 'paragraph'));
  await settle();
  expect(phone.socket.sent).toContain('doc:update');
  const onServer = new Y.Doc();
  Y.applyUpdate(onServer, Y.encodeStateAsUpdate(server.doc));
  expect(onServer.getMap('blocks').size).toBe(1);
  // The reader sees it too.
  expect(texts(reader.held.store)).toEqual(['paragraph']);

  editor.release();
  reader.release();
  await settle();
});

it('opens again after the last place closed it', async () => {
  const server = new FakeServer();
  const phone = device(server);
  const first = phone.hold();
  await settle();
  first.release();
  const again = phone.hold();
  await settle();
  expect(again.held.store).not.toBeNull();
  expect(phone.socket.sent.filter((e) => e === 'page:join')).toHaveLength(2);
  again.release();
  await settle();
});

it('keeps an open document base and file references when downloads are removed before another offline edit', async () => {
  const server = new FakeServer();
  const phone = device(server);
  const files = new Map<string, string>();
  const docs = phone.deps.store as MemoryPageDocStore;
  const pages = new OfflinePages(
    {
      read: async (name) => files.get(name) ?? null,
      write: async (name, text) => void files.set(name, text),
      remove: async (name) => void files.delete(name),
      clear: async () => files.clear(),
    },
    docs,
  );
  phone.deps.closed = async (pageId, bytes) => {
    if (await pages.keeps(pageId)) await pages.saved(pageId, bytes);
    else await docs.remove(pageId);
  };
  await pages.setPinned('page', true);
  const editor = phone.hold();
  await settle();
  try {
    const store = editor.held.store as EditorStore;
    store.run((c) => insertBlockAfter(c, null, 'image', { props: { fileId: 'kept-file' } }));
    await settle();
    expect(await docs.isDirty('page')).toBe(false);
    expect(isPageSessionOpen('page')).toBe(true);
    phone.socket.disconnect();

    await pages.removeDownloads(removeClosedPageDocument);
    expect(await pages.keeps('page')).toBe(false);
    expect(await docs.load('page')).not.toBeNull();
    store.run((c) =>
      insertBlockAfter(c, store.doc.root[0], 'paragraph', { text: [{ text: 'Unsent' }] }),
    );
    await settle();

    // Recover only persisted updates, before closing/compacting the live session:
    // an offline crash at this point must preserve both the base and its delta.
    const persisted = await docs.load('page');
    expect(persisted?.dirty).toBe(true);
    const recovered = new Y.Doc();
    Y.applyUpdate(recovered, Y.mergeUpdates(persisted?.updates ?? []));
    const recoveredStore = new EditorStore({
      document: emptyDocument(),
      schema: NILO_SCHEMA,
      newId,
    });
    const binding = new YjsBinding(recoveredStore, recovered, { readOnly: true });
    expect(recoveredStore.doc).toEqual(store.doc);
    expect(
      Object.values(recoveredStore.doc.blocks).some((block) => block.props.fileId === 'kept-file'),
    ).toBe(true);
    binding.dispose();
    recovered.destroy();
  } finally {
    editor.release();
    await settle();
  }
  expect(isPageSessionOpen('page')).toBe(false);
  expect(await docs.isDirty('page')).toBe(true);
  // Reopen the same page offline after its download index entry was removed.
  const reopened = phone.hold();
  await settle();
  try {
    expect(texts(reopened.held.store)).toEqual(['image', 'paragraph']);
    expect(
      Object.values(reopened.held.store?.doc.blocks ?? {}).some(
        (block) => block.props.fileId === 'kept-file',
      ),
    ).toBe(true);
    expect(
      Object.values(reopened.held.store?.doc.blocks ?? {}).some((block) =>
        block.text?.some((span) => span.text === 'Unsent'),
      ),
    ).toBe(true);
  } finally {
    reopened.release();
    await settle();
  }
  await pages.clear();
  expect(await docs.load('page')).toBeNull();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('waits for an in-flight removal before loading a newly opened page', async () => {
  const server = new FakeServer();
  server.doc.getText('base').insert(0, 'Existing base');
  const phone = device(server);
  const docs = phone.deps.store as MemoryPageDocStore;
  await docs.append('page', Y.encodeStateAsUpdate(server.doc), false);
  const paused = deferred();
  const remove = docs.remove.bind(docs);
  jest.spyOn(docs, 'remove').mockImplementationOnce(async (id) => {
    await paused.promise;
    await remove(id);
  });
  const load = jest.spyOn(docs, 'load');
  const removing = removeClosedPageDocument('page', docs);
  const editor = phone.hold();
  try {
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
    expect(editor.held.store).toBeNull();
    paused.resolve();
    await removing;
    await settle();
    expect(editor.held.store).not.toBeNull();
    phone.socket.disconnect();
    (editor.held.store as EditorStore).run((c) =>
      insertBlockAfter(c, null, 'paragraph', { text: [{ text: 'Later edit' }] }),
    );
    await settle();
    const recovered = new Y.Doc();
    Y.applyUpdate(recovered, Y.mergeUpdates((await docs.load('page'))?.updates ?? []));
    expect(recovered.getText('base').toString()).toBe('Existing base');
    expect(recovered.getMap('blocks').size).toBe(1);
    recovered.destroy();
  } finally {
    paused.resolve();
    editor.release();
    await settle();
  }
});

it('does not start or compact an opening cancelled while removal is pending', async () => {
  const phone = device(new FakeServer());
  const docs = phone.deps.store as MemoryPageDocStore;
  const paused = deferred();
  jest.spyOn(docs, 'remove').mockImplementationOnce(() => paused.promise);
  const load = jest.spyOn(docs, 'load');
  const compact = jest.spyOn(docs, 'compact');
  const removing = removeClosedPageDocument('page', docs);
  const editor = phone.hold();
  editor.release();
  paused.resolve();
  await removing;
  await settle();

  expect(load).not.toHaveBeenCalled();
  expect(compact).not.toHaveBeenCalled();
  expect(phone.socket.sent).not.toContain('page:join');
  expect(phone.sockets()).toBe(0);
  expect(editor.held.store).toBeNull();
});

it('reports a removal failure and releases the guard for waiting and future openings', async () => {
  const server = new FakeServer();
  const phone = device(server);
  const docs = phone.deps.store as MemoryPageDocStore;
  await docs.append('page', Y.encodeStateAsUpdate(server.doc), false);
  const paused = deferred();
  jest.spyOn(docs, 'remove').mockImplementationOnce(async () => {
    await paused.promise;
    throw new Error('Storage failed');
  });
  const removing = removeClosedPageDocument('page', docs);
  const failure = expect(removing).rejects.toThrow('Storage failed');
  const editor = phone.hold();
  paused.resolve();
  await failure;
  try {
    await settle();
    expect(editor.held.store).not.toBeNull();
  } finally {
    editor.release();
    await settle();
  }
  // No rejected promise remains installed as a permanent deletion guard.
  await removeClosedPageDocument('page', docs);
  expect(await docs.load('page')).toBeNull();
});

it('waits for the previous close before reopening and preserves the next edit durably', async () => {
  const phone = device(new FakeServer());
  const docs = phone.deps.store as MemoryPageDocStore;
  const first = phone.hold();
  await settle();
  phone.socket.disconnect();
  (first.held.store as EditorStore).run((c) =>
    insertBlockAfter(c, null, 'paragraph', { text: [{ text: 'A' }] }),
  );
  await settle();
  const pending = deferred();
  const compact = docs.compact.bind(docs);
  jest.spyOn(docs, 'compact').mockImplementationOnce(async (...args) => {
    await pending.promise;
    await compact(...args);
  });
  first.release();
  const load = jest.spyOn(docs, 'load');
  const second = phone.hold();
  try {
    await settle();
    expect(second.held.store).toBeNull();
    expect(load).not.toHaveBeenCalled();
    pending.resolve();
    await settle();
    const next = second.held.store as EditorStore;
    next.run((c) =>
      insertBlockAfter(c, next.doc.root.at(-1) ?? null, 'paragraph', { text: [{ text: 'B' }] }),
    );
    await settle();
    const persisted = await docs.load('page');
    const recovered = new Y.Doc();
    Y.applyUpdate(recovered, Y.mergeUpdates(persisted?.updates ?? []));
    expect(recovered.getMap('blocks').size).toBe(2);
    expect(persisted?.dirty).toBe(true);
    recovered.destroy();
  } finally {
    pending.resolve();
    second.release();
    await settle();
  }
});

it('cancels a reopening during close without starting a late session', async () => {
  const phone = device(new FakeServer());
  const docs = phone.deps.store as MemoryPageDocStore;
  const first = phone.hold();
  await settle();
  const pending = deferred();
  const compact = docs.compact.bind(docs);
  jest.spyOn(docs, 'compact').mockImplementationOnce(async (...args) => {
    await pending.promise;
    await compact(...args);
  });
  first.release();
  const joins = phone.socket.sent.filter((event) => event === 'page:join').length;
  const load = jest.spyOn(docs, 'load');
  const cancelled = phone.hold();
  cancelled.release();
  pending.resolve();
  await settle();
  expect(load).not.toHaveBeenCalled();
  expect(cancelled.held.store).toBeNull();
  expect(phone.socket.sent.filter((event) => event === 'page:join')).toHaveLength(joins);
  expect(phone.sockets()).toBe(0);
});

it('drains pending writes before a purge and ignores late callbacks and stale holders afterward', async () => {
  const server = new FakeServer();
  const phone = device(server);
  const docs = phone.deps.store as MemoryPageDocStore;
  const old = phone.hold();
  await settle();
  const pending = deferred();
  const append = docs.append.bind(docs);
  const appendSpy = jest.spyOn(docs, 'append').mockImplementationOnce(async (...args) => {
    await pending.promise;
    await append(...args);
  });
  let lateAck: (() => void) | undefined;
  const handle = server.handle.bind(server);
  jest.spyOn(server, 'handle').mockImplementation((socket, event, payload, ack) => {
    handle(
      socket,
      event,
      payload,
      event === 'doc:update'
        ? (reply) => {
            lateAck = () => ack?.(reply);
          }
        : ack,
    );
  });
  (old.held.store as EditorStore).run((c) =>
    insertBlockAfter(c, null, 'paragraph', { text: [{ text: 'Unsent on device' }] }),
  );
  await settle();
  expect(lateAck).toBeDefined();
  let cleared = false;
  const purging = withPageSessionsDrained(async () => {
    await docs.clear();
    cleared = true;
  });
  const cancelled = phone.hold();
  cancelled.release();
  await Promise.resolve();
  expect(cleared).toBe(false);
  expect(cancelled.held.store).toBeNull();
  pending.resolve();
  await purging;
  expect(await docs.load('page')).toBeNull();
  const writes = appendSpy.mock.calls.length;
  const sends = phone.socket.sent.length;
  lateAck?.();
  phone.socket.deliver('doc:update', { pageId: 'page', update: Y.encodeStateAsUpdate(server.doc) });
  await settle();
  expect(appendSpy).toHaveBeenCalledTimes(writes);
  expect(phone.socket.sent).toHaveLength(sends);
  expect(await docs.load('page')).toBeNull();
  const current = phone.hold();
  try {
    await settle();
    expect(current.held.store).not.toBeNull();
    expect(current.held.store).not.toBe(old.held.store);
    old.release();
    expect(holdersOf('page')).toBe(1);
  } finally {
    current.release();
    await settle();
  }
});

it('removes downloads during a pending close without deadlocking the retention queue or purge', async () => {
  const phone = device(new FakeServer());
  const docs = phone.deps.store as MemoryPageDocStore;
  const files = new Map<string, string>();
  const pages = new OfflinePages(
    {
      read: async (name) => files.get(name) ?? null,
      write: async (name, value) => void files.set(name, value),
      remove: async (name) => void files.delete(name),
      clear: async () => files.clear(),
    },
    docs,
  );
  phone.deps.closed = async (id, bytes) => {
    if (await pages.keeps(id)) await pages.saved(id, bytes);
    else await docs.remove(id);
  };
  await pages.setPinned('page', true);
  const first = phone.hold();
  await settle();
  phone.socket.disconnect();
  (first.held.store as EditorStore).run((c) =>
    insertBlockAfter(c, null, 'paragraph', { text: [{ text: 'Retain draft' }] }),
  );
  await settle();
  const pending = deferred();
  const compact = docs.compact.bind(docs);
  jest.spyOn(docs, 'compact').mockImplementationOnce(async (...args) => {
    await pending.promise;
    await compact(...args);
  });
  first.release();
  let enteredRemoval!: () => void;
  const removingStarted = new Promise<void>((resolve) => {
    enteredRemoval = resolve;
  });
  const removing = pages.removeDownloads(async (id, store) => {
    enteredRemoval();
    await removeClosedPageDocument(id, store);
  });
  await removingStarted;
  let purged = false;
  const purging = withPageSessionsDrained(async () => {
    // Dirty work survived removing the download choices before the privacy purge.
    expect(await docs.isDirty('page')).toBe(true);
    expect(await pages.list()).toEqual([]);
    await pages.clear();
    purged = true;
  });
  pending.resolve();
  await Promise.all([removing, purging]);
  expect(purged).toBe(true);
  expect(phone.sockets()).toBe(0);
  expect(await docs.load('page')).toBeNull();
});
