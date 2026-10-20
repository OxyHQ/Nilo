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
