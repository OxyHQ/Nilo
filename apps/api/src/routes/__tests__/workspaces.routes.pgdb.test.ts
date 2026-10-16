/**
 * The personal workspace through the real routes: provisioned on the first
 * request, never deleted, and reset only by its owner, who confirms by name.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { databases } from '../../db/schema/databases.js';
import { pages } from '../../db/schema/pages.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';
import { createPage } from '../../repositories/pages.js';

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
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
    users: { get: async () => ({ username: 'ada', name: { full: 'Ada Lovelace' } }) },
  },
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: workspacesRouter } = await import('../workspaces.js');

let db: TestDatabase;
let server: Server;
let base: string;
let previousUrl: string | undefined;

const scope = testScope('ws-routes');
const OWNER = `${scope}-owner`;
const STRANGER = `${scope}-stranger`;

async function api(user: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}

type Workspace = { id: string; name: string; isPersonal: boolean };

async function personal(user: string): Promise<Workspace> {
  const res = await api(user, 'GET', '/workspaces/personal');
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json.workspace as Workspace;
}

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const app = express();
  app.use(express.json());
  app.use('/workspaces', workspacesRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.delete(workspaces).where(like(workspaces.ownerId, `${scope}%`));
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousUrl;
});

describe('GET /workspaces/personal', () => {
  it('provisions the personal workspace once, named from the Oxy profile', async () => {
    const first = await personal(OWNER);
    expect(first).toMatchObject({ isPersonal: true, name: "Ada Lovelace's Workspace" });
    expect((await personal(OWNER)).id).toBe(first.id);

    const list = await api(OWNER, 'GET', '/workspaces');
    expect((list.json.workspaces as Workspace[]).map((w) => w.id)).toEqual([first.id]);
  });
});

describe('the personal workspace cannot be deleted', () => {
  it('refuses the delete route', async () => {
    const ws = await personal(OWNER);
    expect((await api(OWNER, 'DELETE', `/workspaces/${ws.id}`)).status).toBe(400);
  });
});

describe('POST /workspaces/:id/reset', () => {
  it('needs the current name as confirmation', async () => {
    const ws = await personal(OWNER);
    expect((await api(OWNER, 'POST', `/workspaces/${ws.id}/reset`, {})).status).toBe(400);
    expect(
      (await api(OWNER, 'POST', `/workspaces/${ws.id}/reset`, { confirm: 'nope' })).status,
    ).toBe(400);
  });

  it('is for the owner alone', async () => {
    const ws = await personal(OWNER);
    // A personal workspace takes no invitations; the row is written directly
    // to prove the role check holds even if one existed.
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: ws.id, userId: STRANGER, role: 'admin' });
    const res = await api(STRANGER, 'POST', `/workspaces/${ws.id}/reset`, { confirm: ws.name });
    expect(res.status).toBe(403);
    await db.delete(workspaceMembers).where(eq(workspaceMembers.userId, STRANGER));
  });

  it('refuses a workspace that is not personal', async () => {
    const created = await api(OWNER, 'POST', '/workspaces', { name: 'Team' });
    expect(created.status).toBe(201);
    const team = created.json.workspace as Workspace;
    const res = await api(OWNER, 'POST', `/workspaces/${team.id}/reset`, { confirm: 'Team' });
    expect(res.status).toBe(400);
  });

  it('empties the workspace and keeps its id', async () => {
    const ws = await personal(OWNER);
    await api(OWNER, 'PATCH', `/workspaces/${ws.id}`, { name: 'Scratch' });
    await createPage(db, { workspaceId: ws.id, ownerId: OWNER, title: 'Gone', order: 0 });

    const res = await api(OWNER, 'POST', `/workspaces/${ws.id}/reset`, { confirm: 'Scratch' });

    expect(res.status, JSON.stringify(res.json)).toBe(200);
    // The page, and the notes and folders databases, which come back empty.
    expect(res.json.removed).toEqual({ pages: 1, databases: 2 });
    expect(await db.select().from(pages).where(eq(pages.workspaceId, ws.id))).toEqual([]);
    const systems = await db
      .select({ key: databases.systemKey })
      .from(databases)
      .where(eq(databases.workspaceId, ws.id));
    expect(systems.map((d) => d.key).sort()).toEqual(['note_folders', 'notes']);
    expect(await personal(OWNER)).toMatchObject({
      id: ws.id,
      name: "Ada Lovelace's Workspace",
    });
  });
});
