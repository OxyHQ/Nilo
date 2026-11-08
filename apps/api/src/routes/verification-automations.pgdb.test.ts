import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { workspaceMembers } from '../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  seedWorkspace,
  type TestDatabase,
} from '../db/__tests__/testDatabase.js';
import { databaseViews, databases } from '../db/schema/databases.js';
import { pagePermissions } from '../db/schema/collab.js';
import { blocks, pages } from '../db/schema/pages.js';
import { closeDb } from '../db/client.js';
import type { WorkspaceRole } from '../db/schema/workspaces.js';

/**
 * `routes/databases.ts` against a real Postgres, driven over HTTP.
 *
 * The router is mounted as `src/index.ts` mounts it and exercised with real
 * requests, so the serializers, the zod boundary and the repository calls are
 * all the shipped ones. A test that called the repositories directly would
 * measure the repositories — which `repositories/databases.pgdb.test.ts`
 * already does — and would say nothing about whether the route calls them.
 *
 * ## What is mocked, and what that costs
 *
 * The two middlewares and the logger. `authenticateToken` reaches Oxy and
 * `requireWorkspaceMember` resolves membership; the logger is mocked for the
 * reason given at its `vi.mock`. Membership is the workspaces domain, so it is
 * not under test here — but the mock does resolve the workspace id the same way
 * the real middleware does (param, then query, then the `X-Workspace-Id`
 * header) and refuses a workspace the caller is not a member of, because
 * several route paths depend on `checkWorkspaceAccess` rejecting rather than
 * passing.
 *
 * Every assertion is scoped to a workspace, database or page id this file
 * created: the suite shares one database with every other `*.pgdb.test.ts`.
 */

const ctx = vi.hoisted(() => ({
  /** The Oxy user id `authenticateToken` attaches. */
  userId: 'user-pending',
  /** The one workspace this file's caller is a member of. */
  workspaceId: '',
  /** The role the membership mock reports. `hard=true` requires `owner`. */
  role: 'owner' as WorkspaceRole,
}));

vi.mock('../middleware/auth.js', () => ({
  authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: ctx.userId };
    next();
  },
}));
vi.mock('../oxy.js', () => ({
  oxy: {
    // The real limiters resolve an optional session through this; anonymous here.
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
    // Profiles for the people a person property can name.
    users: {
      getMany: async (ids: string[]) => ids.map((id) => ({ id, username: `handle-${id}` })),
    },
  },
}));

/**
 * NOT about log noise: outside production `lib/logger.ts` configures pino with
 * the `pino-pretty` TRANSPORT, which runs on a `thread-stream` worker thread.
 * This is the first `*.pgdb.test.ts` to import a route, so it is the first to
 * load the logger at all, and a live worker thread is a handle the fork does
 * not need to be holding when vitest terminates it. Every later route suite
 * wants the same mock.
 *
 * It does NOT fix the run's intermittent "Timeout terminating forks worker",
 * which silently drops a whole file's results and reports the count as a pass.
 * That is PRE-EXISTING: measured on the base revision (f7834e8, none of this
 * change) at 2 losses in 11 full runs, against 1 in 8 here. So a short run is
 * evidence of nothing — re-run before reading a missing file as a regression.
 *
 * Errors still surface — a route that 500s unexpectedly says so on stderr.
 */
vi.mock('../lib/logger.js', () => ({
  log: {
    general: {
      error: (...args: unknown[]) => console.error('[route]', ...args),
      warn: () => {},
      info: () => {},
      debug: () => {},
    },
  },
}));

const sent = vi.hoisted(() => ({
  notifications: [] as Array<Record<string, unknown>>,
  fail: false,
  webhooks: [] as Array<{ url: string; headers: Record<string, string>; body: string }>,
  webhookStatus: 200,
  /** Statuses to answer first, in order; then `webhookStatus`. */
  webhookQueue: [] as number[],
}));
vi.mock('../lib/notification-service.js', () => ({
  sendNotification: async (n: Record<string, unknown>) => {
    if (sent.fail) throw new Error('push is down');
    sent.notifications.push(n);
  },
}));
vi.mock('@oxy.so/core/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@oxy.so/core/server')>()),
  safeFetch: async (url: string, init: { headers: Record<string, string>; body: string }) => {
    sent.webhooks.push({ url, headers: init.headers, body: init.body });
    return {
      status: sent.webhookQueue.shift() ?? sent.webhookStatus,
      response: { destroy: () => {} },
    };
  },
}));

