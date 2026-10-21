import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { EditorStore, emptyDocument, insertBlockAfter } from '@oxy.so/bloom-editor/model';
import { YjsBinding } from '@oxy.so/bloom-editor/yjs';
import { MAX_DOC_UPDATE_BYTES } from '@oxy.so/nilo-contracts';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  closeTestDb,
  getTestDb,
  seedWorkspace,
  testDatabaseUrl,
  type TestDatabase,
} from '../db/__tests__/testDatabase.js';
import { closeDb } from '../db/client.js';
import { pages } from '../db/schema/pages.js';
import { workspaceMembers } from '../db/schema/workspaces.js';
import { blocks, pages as pagesTable } from '../db/schema/pages.js';
import { flushProjections } from '../lib/page-projection.js';
import { registerPageDocs, SOCKET_MAX_MESSAGE_BYTES } from './page-docs.js';
import { registerPageRooms } from './page-rooms.js';
import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxy.so/db';

vi.mock('../socket.js', () => ({ getIO: () => io }));
vi.mock('../lib/notification-service.js', () => ({ sendNotification: vi.fn() }));
import { ensureDefaultTeamspace } from '../repositories/teamspaces.js';

let db: TestDatabase;
let httpServer: http.Server;
let io: Server;
let origin: string;
let pageId: string;
let previousDatabaseUrl: string | undefined;
const clients: ClientSocket[] = [];

/** A client authenticated as `userId` (the Oxy middleware is out of scope here). */
async function client(userId: string): Promise<ClientSocket> {
  const socket = connect(origin, {
    auth: { userId },
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
  });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return socket;
}

function join(socket: ClientSocket, id: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => socket.emit('page:join', id, resolve));
}

function next<T>(
  socket: ClientSocket,
  event: string,
  accept: (payload: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve) => {
    const handler = (payload: T) => {
      if (!accept(payload)) return;
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

beforeAll(async () => {
  db = await getTestDb();
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const workspaceId = await seedWorkspace(db, 'page-rooms');
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: 'alice', role: 'editor' },
    { workspaceId, userId: 'bob', role: 'viewer' },
  ]);
  // In the workspace's open teamspace: every member reaches it.
  const teamspace = await ensureDefaultTeamspace(db, workspaceId, 'alice');
  const [page] = await db
    .insert(pages)
    .values({
      workspaceId,
      ownerId: 'alice',
      title: 'Shared',
      blocksVersion: 7,
      teamspaceId: teamspace.id,
    })
    .returning({ id: pages.id });
  pageId = page?.id as string;

  httpServer = http.createServer();
  io = new Server(httpServer, { maxHttpBufferSize: SOCKET_MAX_MESSAGE_BYTES });
  io.use((socket, nextMiddleware) => {
    socket.data.userId = socket.handshake.auth.userId;
    nextMiddleware();
  });
  io.on('connection', (socket) => {
    registerPageRooms(io, socket);
    registerPageDocs(io, socket);
  });
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  io.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousDatabaseUrl;
});

describe('page rooms', () => {
  it('refuses someone outside the workspace and an invalid id', async () => {
    const mallory = await client('mallory');
    expect(await join(mallory, pageId)).toEqual({ ok: false, error: 'Forbidden' });
    expect((await join(mallory, 'not-an-id')).ok).toBe(false);
  });

  it('admits members and shows who is there', async () => {
    const alice = await client('alice');
    const bob = await client('bob');
    expect(await join(alice, pageId)).toEqual({ ok: true });

    const presence = next<{ users: { userId: string }[] }>(
      alice,
      'page:presence',
      (p) => p.users.length === 2,
    );
    expect((await join(bob, pageId)).ok).toBe(true);
    const { users } = await presence;
    expect(users.map((u) => u.userId).sort()).toEqual(['alice', 'bob']);

    // A move once the room is settled: only the one who moved, not the whole room.
    const focused = next<Move>(bob, 'page:presence:focus', (p) => p.userId === 'alice');
    alice.emit('page:focus', { pageId, blockId: '0192f0c4-7d4e-7c2a-9b1e-3f5a6b7c8d9e' });
    expect(await focused).toEqual({
      pageId,
      userId: 'alice',
      blockId: '0192f0c4-7d4e-7c2a-9b1e-3f5a6b7c8d9e',
      selection: null,
    });
  });

  it('carries where in the block a member has selected, and nothing that is not a selection', async () => {
    // The sockets of the test before are not on the page any more.
    for (const old of clients.splice(0)) old.disconnect();
    const alice = await client('alice');
    const bob = await client('bob');
    expect((await join(alice, pageId)).ok).toBe(true);
    expect((await join(bob, pageId)).ok).toBe(true);
    const blockId = '0192f0c4-7d4e-7c2a-9b1e-3f5a6b7c8d9e';
    const position = { type: { client: 7, clock: 3 }, item: { client: 7, clock: 9 }, assoc: 0 };
    const selection = { blockId, start: position, end: { ...position, assoc: -1 } };
    const selected = whereIs(bob, 'alice', (p) => p.selection !== null);
    alice.emit('page:focus', { pageId, blockId, selection });
    expect(await selected).toEqual({ userId: 'alice', blockId, selection });

    // Someone joining then is told where everyone is, the move among them.
    const later = await client('bob');
    const told = next<Presence>(later, 'page:presence', (p) => p.users.length === 2);
    expect((await join(later, pageId)).ok).toBe(true);
    expect((await told).users.find((u) => u.userId === 'alice')).toEqual({
      userId: 'alice',
      blockId,
      selection,
    });

    // A selection in another block than the one focused, or of another shape: none.
    const cleared = whereIs(bob, 'alice', (p) => p.selection === null && p.blockId !== null);
    alice.emit('page:focus', {
      pageId,
      blockId,
      selection: { ...selection, start: { ...position, payload: 'x'.repeat(4096) } },
    });
    expect((await cleared).blockId).toBe(blockId);

    const elsewhere = whereIs(bob, 'alice', (p) => p.blockId === null);
    alice.emit('page:focus', { pageId, blockId: null, selection });
    expect((await elsewhere).selection).toBeNull();
  });
});

