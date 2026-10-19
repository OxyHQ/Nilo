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
import { type SessionDeps, holdersOf, holdPageSession } from '../shared-sessions';

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
  return { socket, closed, hold, sockets: () => sockets };
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
