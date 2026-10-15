import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { broadcastPageTransaction, registerPageRooms } from './page-rooms.js';

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

function join(
  socket: ClientSocket,
  id: string,
): Promise<{ ok: boolean; version?: number; error?: string }> {
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
  const [page] = await db
    .insert(pages)
    .values({ workspaceId, ownerId: 'alice', title: 'Shared', blocksVersion: 7 })
    .returning({ id: pages.id });
  pageId = page?.id as string;

  httpServer = http.createServer();
  io = new Server(httpServer);
  io.use((socket, nextMiddleware) => {
    socket.data.userId = socket.handshake.auth.userId;
    nextMiddleware();
  });
  io.on('connection', (socket) => registerPageRooms(io, socket));
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

  it('admits members with the current version and shows who is there', async () => {
    const alice = await client('alice');
    const bob = await client('bob');
    expect(await join(alice, pageId)).toEqual({ ok: true, version: 7 });

    const presence = next<{ users: { userId: string }[] }>(
      alice,
      'page:presence',
      (p) => p.users.length === 2,
    );
    expect((await join(bob, pageId)).ok).toBe(true);
    const { users } = await presence;
    expect(users.map((u) => u.userId).sort()).toEqual(['alice', 'bob']);

    const focused = next<{ users: { userId: string; blockId: string | null }[] }>(
      bob,
      'page:presence',
      (p) => p.users.some((u) => u.blockId !== null),
    );
    alice.emit('page:focus', { pageId, blockId: '0192f0c4-7d4e-7c2a-9b1e-3f5a6b7c8d9e' });
    expect((await focused).users.find((u) => u.userId === 'alice')?.blockId).toBe(
      '0192f0c4-7d4e-7c2a-9b1e-3f5a6b7c8d9e',
    );
  });

  it('delivers a transaction to the other members, not to its author', async () => {
    const alice = await client('alice');
    const bob = await client('bob');
    await join(alice, pageId);
    await join(bob, pageId);

    let aliceGotIt = false;
    alice.on('page:transaction', () => {
      aliceGotIt = true;
    });
    const received = next<{ version: number; ops: unknown[] }>(bob, 'page:transaction');
    broadcastPageTransaction(
      io,
      { pageId, version: 8, actorId: 'alice', ops: [{ kind: 'remove', id: 'x' }] },
      alice.id,
    );
    expect(await received).toMatchObject({ version: 8, ops: [{ kind: 'remove', id: 'x' }] });
    await new Promise((r) => setTimeout(r, 50));
    expect(aliceGotIt).toBe(false);
  });
});