type Where = { userId: string; blockId: string | null; selection: unknown };
/** Who is on the page, whole (`page:presence`). */
type Presence = { users: Where[] };
/** One member's move (`page:presence:focus`). */
type Move = Where & { pageId: string };

/**
 * Where `userId` is as `socket` is told it: by their move, or, while a whole
 * list was on its way when they moved, by the list that follows it.
 */
function whereIs(
  socket: ClientSocket,
  userId: string,
  accept: (where: Where) => boolean,
): Promise<Where> {
  return new Promise((resolve) => {
    const done = (where: Where) => {
      socket.off('page:presence:focus', onMove);
      socket.off('page:presence', onList);
      resolve(where);
    };
    const onMove = ({ pageId: _page, ...where }: Move) => {
      if (where.userId === userId && accept(where)) done(where);
    };
    const onList = ({ users }: Presence) => {
      const where = users.find((u) => u.userId === userId);
      if (where && accept(where)) done(where);
    };
    socket.on('page:presence:focus', onMove);
    socket.on('page:presence', onList);
  });
}

type Reply = {
  ok: boolean;
  error?: string;
  code?: string;
  update?: Uint8Array;
  stateVector?: Uint8Array;
};

const emit = (socket: ClientSocket, event: string, payload: unknown) =>
  new Promise<Reply>((resolve) => socket.emit(event, payload, resolve));

const asBytes = (value: unknown) => new Uint8Array(value as ArrayBuffer);

/** An editor on the page: its own document, bound to an editor store, kept in step over the socket. */
async function editor(socket: ClientSocket) {
  const doc = new Y.Doc();
  const synced = await emit(socket, 'doc:sync', { pageId, stateVector: Y.encodeStateVector(doc) });
  expect(synced.ok).toBe(true);
  Y.applyUpdate(doc, asBytes(synced.update), 'server');
  // Real ids: the test database outlives a run, and an id already used on
  // another page is (rightly) never projected onto this one.
  const store = new EditorStore({ document: emptyDocument(), schema: NILO_SCHEMA, newId: uuidv7 });
  const binding = new YjsBinding(store, doc);
  const sent: Promise<Reply>[] = [];
  let online = true;
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'server' || !online) return;
    sent.push(emit(socket, 'doc:update', { pageId, update }));
  });
  socket.on('doc:update', (payload: { pageId: string; update: ArrayBuffer }) => {
    if (payload.pageId === pageId) Y.applyUpdate(doc, asBytes(payload.update), 'server');
  });
  return {
    doc,
    store,
    binding,
    sent,
    goOffline: () => {
      online = false;
    },
    /** Back online: the sync handshake, both ways. */
    reconnect: async () => {
      online = true;
      const reply = await emit(socket, 'doc:sync', {
        pageId,
        stateVector: Y.encodeStateVector(doc),
      });
      Y.applyUpdate(doc, asBytes(reply.update), 'server');
      const missing = Y.encodeStateAsUpdate(doc, asBytes(reply.stateVector));
      return emit(socket, 'doc:update', { pageId, update: missing });
    },
  };
}