vi.mock('../middleware/workspace.js', () => ({
  requireWorkspaceMember: (req: Request, res: Response, next: NextFunction) => {
    const fromParam = req.params?.workspaceId;
    const fromQuery = req.query?.workspaceId;
    const fromHeader = req.header('X-Workspace-Id');
    const workspaceId =
      (typeof fromParam === 'string' && fromParam) ||
      (typeof fromQuery === 'string' && fromQuery) ||
      (typeof fromHeader === 'string' && fromHeader !== 'personal' && fromHeader) ||
      null;
    if (!workspaceId) {
      res.status(400).json({ error: 'Workspace id required' });
      return;
    }
    if (workspaceId !== ctx.workspaceId) {
      res.status(403).json({ error: 'Forbidden: not a workspace member' });
      return;
    }
    req.workspace = { id: workspaceId, role: ctx.role };
    next();
  },
}));

// `vi.mock` is hoisted above this, so the router resolves the mocks.
import databasesRouter from './databases.js';
import databaseAutomationsRouter from './database-automations.js';
import pagesRouter from './pages.js';
import pageVerificationRouter from './page-verification.js';
import { notifyExpiredVerifications } from '../lib/verifications.js';
import { runDueWebhookRetries } from '../lib/webhook-retries.js';
import { webhookRetry, runAutomations, signWebhook } from '../lib/databases/automations.js';
import { pageVerifications } from '../db/schema/collab.js';
import { automationWebhookRetries, databaseAutomations } from '../db/schema/automations.js';

let db: TestDatabase;
let originalDatabaseUrl: string | undefined;
let server: Server;
let baseUrl: string;
/** A second workspace, so "scoped to this workspace" is a claim with a control. */
let otherWorkspaceId: string;

interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

/**
 * `node:http` with `agent: false` rather than `fetch`: undici's global
 * dispatcher keeps its sockets and their keep-alive timers alive after the
 * response and offers no way to shut them down from here, so a worker that
 * used `fetch` still holds handles after `afterAll`. One connection per
 * request, closed with the response, leaves nothing behind.
 */
/** JSON bodies as objects; anything else (a CSV export) as `{ text }`. */
function parseBody(text: string): Record<string, unknown> {
  if (text.length === 0) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { text };
  }
}

async function api(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise<ApiResponse>((resolve, reject) => {
    const request = httpRequest(
      `${baseUrl}${path}`,
      {
        method,
        agent: false,
        headers: payload === undefined ? {} : { 'content-type': 'application/json' },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          text += chunk;
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: parseBody(text),
          });
        });
      },
    );
    request.on('error', reject);
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}

