/**
 * Recents kept on the server (`page_visits`): every visit moves a page to
 * the top of the caller's list, and the list holds only pages they can
 * still open.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { pagePermissions } from '../../db/schema/collab.js';
import { pages, pageVisits } from '../../db/schema/pages.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticateToken: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: String(req.header('x-test-user')) };
    next();
  },
  oxyClient: {
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
  },
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: pagesRouter } = await import('../pages.js');
const { default: pageVisitsRouter } = await import('../page-visits.js');

const scope = testScope('visits');
const OWNER = `${scope}-owner`;
const MEMBER = `${scope}-member`;
const GUEST = `${scope}-guest`;
const STRANGER = `${scope}-stranger`;

let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
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

async function page(title: string, parentId?: string): Promise<string> {
  const created = await api(OWNER, 'POST', '/pages', { workspaceId, title, parentId });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  return (created.json.page as { id: string }).id;
}

const recent = async (user: string, limit?: number) => {
  const res = await api(
    user,
    'GET',
    `/pages/recent?workspaceId=${workspaceId}${limit ? `&limit=${limit}` : ''}`,
  );
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return (res.json.pages as { id: string; title: string }[]).map((p) => p.title);
};

const visit = async (user: string, id: string) => {
  const res = await api(user, 'POST', `/pages/${id}/visit`);
  // Visits a few milliseconds apart: the list's order is the time of each.
  await new Promise((resolve) => setTimeout(resolve, 5));
  return res.status;
};

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: scope, ownerId: OWNER })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: OWNER, role: 'owner' },
    { workspaceId, userId: MEMBER, role: 'editor' },
  ]);
  const app = express();
  app.use(express.json());
  app.use(pageVisitsRouter);
  app.use('/pages', pagesRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousUrl;
});

describe('recent pages on the server', () => {
  it('lists what the caller opened, the latest first, one entry per page', async () => {
    const plan = await page('Plan');
    const notes = await page('Notes');
    const ideas = await page('Ideas');
    expect(await recent(MEMBER)).toEqual([]);

    for (const id of [plan, notes, ideas, plan]) expect(await visit(MEMBER, id)).toBe(200);
    expect(await recent(MEMBER)).toEqual(['Plan', 'Ideas', 'Notes']);
    expect(await recent(MEMBER, 2)).toEqual(['Plan', 'Ideas']);
    // Each person's own.
    expect(await recent(OWNER)).toEqual([]);
    const rows = await db.select().from(pageVisits).where(eq(pageVisits.userId, MEMBER));
    expect(rows).toHaveLength(3);
  });

  it('drops pages in the trash and pages closed to the caller since', async () => {
    const draft = await page('Draft');
    const closed = await page('Closed');
    await visit(MEMBER, draft);
    await visit(MEMBER, closed);
    expect((await recent(MEMBER)).slice(0, 2)).toEqual(['Closed', 'Draft']);

    await api(OWNER, 'PATCH', `/pages/${draft}`, { archived: true });
    await api(OWNER, 'PATCH', `/pages/${closed}`, { restricted: true });
    const after = await recent(MEMBER);
    expect(after).not.toContain('Draft');
    expect(after).not.toContain('Closed');
  });

  it('forgets a page deleted for good', async () => {
    const gone = await page('Gone');
    await visit(MEMBER, gone);
    await db.delete(pages).where(eq(pages.id, gone));
    expect(await db.select().from(pageVisits).where(eq(pageVisits.pageId, gone))).toEqual([]);
  });

  it('records a visit only for someone who can open the page', async () => {
    const shared = await page('Shared');
    const hidden = await page('Hidden');
    await db
      .insert(pagePermissions)
      .values({ pageId: shared, userId: GUEST, role: 'viewer', grantedBy: OWNER });

    expect(await visit(GUEST, shared)).toBe(200);
    expect(await visit(GUEST, hidden)).toBe(403);
    expect(await recent(GUEST)).toEqual(['Shared']);

    expect(await visit(STRANGER, shared)).toBe(403);
    const stranger = await api(STRANGER, 'GET', `/pages/recent?workspaceId=${workspaceId}`);
    expect(stranger.status).toBe(403);
    expect((await api(MEMBER, 'GET', '/pages/recent')).status).toBe(400);
  });
});