const texts = (store: EditorStore) =>
  store.doc.root.map((id) => (store.doc.blocks[id]?.text ?? []).map((s) => s.text).join(''));

describe('page documents', () => {
  it('needs the page joined first', async () => {
    const carol = await client('alice');
    expect((await emit(carol, 'doc:sync', { pageId, stateVector: new Uint8Array() })).ok).toBe(
      false,
    );
  });

  it('carries an edit to everyone on the page, and refuses one from a viewer', async () => {
    const aliceSocket = await client('alice');
    const bobSocket = await client('bob');
    await join(aliceSocket, pageId);
    await join(bobSocket, pageId);
    const alice = await editor(aliceSocket);
    const bob = await editor(bobSocket);

    const outsider = await client('projection-outsider');
    expect((await join(outsider, pageId)).ok).toBe(false);
    const privateEvent = vi.fn();
    outsider.on('page:projected', privateEvent);
    const authorProjected = next<{ pageId: string }>(aliceSocket, 'page:projected');
    const viewerProjected = next<{ pageId: string }>(bobSocket, 'page:projected');
    const arrived = next(bobSocket, 'doc:update');
    alice.store.dispatch(
      insertBlockAfter(alice.store.context(), null, 'paragraph', { text: [{ text: 'Hola' }] }),
    );
    await Promise.all(alice.sent);
    await arrived;
    expect(texts(bob.store)).toEqual(['Hola']);

    // A viewer's change is refused (its app does not send one).
    bob.store.dispatch(
      insertBlockAfter(bob.store.context(), null, 'paragraph', { text: [{ text: 'No' }] }),
    );
    const refused = await Promise.all(bob.sent);
    expect(refused.at(-1)).toMatchObject({ ok: false, code: 'READ_ONLY' });

    // The rows follow the document.
    await flushProjections();
    const rows = await db.select().from(blocks).where(eq(blocks.pageId, pageId));
    expect(rows.map((r) => (r.content as { text?: string }).text)).toEqual(['Hola']);
    const [page] = await db.select().from(pagesTable).where(eq(pagesTable.id, pageId));
    expect(page?.lastEditedBy).toBe('alice');
    expect(await authorProjected).toEqual({ pageId });
    expect(await viewerProjected).toEqual({ pageId });
    expect(privateEvent).not.toHaveBeenCalled();
  });

  it("answers a change over Socket.IO's 1 MB default, and refuses one over the limit", async () => {
    const aliceSocket = await client('alice');
    await join(aliceSocket, pageId);
    const big = (text: string) => {
      const doc = new Y.Doc();
      const block = new Y.Map<unknown>();
      doc.getMap<Y.Map<unknown>>('blocks').set(uuidv7(), block);
      block.set('type', 'paragraph');
      block.set('parent', null);
      block.set('index', 'zz');
      block.set('props', new Y.Map());
      const ytext = new Y.Text();
      block.set('text', ytext);
      ytext.insert(0, text);
      return Y.encodeStateAsUpdate(doc);
    };
    const accepted = big('a'.repeat(1_500_000));
    expect(await emit(aliceSocket, 'doc:update', { pageId, update: accepted })).toEqual({
      ok: true,
    });
    const refused = big('b'.repeat(MAX_DOC_UPDATE_BYTES));
    expect(await emit(aliceSocket, 'doc:update', { pageId, update: refused })).toMatchObject({
      ok: false,
      code: 'UPDATE_TOO_LARGE',
    });
    expect(aliceSocket.connected).toBe(true);
  });

  it('merges work done offline when its editor comes back', async () => {
    const aliceSocket = await client('alice');
    const otherSocket = await client('alice');
    await join(aliceSocket, pageId);
    await join(otherSocket, pageId);
    const alice = await editor(aliceSocket);
    const other = await editor(otherSocket);

    alice.goOffline();
    const last = alice.store.doc.root.at(-1) ?? null;
    alice.store.dispatch(
      insertBlockAfter(alice.store.context(), last, 'paragraph', { text: [{ text: 'offline' }] }),
    );
    other.store.dispatch(
      insertBlockAfter(other.store.context(), null, 'paragraph', { text: [{ text: 'online' }] }),
    );
    await Promise.all(other.sent);

    const arrived = next(otherSocket, 'doc:update');
    expect((await alice.reconnect()).ok).toBe(true);
    await arrived;
    expect(texts(alice.store)).toEqual(texts(other.store));
    expect(texts(alice.store)).toEqual(expect.arrayContaining(['offline', 'online', 'Hola']));
  });
});
