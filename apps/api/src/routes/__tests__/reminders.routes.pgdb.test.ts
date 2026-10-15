/**
 * Reminders against PostgreSQL: setting and listing them, the sweep that
 * delivers due ones (once, to people who can still open the page, retried
 * when the notification fails), and deleting one's own.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '../../db/client.js';
import { reminders } from '../../db/schema/collab.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';

const sent = vi.hoisted(() => ({ calls: [] as { userId: string; type: string }[], fail: false }));

vi.mock('../../middleware/auth.js', () => ({
  authenticateToken: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: String(req.header('x-test-user')) };
    next();
  },
  oxyClient: {},
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/notification-service.js', () => ({
  sendNotification: vi.fn(async (options: { userId: string; type: string }) => {
    if (sent.fail) throw new Error('push down');
    sent.calls.push({ userId: options.userId, type: options.type });
    return {};
  }),
}));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: remindersRouter } = await import('../reminders.js');
const { default: pagesRouter } = await import('../pages.js');
const { deliverDueReminders } = await import('../../lib/reminders.js');

let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let previousUrl: string | undefined;
const OWNER = 'rem-owner';
const MEMBER = 'rem-member';

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
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const newPage = async (title = 'Plan') =>
  ((await api(OWNER, 'POST', '/pages', { workspaceId, title })).json.page as { id: string }).id;
const soon = (ms: number) => new Date(Date.now() + ms).toISOString();

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: testScope('reminders'), ownerId: OWNER })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: OWNER, role: 'owner' },
    { workspaceId, userId: MEMBER, role: 'editor' },
  ]);
  const app = express();
  app.use(express.json());
  app.use(remindersRouter);
  app.use('/pages', pagesRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  sent.calls = [];
  sent.fail = false;
  // Each test sees only its own due reminders.
  await db.delete(reminders);
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

describe('reminders', () => {
  it('are set, listed and delivered once when due', async () => {
    const pageId = await newPage();
    const created = await api(MEMBER, 'POST', `/pages/${pageId}/reminders`, {
      remindAt: soon(60_000),
      note: 'Review',
    });
    expect(created.status).toBe(201);
    const listed = (await api(MEMBER, 'GET', '/reminders')).json.reminders as {
      page: { title: string };
    }[];
    expect(listed.map((r) => r.page.title)).toEqual(['Plan']);

    expect(await deliverDueReminders(getDb())).toBe(0);
    expect(await deliverDueReminders(getDb(), new Date(Date.now() + 120_000))).toBe(1);
    expect(sent.calls).toEqual([{ userId: MEMBER, type: 'reminder' }]);
    expect(await deliverDueReminders(getDb(), new Date(Date.now() + 240_000))).toBe(0);
    expect((await api(MEMBER, 'GET', '/reminders')).json.reminders).toEqual([]);
  });

  it('are skipped once their owner cannot open the page', async () => {
    const pageId = await newPage('Secret');
    await api(MEMBER, 'POST', `/pages/${pageId}/reminders`, { remindAt: soon(-1000) });
    await api(OWNER, 'PATCH', `/pages/${pageId}`, { restricted: true });
    expect(await deliverDueReminders(getDb())).toBe(0);
    expect(sent.calls).toEqual([]);
  });

  it('go back to the next sweep when the notification fails', async () => {
    const pageId = await newPage();
    await api(MEMBER, 'POST', `/pages/${pageId}/reminders`, { remindAt: soon(-1000) });
    sent.fail = true;
    expect(await deliverDueReminders(getDb())).toBe(0);
    sent.fail = false;
    expect(await deliverDueReminders(getDb())).toBe(1);
  });

  it('are deleted only by their owner, and refuse a block from another page', async () => {
    const pageId = await newPage();
    const other = await newPage('Other');
    const created = await api(MEMBER, 'POST', `/pages/${pageId}/reminders`, {
      remindAt: soon(60_000),
    });
    const id = (created.json.reminder as { id: string }).id;
    expect((await api(OWNER, 'DELETE', `/reminders/${id}`)).status).toBe(404);
    expect((await api(MEMBER, 'DELETE', `/reminders/${id}`)).status).toBe(200);
    expect(await db.select().from(reminders).where(eq(reminders.id, id))).toEqual([]);
    const wrongBlock = await api(MEMBER, 'POST', `/pages/${other}/reminders`, {
      remindAt: soon(60_000),
      blockId: '0192f0c4-7d4e-7c2a-9b1e-000000000001',
    });
    expect(wrongBlock.status).toBe(400);
  });
});
