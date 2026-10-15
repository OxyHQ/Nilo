/**
 * Live updates outside the editor, against PostgreSQL and a real Socket.IO
 * server: who may listen to a workspace or a database, and that the routes'
 * writes reach them (ids only).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Server } from 'socket.io';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  closeTestDb,
  getTestDb,
  seedWorkspace,
  type TestDatabase,
  testDatabaseUrl,
} from '../db/__tests__/testDatabase.js';
import { closeDb } from '../db/client.js';
import { workspaceMembers } from '../db/schema/workspaces.js';

const ctx = vi.hoisted(() => ({ io: null as unknown }));
vi.mock('../socket.js', () => ({ getIO: () => ctx.io }));
vi.mock('../middleware/auth.js', () => ({
  authenticateToken: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: String(req.header('x-test-user')) };
    next();
  },
  oxyClient: {},
}));
vi.mock('../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { registerLiveRooms } = await import('./live-rooms.js');
const { default: pagesRouter } = await import('../routes/pages.js');
const { default: databasesRouter } = await import('../routes/databases.js');

let db: TestDatabase;
let httpServer: http.Server;
let io: Server;
let origin: string;
let workspaceId: string;
let previousDatabaseUrl: string | undefined;
const clients: ClientSocket[] = [];

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

const join = (socket: ClientSocket, event: string, id: string) =>
  new Promise<{ ok: boolean; error?: string }>((resolve) => socket.emit(event, id, resolve));

async function api(user: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${origin}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-test-user': user,
      'x-workspace-id': workspaceId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Resolves with the next `event` the socket hears, or rejects after a while. */
function hear<T>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event}`)), 2000);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

beforeAll(async () => {
  db = await getTestDb();
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  workspaceId = await seedWorkspace(db, 'live-rooms');
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: 'ann', role: 'editor' },
    { workspaceId, userId: 'bo', role: 'editor' },
  ]);
  const app = express();
  app.use(express.json());
  app.use('/pages', pagesRouter);
  app.use('/databases', databasesRouter);
  httpServer = http.createServer(app);
  io = new Server(httpServer);
  ctx.io = io;
  io.use((socket, nextMiddleware) => {
    socket.data.userId = socket.handshake.auth.userId;
    nextMiddleware();
  });
  io.on('connection', (socket) => registerLiveRooms(io, socket));
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

describe('workspace rooms', () => {
  it('admit members only', async () => {
    expect(await join(await client('mallory'), 'workspace:join', workspaceId)).toEqual({
      ok: false,
      error: 'Forbidden',
    });
    expect((await join(await client('ann'), 'workspace:join', workspaceId)).ok).toBe(true);
  });

  it('hear that the page tree changed when a member adds a page', async () => {
    const bo = await client('bo');
    await join(bo, 'workspace:join', workspaceId);
    const heard = hear<{ workspaceId: string }>(bo, 'workspace:changed');
    expect((await api('ann', 'POST', '/pages', { workspaceId, title: 'New' })).status).toBe(201);
    expect(await heard).toEqual({ workspaceId });
  });
});

describe('database rooms', () => {
  it('admit those who can open it, and hear its rows change', async () => {
    const made = await api('ann', 'POST', '/databases', { workspaceId, name: 'Tasks' });
    const databaseId = (made.json.database as { id: string }).id;
    const privateDb = await api('ann', 'POST', '/databases', {
      workspaceId,
      name: 'Mine',
      teamspaceId: null,
    });
    const bo = await client('bo');
    expect(
      (await join(bo, 'database:join', (privateDb.json.database as { id: string }).id)).ok,
    ).toBe(false);
    expect((await join(bo, 'database:join', databaseId)).ok).toBe(true);

    const heard = hear<{ databaseId: string }>(bo, 'database:changed');
    expect(
      (await api('ann', 'POST', `/databases/${databaseId}/rows`, { title: 'One' })).status,
    ).toBe(201);
    expect(await heard).toEqual({ databaseId });
  });
});
