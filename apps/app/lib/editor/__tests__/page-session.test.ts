import { EditorStore, emptyDocument, insertBlockAfter } from '@oxy.so/bloom-editor/model';
import { YjsBinding } from '@oxy.so/bloom-editor/yjs';
import { MAX_DOC_UPDATE_BYTES } from '@oxy.so/nilo-contracts';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import * as Y from 'yjs';
import { MemoryPageDocStore } from '../doc-store-types';
import { PageSession, type PageSessionOptions, type SyncStatus } from '../page-session';
import { FakeServer, FakeSocket, settle } from '@/test-support/fake-room';

jest.mock('expo-sqlite', () => ({}));

let ids = 0;
interface Device {
  socket: FakeSocket;
  session: PageSession;
  docs: MemoryPageDocStore;
  store: () => EditorStore;
  statuses: SyncStatus[];
  unavailable: string[];
  rejected: string[];
}

async function device(
  server: FakeServer,
  options: { docs?: MemoryPageDocStore; readOnly?: boolean; online?: boolean } = {},
): Promise<Device> {
  const socket = new FakeSocket(server);
  const docs = options.docs ?? new MemoryPageDocStore();
  let store: EditorStore | null = null;
  const statuses: SyncStatus[] = [];
  const unavailable: string[] = [];
  const rejected: string[] = [];
  const session = new PageSession({
    pageId: 'page',
    socket: socket as unknown as PageSessionOptions['socket'],
    store: docs,
    readOnly: options.readOnly ?? false,
    onReady: (doc) => {
      store = new EditorStore({
        document: emptyDocument(),
        schema: NILO_SCHEMA,
        newId: () => {
          ids += 1;
          return `block-${ids}`;
        },
      });
      new YjsBinding(store, doc, { readOnly: options.readOnly });
    },
    onStatus: (status) => statuses.push(status),
    onRejected: (code) => rejected.push(code),
    onUnavailable: (reason) => unavailable.push(reason),
  });
  if (options.online !== false) socket.connected = true;
  await session.start();
  await settle();
  return {
    socket,
    session,
    docs,
    store: () => {
      if (!store) throw new Error('not ready');
      return store;
    },
    statuses,
    unavailable,
    rejected,
  };
}

const texts = (store: EditorStore) =>
  store.doc.root.map((id) => (store.doc.blocks[id]?.text ?? []).map((s) => s.text).join(''));

const write = (store: EditorStore, text: string) =>
  store.dispatch(
    insertBlockAfter(store.context(), store.doc.root.at(-1) ?? null, 'paragraph', {
      text: [{ text }],
    }),
  );

it('opens from the server and carries edits between two devices', async () => {
  const server = new FakeServer();
  const a = await device(server);
  const b = await device(server);
  write(a.store(), 'uno');
  await settle();
  expect(texts(b.store())).toEqual(['uno']);
  write(b.store(), 'dos');
  await settle();
  expect(texts(a.store())).toEqual(['uno', 'dos']);
  expect(a.statuses.at(-1)).toBe('saved');
  expect(await a.docs.isDirty('page')).toBe(false);
});

it('opens offline from what the device kept, and sends what was done offline when back', async () => {
  const server = new FakeServer();
  const first = await device(server);
  write(first.store(), 'antes');
  await settle();
  await first.session.dispose();

  // Later, offline, on the same device.
  const offline = await device(server, { docs: first.docs, online: false });
  expect(texts(offline.store())).toEqual(['antes']);
  write(offline.store(), 'sin conexión');
  await settle();
  expect(offline.statuses.at(-1)).toBe('offline');
  expect(await offline.docs.isDirty('page')).toBe(true);
  const other = await device(server);
  write(other.store(), 'mientras');
  await settle();

  offline.socket.connect();
  await settle();
  expect(texts(offline.store()).sort()).toEqual(['antes', 'mientras', 'sin conexión']);
  expect(texts(other.store()).sort()).toEqual(texts(offline.store()).sort());
  expect(await offline.docs.isDirty('page')).toBe(false);
  expect(offline.statuses.at(-1)).toBe('saved');
});

it('says when a page cannot be opened: offline with nothing kept, or no access', async () => {
  const server = new FakeServer();
  const offline = await device(server, { online: false });
  expect(offline.unavailable).toEqual(['offline']);
  server.forbidden = true;
  const shut = await device(server);
  expect(shut.unavailable).toEqual(['forbidden']);
});

it('sends nothing from a read-only page, and keeps it live', async () => {
  const server = new FakeServer();
  const editor = await device(server);
  const reader = await device(server, { readOnly: true });
  write(editor.store(), 'para leer');
  await settle();
  expect(texts(reader.store())).toEqual(['para leer']);
  write(reader.store(), 'no');
  await settle();
  expect(texts(editor.store())).toEqual(['para leer']);
});

