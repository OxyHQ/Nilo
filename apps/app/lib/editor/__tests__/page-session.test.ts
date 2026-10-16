import { EditorStore, emptyDocument, insertBlockAfter } from '@oxy.so/bloom-editor/model';
import { YjsBinding } from '@oxy.so/bloom-editor/yjs';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import * as Y from 'yjs';
import { MemoryPageDocStore } from '../doc-store-types';
import { PageSession, type PageSessionOptions, type SyncStatus } from '../page-session';

jest.mock('expo-sqlite', () => ({}));

type Handler = (...args: never[]) => void;

/** The API's page room, as far as a session sees it. */
class FakeServer {
  readonly doc = new Y.Doc();
  readonly sockets = new Set<FakeSocket>();
  forbidden = false;
  /**
   * Runs while a handshake is being answered, after the state it answers
   * with was read: a change landing in that window.
   */
  duringSync: (() => void) | null = null;
  readOnly = new Set<FakeSocket>();
  locked = false;

  handle(from: FakeSocket, event: string, payload: unknown, ack?: (reply: unknown) => void) {
    const reply = ack ?? (() => {});
    if (event === 'page:join')
      return reply(this.forbidden ? { ok: false, error: 'Forbidden' } : { ok: true });
    if (event === 'page:leave' || event === 'page:focus') return;
    const { stateVector, update } = payload as { stateVector?: Uint8Array; update?: Uint8Array };
    if (event === 'doc:sync' && this.duringSync) {
      const answer = {
        ok: true,
        update: Y.encodeStateAsUpdate(this.doc, stateVector),
        stateVector: Y.encodeStateVector(this.doc),
      };
      const during = this.duringSync;
      this.duringSync = null;
      during();
      // The answer leaves after the broadcast, as it can over the network.
      return setTimeout(() => reply(answer), 20);
    }
    if (event === 'doc:sync') {
      return reply({
        ok: true,
        update: Y.encodeStateAsUpdate(this.doc, stateVector),
        stateVector: Y.encodeStateVector(this.doc),
      });
    }
    if (event === 'doc:update' && update) {
      if (this.readOnly.has(from)) return reply({ ok: false, code: 'READ_ONLY' });
      if (this.locked) return reply({ ok: false, code: 'PAGE_LOCKED' });
      Y.applyUpdate(this.doc, update);
      for (const other of this.sockets) {
        if (other !== from && other.connected)
          other.deliver('doc:update', { pageId: 'page', update });
      }
      return reply({ ok: true });
    }
  }
}

class FakeSocket {
  connected = false;
  private readonly handlers = new Map<string, Set<Handler>>();
  constructor(private readonly server: FakeServer) {
    server.sockets.add(this);
  }
  on(event: string, handler: Handler) {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }
  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler);
  }
  emit(event: string, payload: unknown, ack?: (reply: never) => void) {
    if (!this.connected) return;
    // Over the network: never synchronous.
    queueMicrotask(() => this.server.handle(this, event, payload, ack as (reply: unknown) => void));
  }
  deliver(event: string, payload: unknown) {
    queueMicrotask(() => {
      for (const handler of this.handlers.get(event) ?? [])
        (handler as (p: unknown) => void)(payload);
    });
  }
  connect() {
    this.connected = true;
    for (const handler of this.handlers.get('connect') ?? []) (handler as () => void)();
  }
  disconnect() {
    this.connected = false;
    for (const handler of this.handlers.get('disconnect') ?? []) (handler as () => void)();
  }
}

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 70));
};

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
