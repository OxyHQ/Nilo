/**
 * Assigning against PostgreSQL: adding someone to a person property of a row,
 * on creating it or later, tells them, and nobody else: not the person who
 * did it, not someone who cannot open the row, not anyone on a template.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';

const notified = vi.hoisted(
  () => [] as { userId: string; type: string; body: string; data?: Record<string, unknown> }[],
);

vi.mock('../../middleware/auth.js', () => ({
  authenticateToken: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const id = req.header('x-test-user');
    if (!id) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.user = { id };
    next();
  },
  oxyClient: {
    users: { getMany: async (ids: string[]) => ids.map((id) => ({ id })) },
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
  },
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/notification-service.js', () => ({
  sendNotification: vi.fn(
    async (options: {
      userId: string;
      type: string;
      body: string;
      data?: Record<string, unknown>;
    }) => {
      notified.push({
        userId: options.userId,
        type: options.type,
        body: options.body,
        data: options.data,
      });
      return {};
    },
  ),
}));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } },
}));

const { default: pagesRouter } = await import('../pages.js');
const { default: databasesRouter } = await import('../databases.js');

const OWNER = 'assign-owner';
const EDITOR = 'assign-editor';
const OUTSIDER = 'assign-outsider';

let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let databaseId: string;
let previousUrl: string | undefined;

async function api(user: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-test-user': user,
      'x-workspace-id': workspaceId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}

/** Let the notifications sent after the response go out. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const assigned = () => notified.filter((n) => n.type === 'assigned');

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: testScope('assign'), ownerId: OWNER })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: OWNER, role: 'owner' },
    { workspaceId, userId: EDITOR, role: 'editor' },
  ]);
  const app = express();
  app.use(express.json());
  app.use('/pages', pagesRouter);
  app.use('/databases', databasesRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const created = await api(OWNER, 'POST', '/databases', {
    workspaceId,
    name: 'Tareas',
    schema: {
      properties: [
        { id: 'name', name: 'Name', type: 'text' },
        { id: 'owner', name: 'Responsable', type: 'person' },
      ],
    },
  });
  expect(created.status).toBe(201);
  databaseId = (created.json.database as { id: string }).id;
});

beforeEach(() => {
  notified.length = 0;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousUrl;
});

describe('assigning someone to a row', () => {
  it('tells them when a row is created with them in it, never whoever created it', async () => {
    const row = await api(OWNER, 'POST', `/databases/${databaseId}/rows`, {
      title: 'Lanzamiento',
      properties: { owner: { userIds: [EDITOR, OWNER] } },
    });
    expect(row.status).toBe(201);
    await settle();
    expect(assigned()).toEqual([
      expect.objectContaining({
        userId: EDITOR,
        body: 'Responsable',
        data: expect.objectContaining({
          pageId: (row.json.row as { id: string }).id,
          propertyId: 'owner',
          authorId: OWNER,
        }),
      }),
    ]);
  });

  it('tells only the people added by an edit, and not someone who cannot open the row', async () => {
    const row = await api(OWNER, 'POST', `/databases/${databaseId}/rows`, {
      title: 'Revisión',
      properties: { owner: { userIds: [EDITOR] } },
    });
    const id = (row.json.row as { id: string }).id;
    await settle();
    notified.length = 0;

    const edited = await api(OWNER, 'PATCH', `/pages/${id}`, {
      properties: { owner: { userIds: [EDITOR, OUTSIDER] } },
    });
    expect(edited.status).toBe(200);
    await settle();
    // The editor was already there; the outsider cannot open the row.
    expect(assigned()).toEqual([]);

    const removed = await api(EDITOR, 'PATCH', `/pages/${id}`, {
      properties: { owner: { userIds: [] } },
    });
    expect(removed.status).toBe(200);
    const again = await api(EDITOR, 'PATCH', `/pages/${id}`, {
      properties: { owner: { userIds: [OWNER] } },
    });
    expect(again.status).toBe(200);
    await settle();
    expect(assigned().map((n) => [n.userId, n.data?.authorId])).toEqual([[OWNER, EDITOR]]);
  });

  it('tells nobody about a template', async () => {
    const template = await api(OWNER, 'POST', `/databases/${databaseId}/rows`, {
      title: 'Plantilla',
      template: true,
      properties: { owner: { userIds: [EDITOR] } },
    });
    expect(template.status).toBe(201);
    await settle();
    expect(assigned()).toEqual([]);
  });
});