it('reports a change the server refuses', async () => {
  const server = new FakeServer();
  const a = await device(server);
  server.locked = true;
  write(a.store(), 'tarde');
  await settle();
  expect(a.rejected).toEqual(['PAGE_LOCKED']);
  expect(a.statuses.at(-1)).toBe('error');
});

it('says a change is too large to save rather than sending it, and saves once it is undone', async () => {
  const server = new FakeServer();
  const a = await device(server);
  write(a.store(), 'x'.repeat(MAX_DOC_UPDATE_BYTES + 1));
  await settle();
  expect(a.rejected).toEqual(['UPDATE_TOO_LARGE']);
  expect(a.statuses.at(-1)).toBe('error');
  expect(server.doc.getMap('blocks').size).toBe(0);

  // Undone, what is left to send is small: the next handshake saves it.
  expect(a.store().undo()).toBe(true);
  write(a.store(), 'pequeño');
  a.socket.disconnect();
  a.socket.connect();
  await settle();
  expect(a.statuses.at(-1)).toBe('saved');
  const other = await device(server);
  expect(texts(other.store())).toEqual(['pequeño']);
});

it('keeps a change broadcast while its handshake was still answering', async () => {
  const server = new FakeServer();
  const a = await device(server);
  write(a.store(), 'antes');
  await settle();
  // While b's handshake is answered from the state read before it, a change
  // reaches the server and is broadcast: it is in the broadcast alone.
  server.duringSync = () => {
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(server.doc));
    const store = new EditorStore({
      document: emptyDocument(),
      schema: NILO_SCHEMA,
      newId: () => 'late',
    });
    new YjsBinding(store, other);
    const before = Y.encodeStateVector(other);
    write(store, 'durante');
    const update = Y.encodeStateAsUpdate(other, before);
    Y.applyUpdate(server.doc, update);
    for (const socket of server.sockets) {
      if (socket.connected) socket.deliver('doc:update', { pageId: 'page', update });
    }
  };
  const b = await device(server);
  await settle();
  expect(texts(b.store())).toEqual(['antes', 'durante']);
});

function deferredWrite() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('preserves an unsent draft when reopened read-only and sends it after editing is allowed again', async () => {
  const server = new FakeServer();
  const first = await device(server);
  write(first.store(), 'server base');
  await settle();
  first.socket.disconnect();
  write(first.store(), 'unsent draft');
  await settle();
  await first.session.dispose();
  expect(await first.docs.isDirty('page')).toBe(true);

  const reader = await device(server, { docs: first.docs, readOnly: true });
  expect(texts(reader.store())).toEqual(['server base', 'unsent draft']);
  expect(server.doc.getMap('blocks').size).toBe(1);
  expect(await reader.docs.isDirty('page')).toBe(true);
  expect(reader.statuses.at(-1)).toBe('error');
  expect(reader.rejected).toEqual(['READ_ONLY']);
  reader.session.setReadOnly(false);
  await settle();
  expect(server.doc.getMap('blocks').size).toBe(2);
  expect(await reader.docs.isDirty('page')).toBe(false);
  expect(reader.statuses.at(-1)).toBe('saved');
  await reader.session.dispose();
});

it('waits for a pending append before compacting the document on close', async () => {
  const current = await device(new FakeServer());
  write(current.store(), 'base');
  await settle();
  current.socket.disconnect();
  const pending = deferredWrite();
  const append = current.docs.append.bind(current.docs);
  jest.spyOn(current.docs, 'append').mockImplementationOnce(async (...args) => {
    await pending.promise;
    await append(...args);
  });
  const compact = jest.spyOn(current.docs, 'compact');
  write(current.store(), 'pending');
  const closing = current.session.dispose();
  await Promise.resolve();
  expect(compact).not.toHaveBeenCalled();
  pending.resolve();
  await closing;
  const recovered = new Y.Doc();
  Y.applyUpdate(recovered, Y.mergeUpdates((await current.docs.load('page'))?.updates ?? []));
  expect(recovered.getMap('blocks').size).toBe(2);
  expect(await current.docs.isDirty('page')).toBe(true);
  recovered.destroy();
});

it('does not publish saved or clear dirty before the acknowledged append is durable', async () => {
  const current = await device(new FakeServer());
  const pending = deferredWrite();
  const append = current.docs.append.bind(current.docs);
  jest.spyOn(current.docs, 'append').mockImplementationOnce(async (...args) => {
    await pending.promise;
    await append(...args);
  });
  const synced = jest.spyOn(current.docs, 'markSynced');
  write(current.store(), 'acknowledged but still writing');
  await settle();
  expect(current.statuses.at(-1)).toBe('saving');
  expect(synced).not.toHaveBeenCalled();
  pending.resolve();
  await settle();
  expect(current.statuses.at(-1)).toBe('saved');
  expect(await current.docs.isDirty('page')).toBe(false);
  await current.session.dispose();
});