/** The `id` a serializer emitted, or a failure naming what it emitted instead. */
function idOf(entity: unknown): string {
  const id = (entity as { id?: unknown } | null)?.id;
  if (typeof id !== 'string') {
    throw new Error(`expected an id, got ${JSON.stringify(entity)}`);
  }
  return id;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error(`expected an object, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`expected an array, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** Create a database through the route and return its id. */
async function createDatabase(overrides: Record<string, unknown> = {}): Promise<string> {
  const created = await api('POST', '/api/databases', {
    workspaceId: ctx.workspaceId,
    name: 'Tasks',
    ...overrides,
  });
  expect(created.status).toBe(201);
  return idOf(created.body.database);
}

beforeAll(async () => {
  db = await getTestDb();
  // The route resolves its own handle through `getDb()`, which reads
  // DATABASE_URL. Pointed at the same database the fixtures are seeded in, and
  // restored afterwards — `process.env` is shared with every sibling file.
  webhookRetry.delaysMs = [0, 0];
  originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.NILO_TEST_DATABASE_URL;

  ctx.workspaceId = await seedWorkspace(db, 'route-verify-auto');
  otherWorkspaceId = await seedWorkspace(db, 'route-verify-auto-other');
  ctx.userId = `owner-${ctx.workspaceId}`;
  // Page access (an inline database shares its page's) reads membership from
  // the database, not from the mocked middleware.
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspaceId, userId: ctx.userId, role: 'owner' });

  const app = express();
  app.use(express.json());
  app.use('/api/databases', databasesRouter);
  // Row edits go through the page route.
  app.use('/api/pages', pagesRouter);
  app.use('/api', pageVerificationRouter);
  app.use('/api', databaseAutomationsRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await closeDb();
  await closeTestDb();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

/** A database with a Name, a text `note`, a checkbox `done` and a verification property. */
async function seedDatabase(): Promise<{ databaseId: string }> {
  const databaseId = await createDatabase({
    schema: {
      properties: [
        { id: 'name', name: 'Name', type: 'text' },
        { id: 'note', name: 'Note', type: 'text' },
        { id: 'done', name: 'Done', type: 'checkbox' },
        { id: 'ver', name: 'Verified', type: 'verification' },
      ],
    },
  });
  return { databaseId };
}

async function addRow(databaseId: string, title = 'Row'): Promise<string> {
  const row = await api('POST', `/api/databases/${databaseId}/rows`, { title });
  expect(row.status).toBe(201);
  return idOf(row.body.row);
}

const rowProperties = async (pageId: string) =>
  asRecord(
    asRecord((await api('GET', `/api/databases/${currentDb}/rows/${pageId}`)).body.row).properties,
  );
let currentDb = '';

describe('POST /api/pages/:id/verification', () => {
  it('stamps the caller and now, and keeps the sweep copy of the expiry', async () => {
    const { databaseId } = await seedDatabase();
    currentDb = databaseId;
    const pageId = await addRow(databaseId);
    const res = await api('POST', `/api/pages/${pageId}/verification`, {
      action: 'verify',
      propertyId: 'ver',
      expiresInDays: 30,
    });
    expect(res.status).toBe(200);
    const value = asRecord((await rowProperties(pageId)).ver);
    expect(value.state).toBe('verified');
    expect(value.verifiedBy).toBe(ctx.userId);
    const days =
      (Date.parse(String(value.expiresAt)) - Date.parse(String(value.verifiedAt))) / 864e5;
    expect(Math.round(days)).toBe(30);
    const copies = await db
      .select()
      .from(pageVerifications)
      .where(eq(pageVerifications.pageId, pageId));
    expect(copies).toHaveLength(1);
    expect(copies[0].verifiedBy).toBe(ctx.userId);
  });

  it('refuses a direct write of the property and a property that is not a verification', async () => {
    const { databaseId } = await seedDatabase();
    currentDb = databaseId;
    const pageId = await addRow(databaseId);
    const forged = await api('PATCH', `/api/pages/${pageId}`, {
      properties: { ver: { state: 'verified', verifiedBy: 'someone-else' } },
    });
    expect(forged.status).toBe(400);
    const wrong = await api('POST', `/api/pages/${pageId}/verification`, {
      action: 'verify',
      propertyId: 'note',
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('NOT_A_VERIFICATION');
    expect(
      (asRecord(await rowProperties(pageId)).ver as { state?: string } | undefined)?.state ??
        'unverified',
    ).toBe('unverified');
  });

  it('un-verifies, and drops the sweep copy with it', async () => {
    const { databaseId } = await seedDatabase();
    currentDb = databaseId;
    const pageId = await addRow(databaseId);
    await api('POST', `/api/pages/${pageId}/verification`, {
      action: 'verify',
      propertyId: 'ver',
      expiresInDays: 7,
    });
    const res = await api('POST', `/api/pages/${pageId}/verification`, {
      action: 'unverify',
      propertyId: 'ver',
    });
    expect(res.status).toBe(200);
    expect(asRecord((await rowProperties(pageId)).ver).state).toBe('unverified');
    expect(
      await db.select().from(pageVerifications).where(eq(pageVerifications.pageId, pageId)),
    ).toHaveLength(0);
  });
});

describe('the verification expiry sweep', () => {
  it('tells the verifier once, and retries a notification that failed', async () => {
    const { databaseId } = await seedDatabase();
    currentDb = databaseId;
    const pageId = await addRow(databaseId, 'Handbook');
    await api('POST', `/api/pages/${pageId}/verification`, {
      action: 'verify',
      propertyId: 'ver',
      expiresInDays: 7,
    });
    const later = new Date(Date.now() + 8 * 864e5);
    const mine = () =>
      sent.notifications.filter((n) => (n.data as { pageId: string }).pageId === pageId);

    // Not due yet.
    expect(await notifyExpiredVerifications(db, new Date())).toBe(0);

    sent.fail = true;
    await notifyExpiredVerifications(db, later);
    sent.fail = false;
    expect(mine()).toHaveLength(0);
    const [afterFailure] = await db
      .select()
      .from(pageVerifications)
      .where(eq(pageVerifications.pageId, pageId));
    expect(afterFailure.notifiedAt).toBeNull();

    await notifyExpiredVerifications(db, later);
    expect(mine()).toHaveLength(1);
    expect(mine()[0].userId).toBe(ctx.userId);
    expect(mine()[0].type).toBe('verification_expired');
    await notifyExpiredVerifications(db, later);
    expect(mine()).toHaveLength(1);
  });
});

const automationPath = (databaseId: string) => `/api/databases/${databaseId}/automations`;

describe('automation routes', () => {
  it('creates one, shows its secret once, and refuses what cannot work', async () => {
    const { databaseId } = await seedDatabase();
    const created = await api('POST', automationPath(databaseId), {
      name: 'Hook',
      trigger: { kind: 'row_added' },
      actions: [{ kind: 'webhook', url: 'https://example.com/hook' }],
    });
    expect(created.status).toBe(201);
    expect(typeof created.body.secret).toBe('string');
    const listed = await api('GET', automationPath(databaseId));
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body)).not.toContain(String(created.body.secret));
    expect(asArray(listed.body.automations)).toHaveLength(1);

    const computed = await api('POST', automationPath(databaseId), {
      name: 'Bad',
      trigger: { kind: 'property_edited', propertyId: 'ver' },
      actions: [{ kind: 'set_property', propertyId: 'done', value: { checked: true } }],
    });
    expect(computed.status).toBe(400);
    const plain = await api('POST', automationPath(databaseId), {
      name: 'Plain http',
      trigger: { kind: 'row_added' },
      actions: [{ kind: 'webhook', url: 'http://example.com/hook' }],
    });
    expect(plain.status).toBe(400);
  });

  it('toggles and deletes', async () => {
    const { databaseId } = await seedDatabase();
    const created = await api('POST', automationPath(databaseId), {
      name: 'Tick',
      trigger: { kind: 'row_added' },
      actions: [{ kind: 'create_row', title: 'Follow-up' }],
    });
    const id = idOf(created.body.automation);
    const off = await api('PATCH', `${automationPath(databaseId)}/${id}`, { enabled: false });
    expect(off.status).toBe(200);
    expect(asRecord(off.body.automation).enabled).toBe(false);
    expect((await api('DELETE', `${automationPath(databaseId)}/${id}`)).status).toBe(204);
    expect(asArray((await api('GET', automationPath(databaseId))).body.automations)).toHaveLength(
      0,
    );
  });
});

describe('the automation executor', () => {
  it('sets a property when a row is added, and notifies when one is ticked', async () => {
    const { databaseId } = await seedDatabase();
    currentDb = databaseId;
    const stamp = await api('POST', automationPath(databaseId), {
      name: 'Stamp',
      trigger: { kind: 'row_added' },
      actions: [{ kind: 'set_property', propertyId: 'note', value: { text: 'stamped' } }],
    });
    expect(stamp.status).toBe(201);
    await api('POST', automationPath(databaseId), {
      name: 'Tell me',
      trigger: { kind: 'property_edited', propertyId: 'done', equals: { checked: true } },
      actions: [
        { kind: 'notify', to: { kind: 'people', userIds: [ctx.userId] }, message: 'Done!' },
      ],
    });
    const pageId = await addRow(databaseId, 'Task');
    await vi.waitFor(async () => {
      expect((await rowProperties(pageId)).note).toEqual({ text: 'stamped' });
    });
    const before = sent.notifications.length;
    await api('PATCH', `/api/pages/${pageId}`, { properties: { done: { checked: false } } });
    expect(sent.notifications.length).toBe(before);
    await api('PATCH', `/api/pages/${pageId}`, { properties: { done: { checked: true } } });
    await vi.waitFor(() => {
      const mine = sent.notifications.filter(
        (n) => (n.data as { pageId?: string }).pageId === pageId,
      );
      expect(mine.at(-1)?.type).toBe('automation');
      expect(mine.at(-1)?.body).toBe('Done!');
    });
  });

  it('signs the webhook it sends, and records a failed answer', async () => {
    const { databaseId } = await seedDatabase();
    currentDb = databaseId;
    const created = await api('POST', automationPath(databaseId), {
      name: 'Out',
      trigger: { kind: 'row_added' },
      actions: [{ kind: 'webhook', url: 'https://example.com/in' }],
    });
    const secret = String(created.body.secret);
    const automationId = idOf(created.body.automation);
    sent.webhookStatus = 200;
    await addRow(databaseId, 'Hooked');
    await vi.waitFor(() =>
      expect(sent.webhooks.some((w) => w.body.includes(automationId))).toBe(true),
    );
    const hook = sent.webhooks.find((w) => w.body.includes(automationId));
    const header = hook?.headers['x-nilo-signature'] ?? '';
    const t = /t=(\d+)/.exec(header)?.[1] ?? '';
    expect(header).toBe(
      `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${hook?.body}`).digest('hex')}`,
    );
    await vi.waitFor(async () => {
      const [row] = await db
        .select()
        .from(databaseAutomations)
        .where(eq(databaseAutomations.id, automationId));
      expect(row.lastStatus).toBe('ok');
    });

    sent.webhookStatus = 500;
    await addRow(databaseId, 'Hooked again');
    await vi.waitFor(async () => {
      const [row] = await db
        .select()
        .from(databaseAutomations)
        .where(eq(databaseAutomations.id, automationId));
      expect(row.lastStatus).toBe('failed');
      expect(row.lastError).toContain('500');
    });
    sent.webhookStatus = 200;
  });

  it('retries a webhook whose receiver is down, but not one that refuses it', async () => {
    const { databaseId } = await seedDatabase();
    currentDb = databaseId;
    try {
      const created = await api('POST', automationPath(databaseId), {
        name: 'Retry',
        trigger: { kind: 'row_added' },
        actions: [{ kind: 'webhook', url: 'https://example.com/retry' }],
      });
      const automationId = idOf(created.body.automation);
      const status = async () =>
        (
          await db
            .select()
            .from(databaseAutomations)
            .where(eq(databaseAutomations.id, automationId))
        )[0];
      const attempts = () => sent.webhooks.filter((w) => w.body.includes(automationId));

      sent.webhookQueue = [503, 503];
      await addRow(databaseId, 'Flaky');
      await vi.waitFor(async () => expect((await status()).lastStatus).toBe('ok'));
      expect(attempts()).toHaveLength(3);
      expect(new Set(attempts().map((w) => w.headers['x-nilo-delivery'])).size).toBe(1);

      sent.webhooks.length = 0;
      sent.webhookQueue = [404];
      await addRow(databaseId, 'Refused');
      await vi.waitFor(async () => expect((await status()).lastStatus).toBe('failed'));
      expect(attempts()).toHaveLength(1);
      expect((await status()).lastError).toContain('404');

      // Down for every quick try: queued, and delivered by a later sweep with the same id.
      sent.webhooks.length = 0;
      sent.webhookQueue = [503, 503, 503];
      const queued = () =>
        db
          .select()
          .from(automationWebhookRetries)
          .where(eq(automationWebhookRetries.automationId, automationId));
      await addRow(databaseId, 'Outage');
      await vi.waitFor(async () => expect(await queued()).toHaveLength(1));
      expect(attempts()).toHaveLength(3);
      expect((await status()).lastStatus).toBe('failed');
      expect(await runDueWebhookRetries(db)).toBe(0); // not due yet
      await runDueWebhookRetries(db, new Date(Date.now() + 2 * 60_000));
      expect(attempts()).toHaveLength(4);
      expect(new Set(attempts().map((w) => w.headers['x-nilo-delivery'])).size).toBe(1);
      expect(await queued()).toHaveLength(0);

      // Still down on the queued try: it waits for the next one.
      sent.webhooks.length = 0;
      sent.webhookQueue = [503, 503, 503, 503];
      await addRow(databaseId, 'Longer outage');
      await vi.waitFor(async () => expect(await queued()).toHaveLength(1));
      await runDueWebhookRetries(db, new Date(Date.now() + 2 * 60_000));
      const [waiting] = await queued();
      expect(waiting.attempt).toBe(1);
      expect(waiting.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 5 * 60_000);
    } finally {
      sent.webhookQueue = [];
    }
  });

  it('turns itself off when its creator can no longer edit the database', async () => {
    const { databaseId } = await seedDatabase();
    currentDb = databaseId;
    const [inserted] = await db
      .insert(databaseAutomations)
      .values({
        databaseId,
        name: 'Orphan',
        trigger: { kind: 'row_added' },
        actions: [{ kind: 'create_row', title: 'Never' }],
        createdBy: 'stranger-without-access',
        secret: 'x',
      })
      .returning();
    await addRow(databaseId, 'Trigger');
    await vi.waitFor(async () => {
      const [row] = await db
        .select()
        .from(databaseAutomations)
        .where(eq(databaseAutomations.id, inserted.id));
      expect(row.enabled).toBe(false);
      expect(row.lastStatus).toBe('failed');
    });
  });

  it('stops a chain of automations that trigger each other', async () => {
    const { databaseId } = await seedDatabase();
    currentDb = databaseId;
    await api('POST', automationPath(databaseId), {
      name: 'Loop',
      trigger: { kind: 'row_added' },
      actions: [{ kind: 'create_row', title: 'Again' }],
    });
    await addRow(databaseId, 'Seed');
    await new Promise((r) => setTimeout(r, 1500));
    const rows = asArray((await api('GET', `/api/databases/${databaseId}/rows`)).body.rows);
    // The seed plus at most MAX_AUTOMATION_DEPTH generations of copies.
    expect(rows.length).toBeLessThanOrEqual(1 + 3);
    expect(rows.length).toBeGreaterThan(1);
  });
});
