/**
 * Teamspaces and private pages against PostgreSQL, through the real routes
 * (`docs/access.md`): where a tree lives decides who reaches it, workspace
 * admins included for private pages, and who may put a page where.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';
import { removeMember } from '../../repositories/workspaces.js';

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
    // The real limiters resolve an optional session through this; anonymous here.
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
  },
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/notification-service.js', () => ({ sendNotification: vi.fn(async () => ({})) }));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: pagesRouter } = await import('../pages.js');
const { default: blocksRouter } = await import('../blocks.js');
const { default: teamspacesRouter } = await import('../teamspaces.js');
const { default: searchRouter } = await import('../search.js');
const { default: databasesRouter } = await import('../databases.js');
const { default: pagePermissionsRouter } = await import('../page-permissions.js');

let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let previousUrl: string | undefined;

const OWNER = 'ts-owner';
const ADMIN = 'ts-admin';
const EDITOR = 'ts-editor';
const OTHER = 'ts-other';
const VIEWER = 'ts-viewer';

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
  return {
    status: res.status,
    json: (text ? JSON.parse(text) : {}) as Record<string, never> & Record<string, unknown>,
  };
}

async function page(user: string, input: Record<string, unknown> = {}): Promise<string> {
  const res = await api(user, 'POST', '/pages', { workspaceId, ...input });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return (res.json.page as { id: string }).id;
}

const listed = async (user: string) =>
  (
    (await api(user, 'GET', `/pages?workspaceId=${workspaceId}`)).json.pages as { id: string }[]
  ).map((p) => p.id);

const opens = async (user: string, id: string) => (await api(user, 'GET', `/pages/${id}`)).status;

async function teamspace(user: string, name: string, privacy: string): Promise<string> {
  const res = await api(user, 'POST', `/workspaces/${workspaceId}/teamspaces`, { name, privacy });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return (res.json.teamspace as { id: string }).id;
}

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: testScope('teamspaces'), ownerId: OWNER })
    .returning({ id: workspaces.id });
  workspaceId = ws?.id as string;
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: OWNER, role: 'owner' },
    { workspaceId, userId: ADMIN, role: 'admin' },
    { workspaceId, userId: EDITOR, role: 'editor' },
    { workspaceId, userId: OTHER, role: 'editor' },
    { workspaceId, userId: VIEWER, role: 'viewer' },
  ]);
  const app = express();
  app.use(express.json());
  app.use(teamspacesRouter);
  app.use(pagePermissionsRouter);
  app.use(blocksRouter);
  app.use('/pages', pagesRouter);
  app.use('/search', searchRouter);
  app.use('/databases', databasesRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

describe('private pages', () => {
  it("are their creator's alone — workspace owners and admins included — until shared", async () => {
    const mine = await page(EDITOR, { title: 'Diary', teamspaceId: null });
    const child = await page(EDITOR, { parentId: mine, title: 'Monday' });
    expect(await opens(EDITOR, child)).toBe(200);
    for (const user of [OWNER, ADMIN, OTHER]) {
      expect(await opens(user, mine)).toBe(403);
      expect(await listed(user)).not.toContain(mine);
    }
    const found = await api(OWNER, 'GET', `/search?workspaceId=${workspaceId}&q=diary`);
    expect((found.json.results as unknown[]).length).toBe(0);

    // Shared with one person, it opens for them (and only them).
    expect(
      (await api(EDITOR, 'PUT', `/pages/${mine}/permissions/${OTHER}`, { role: 'viewer' })).status,
    ).toBe(200);
    expect(await opens(OTHER, child)).toBe(200);
    expect(await opens(ADMIN, mine)).toBe(403);
    // Listed to them as shared; to its creator as their own.
    const sharedWithMe = async (user: string) =>
      (
        (await api(user, 'GET', `/pages?workspaceId=${workspaceId}`)).json.pages as {
          id: string;
          sharedWithMe: boolean;
        }[]
      ).find((p) => p.id === mine)?.sharedWithMe;
    expect(await sharedWithMe(OTHER)).toBe(true);
    expect(await sharedWithMe(EDITOR)).toBe(false);
  });

  it("keep a private page's subpage private when it moves to the top level", async () => {
    const mine = await page(EDITOR, { teamspaceId: null });
    const child = await page(EDITOR, { parentId: mine });
    const moved = await api(EDITOR, 'PATCH', `/pages/${child}`, { parentId: null });
    expect(moved.status).toBe(200);
    expect(moved.json.page).toMatchObject({ parentId: null, teamspaceId: null });
    expect(await opens(OTHER, child)).toBe(403);
  });
});

describe('the default teamspace', () => {
  it('takes pages created without a place, open to every member at their role', async () => {
    const shared = await page(EDITOR, { title: 'Handbook' });
    expect(await opens(VIEWER, shared)).toBe(200);
    expect(await listed(VIEWER)).toContain(shared);
    const teamspaces = (await api(VIEWER, 'GET', `/workspaces/${workspaceId}/teamspaces`)).json
      .teamspaces as { isDefault: boolean; role: string | null }[];
    expect(teamspaces.find((t) => t.isDefault)).toMatchObject({ role: 'member' });
  });

  it('stays open and keeps everyone', async () => {
    const teamspaces = (await api(OWNER, 'GET', `/workspaces/${workspaceId}/teamspaces`)).json
      .teamspaces as { id: string; isDefault: boolean }[];
    const general = teamspaces.find((t) => t.isDefault)?.id as string;
    expect(
      (await api(OWNER, 'PATCH', `/teamspaces/${general}`, { privacy: 'closed' })).status,
    ).toBe(400);
    expect((await api(VIEWER, 'DELETE', `/teamspaces/${general}/members/${VIEWER}`)).status).toBe(
      400,
    );
  });
});

describe('closed and private teamspaces', () => {
  it('open their pages to their members only (and to workspace owners and admins)', async () => {
    const team = await teamspace(EDITOR, 'Design', 'closed');
    const spec = await page(EDITOR, { title: 'Spec', teamspaceId: team });
    expect(await opens(EDITOR, spec)).toBe(200);
    expect(await opens(ADMIN, spec)).toBe(200);
    expect(await opens(OTHER, spec)).toBe(403);
    expect(await listed(OTHER)).not.toContain(spec);

    // A closed teamspace is listed, but not joined without an owner.
    const visible = (await api(OTHER, 'GET', `/workspaces/${workspaceId}/teamspaces`)).json
      .teamspaces as { id: string }[];
    expect(visible.map((t) => t.id)).toContain(team);
    expect((await api(OTHER, 'POST', `/teamspaces/${team}/join`)).status).toBe(403);
    // Nor may a non-member put pages in it.
    const refused = await api(OTHER, 'POST', '/pages', { workspaceId, teamspaceId: team });
    expect(refused.status).toBe(403);
    expect(refused.json.code).toBe('NO_TEAMSPACE_ACCESS');

    // Added by its owner, they reach it at their workspace role.
    expect(
      (await api(EDITOR, 'PUT', `/teamspaces/${team}/members/${VIEWER}`, { role: 'member' }))
        .status,
    ).toBe(200);
    const asViewer = await api(VIEWER, 'GET', `/pages/${spec}`);
    expect(asViewer.status).toBe(200);
    expect(asViewer.json.role).toBe('viewer');
    // A viewer adds no pages anywhere in a teamspace.
    const viewerPage = await api(VIEWER, 'POST', '/pages', { workspaceId, teamspaceId: team });
    expect(viewerPage.json.code).toBe('INSUFFICIENT_ROLE');
  });

  it('hide a private teamspace from those outside it', async () => {
    const team = await teamspace(EDITOR, 'Secret project', 'private');
    const ids = async (user: string) =>
      (
        (await api(user, 'GET', `/workspaces/${workspaceId}/teamspaces`)).json.teamspaces as {
          id: string;
        }[]
      ).map((t) => t.id);
    expect(await ids(OTHER)).not.toContain(team);
    expect(await ids(ADMIN)).toContain(team);
    expect((await api(OTHER, 'GET', `/teamspaces/${team}/members`)).status).toBe(404);
  });

  it('keep at least one owner', async () => {
    const team = await teamspace(EDITOR, 'Ops', 'closed');
    expect((await api(EDITOR, 'DELETE', `/teamspaces/${team}/members/${EDITOR}`)).status).toBe(400);
    expect(
      (await api(EDITOR, 'PUT', `/teamspaces/${team}/members/${EDITOR}`, { role: 'member' }))
        .status,
    ).toBe(400);
  });
});

describe('open teamspaces', () => {
  it('open their pages to the workspace, and anyone may join', async () => {
    const team = await teamspace(EDITOR, 'Engineering', 'open');
    const doc = await page(EDITOR, { teamspaceId: team });
    expect(await opens(OTHER, doc)).toBe(200);
    const joined = await api(OTHER, 'POST', `/teamspaces/${team}/join`);
    expect(joined.json.teamspace).toMatchObject({ role: 'member' });
  });
});

describe('moving between places', () => {
  it('takes a page out of a teamspace into private, and away from the others', async () => {
    const doc = await page(EDITOR);
    expect(await opens(OTHER, doc)).toBe(200);
    const moved = await api(EDITOR, 'PATCH', `/pages/${doc}`, { teamspaceId: null });
    expect(moved.status).toBe(200);
    expect(await opens(OTHER, doc)).toBe(403);
  });
});

describe('databases in no page', () => {
  it('live where they are put, like a top-level page', async () => {
    const created = await api(EDITOR, 'POST', '/databases', {
      workspaceId,
      name: 'Private tasks',
      teamspaceId: null,
    });
    expect(created.status).toBe(201);
    const id = (created.json.database as { id: string }).id;
    expect((await api(EDITOR, 'GET', `/databases/${id}`)).status).toBe(200);
    expect((await api(ADMIN, 'GET', `/databases/${id}`)).status).toBe(403);
    const rows = await api(EDITOR, 'POST', `/databases/${id}/rows`, { title: 'Mine' });
    const rowId = (rows.json.row as { id: string }).id;
    expect(await opens(OTHER, rowId)).toBe(403);
    const list = (await api(OTHER, 'GET', `/databases?workspaceId=${workspaceId}`)).json
      .databases as { id: string }[];
    expect(list.map((d) => d.id)).not.toContain(id);
  });

  it('tell the caller their role, so the app never re-derives it', async () => {
    const mine = (
      await api(EDITOR, 'POST', '/databases', { workspaceId, name: 'Mine', teamspaceId: null })
    ).json.database as { id: string };
    expect((await api(EDITOR, 'GET', `/databases/${mine.id}`)).json.role).toBe('admin');
    const shared = (await api(EDITOR, 'POST', '/databases', { workspaceId, name: 'Everyone' })).json
      .database as { id: string };
    expect((await api(VIEWER, 'GET', `/databases/${shared.id}`)).json.role).toBe('viewer');
    expect((await api(EDITOR, 'GET', `/databases/${shared.id}`)).json.role).toBe('editor');
  });
});

describe('leaving the workspace', () => {
  it('leaves its teamspaces too', async () => {
    const team = await teamspace(EDITOR, 'Temporary', 'closed');
    await api(EDITOR, 'PUT', `/teamspaces/${team}/members/${OTHER}`, { role: 'member' });
    await removeMember(db, workspaceId, OTHER);
    const members = (await api(EDITOR, 'GET', `/teamspaces/${team}/members`)).json.members as {
      userId: string;
    }[];
    expect(members.map((m) => m.userId)).not.toContain(OTHER);
    await db.insert(workspaceMembers).values({ workspaceId, userId: OTHER, role: 'editor' });
  });
});
