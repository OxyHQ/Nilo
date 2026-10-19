import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
  oxyClient: {
    // The real limiters resolve an optional session through this; anonymous here.
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
    // Profiles for the people a person property can name.
    users: {
      getMany: async (ids: string[]) => ids.map((id) => ({ id, username: `handle-${id}` })),
    },
  },
  authenticateToken: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: ctx.userId };
    next();
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
import pagesRouter from './pages.js';

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
  originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = process.env.NILO_TEST_DATABASE_URL;

  ctx.workspaceId = await seedWorkspace(db, 'route-databases');
  otherWorkspaceId = await seedWorkspace(db, 'route-databases-other');
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

// ---------------------------------------------------------------------------
// The wire contract
// ---------------------------------------------------------------------------

describe('id contract', () => {
  it('emits a uuid v7 `id` on every entity and no `_id` anywhere', async () => {
    const created = await api('POST', '/api/databases', {
      workspaceId: ctx.workspaceId,
      name: 'Ids',
    });
    expect(created.status).toBe(201);
    const databaseId = idOf(created.body.database);

    const row = await api('POST', `/api/databases/${databaseId}/rows`, {
      title: 'A row',
    });
    expect(row.status).toBe(201);

    const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
    expect(databaseId).toMatch(uuidV7);
    expect(idOf(asArray(created.body.views)[0])).toMatch(uuidV7);
    expect(idOf(row.body.row)).toMatch(uuidV7);

    // `_id` absent is also what an empty response looks like, so the ids above
    // are the positive half of this assertion and this is the negative half.
    const serialized = JSON.stringify([created.body, row.body]);
    expect(serialized).not.toContain('_id');
    expect(serialized).toContain(databaseId);
  });

  it('400s a malformed id and reaches the row for a 24-hex one', async () => {
    expect((await api('GET', '/api/databases/not-an-id')).status).toBe(400);

    // A backfilled row keeps its ObjectId forever, so a 24-hex id must reach
    // the query rather than being rejected at the boundary. 404, not 400.
    const objectIdShaped = '507f1f77bcf86cd799439011';
    expect((await api('GET', `/api/databases/${objectIdShaped}`)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Databases
// ---------------------------------------------------------------------------

describe('POST /api/databases', () => {
  it('commits the database and its default view together', async () => {
    const created = await api('POST', '/api/databases', {
      workspaceId: ctx.workspaceId,
      name: 'With default view',
    });
    expect(created.status).toBe(201);
    const databaseId = idOf(created.body.database);

    const stored = await db
      .select()
      .from(databaseViews)
      .where(eq(databaseViews.databaseId, databaseId));
    expect(stored).toHaveLength(1);
    expect(stored[0].isDefault).toBe(true);
    expect(stored[0].name).toBe('All');
    expect(asArray(created.body.views)).toHaveLength(1);
  });

  it('builds the Notion default schema when none is given', async () => {
    const created = await api('POST', '/api/databases', {
      workspaceId: ctx.workspaceId,
      name: 'Defaults',
    });
    const schema = asRecord(asRecord(created.body.database).schema);
    const properties = asArray(schema.properties);
    expect(properties.map((p) => asRecord(p).id)).toEqual(['name', 'status']);
  });

  it('refuses a workspace the caller is not a member of', async () => {
    const created = await api('POST', '/api/databases', {
      workspaceId: otherWorkspaceId,
      name: 'Not mine',
    });
    expect(created.status).toBe(403);
    const rows = await db
      .select()
      .from(databases)
      .where(eq(databases.workspaceId, otherWorkspaceId));
    expect(rows).toHaveLength(0);
  });

  it('rejects a parent page in another workspace', async () => {
    const [foreignPage] = await db
      .insert(pages)
      .values({ workspaceId: otherWorkspaceId, ownerId: ctx.userId, order: 0 })
      .returning();

    const created = await api('POST', '/api/databases', {
      workspaceId: ctx.workspaceId,
      name: 'Inline',
      isInline: true,
      parentPageId: foreignPage.id,
    });
    expect(created.status).toBe(400);
    expect(created.body.error).toBe('Parent page is in a different workspace');
  });

  it('stores parentPageId for an inline database in the same workspace', async () => {
    const [hostPage] = await db
      .insert(pages)
      .values({ workspaceId: ctx.workspaceId, ownerId: ctx.userId, order: 0 })
      .returning();

    const created = await api('POST', '/api/databases', {
      workspaceId: ctx.workspaceId,
      name: 'Inline',
      isInline: true,
      parentPageId: hostPage.id,
    });
    expect(created.status).toBe(201);
    expect(asRecord(created.body.database).parentPageId).toBe(hostPage.id);
    expect(asRecord(created.body.database).isInline).toBe(true);
  });
});

describe('GET /api/databases', () => {
  it('lists this workspace only, excluding archived unless asked', async () => {
    const listedId = await createDatabase({ name: 'Listed' });
    const archivedId = await createDatabase({ name: 'Archived' });
    await api('PATCH', `/api/databases/${archivedId}`, { archived: true });

    const active = await api('GET', `/api/databases?workspaceId=${ctx.workspaceId}`);
    const activeIds = asArray(active.body.databases).map((d) => idOf(d));
    expect(activeIds).toContain(listedId);
    expect(activeIds).not.toContain(archivedId);

    const all = await api(
      'GET',
      `/api/databases?workspaceId=${ctx.workspaceId}&includeArchived=true`,
    );
    expect(asArray(all.body.databases).map((d) => idOf(d))).toContain(archivedId);
  });
});

describe('PATCH /api/databases/:id', () => {
  it('writes an explicit null and leaves an omitted field alone', async () => {
    const databaseId = await createDatabase({ icon: '📘', cover: 'c.png' });

    const renamed = await api('PATCH', `/api/databases/${databaseId}`, {
      name: 'Renamed',
    });
    expect(asRecord(renamed.body.database).icon).toBe('📘');
    expect(asRecord(renamed.body.database).cover).toBe('c.png');
    expect(asRecord(renamed.body.database).name).toBe('Renamed');

    const cleared = await api('PATCH', `/api/databases/${databaseId}`, {
      icon: null,
    });
    expect(asRecord(cleared.body.database).icon).toBeNull();
    expect(asRecord(cleared.body.database).cover).toBe('c.png');
  });
});

describe('DELETE /api/databases/:id', () => {
  it('archives by default and leaves the rows in place', async () => {
    const databaseId = await createDatabase();
    await api('POST', `/api/databases/${databaseId}/rows`, { title: 'Kept' });

    const deleted = await api('DELETE', `/api/databases/${databaseId}`);
    expect(deleted.status).toBe(200);
    expect(asRecord(deleted.body.database).archived).toBe(true);

    const rows = await db.select().from(pages).where(eq(pages.databaseId, databaseId));
    expect(rows).toHaveLength(1);
  });

  it('hard-deletes rows, their blocks, the views and the database together', async () => {
    const databaseId = await createDatabase();
    const row = await api('POST', `/api/databases/${databaseId}/rows`, {
      title: 'Doomed',
    });
    const rowId = idOf(row.body.row);
    await db.insert(blocks).values({ pageId: rowId, type: 'paragraph', order: 0 });

    // Positive control: everything this asserts the absence of is present now.
    expect(await db.select().from(blocks).where(eq(blocks.pageId, rowId))).toHaveLength(1);

    const deleted = await api('DELETE', `/api/databases/${databaseId}?hard=true`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.success).toBe(true);

    expect(await db.select().from(pages).where(eq(pages.databaseId, databaseId))).toHaveLength(0);
    expect(await db.select().from(blocks).where(eq(blocks.pageId, rowId))).toHaveLength(0);
    expect(
      await db.select().from(databaseViews).where(eq(databaseViews.databaseId, databaseId)),
    ).toHaveLength(0);
    expect(await db.select().from(databases).where(eq(databases.id, databaseId))).toHaveLength(0);
  });

  it('refuses a hard delete below owner role and destroys nothing', async () => {
    const databaseId = await createDatabase();
    await api('POST', `/api/databases/${databaseId}/rows`, { title: 'Safe' });

    // The membership itself, which the route reads.
    const setRole = (role: WorkspaceRole) =>
      db
        .update(workspaceMembers)
        .set({ role })
        .where(
          and(
            eq(workspaceMembers.workspaceId, ctx.workspaceId),
            eq(workspaceMembers.userId, ctx.userId),
          ),
        );
    ctx.role = 'editor';
    await setRole('editor');
    try {
      const refused = await api('DELETE', `/api/databases/${databaseId}?hard=true`);
      expect(refused.status).toBe(403);
    } finally {
      ctx.role = 'owner';
      await setRole('owner');
    }

    expect(await db.select().from(databases).where(eq(databases.id, databaseId))).toHaveLength(1);
    expect(await db.select().from(pages).where(eq(pages.databaseId, databaseId))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('two-way relations', () => {
  const schemaOf = async (id: string) =>
    asArray(
      asRecord((await api('GET', `/api/databases/${id}`)).body.database).schema
        ? asRecord(asRecord((await api('GET', `/api/databases/${id}`)).body.database).schema)
            .properties
        : [],
    ) as { id: string; name: string; type: string; config?: Record<string, unknown> }[];
  const rowProps = async (rowId: string) =>
    asRecord(asRecord((await db.select().from(pages).where(eq(pages.id, rowId)))[0]).properties);
  const row = async (databaseId: string, title: string, properties: Record<string, unknown> = {}) =>
    idOf((await api('POST', `/api/databases/${databaseId}/rows`, { title, properties })).body.row);

  it('keep the other side in step as rows are linked and unlinked, and go together', async () => {
    const projects = await createDatabase({ name: 'Projects' });
    const tasks = await createDatabase({ name: 'Tasks' });
    const added = await api('POST', `/api/databases/${tasks}/properties`, {
      id: 'project',
      name: 'Project',
      type: 'relation',
      config: { targetDatabaseId: projects, twoWay: true },
    });
    expect(added.status).toBe(201);
    const other = (await schemaOf(projects)).find((p) => p.type === 'relation');
    expect(other).toMatchObject({
      name: 'Tasks',
      config: { targetDatabaseId: tasks, twoWay: true, syncedPropertyId: 'project' },
    });

    const launch = await row(projects, 'Launch');
    const write = await row(tasks, 'Write', { project: { pageIds: [launch] } });
    const test = await row(tasks, 'Test', { project: { pageIds: [launch] } });
    expect(asRecord((await rowProps(launch))[other?.id as string]).pageIds).toEqual([write, test]);

    // Unlinked from one side, gone from the other.
    expect(
      (await api('PATCH', `/api/pages/${write}`, { properties: { project: { pageIds: [] } } }))
        .status,
    ).toBe(200);
    expect(asRecord((await rowProps(launch))[other?.id as string]).pageIds).toEqual([test]);

    // Deleting the relation takes its other side with it.
    expect((await api('DELETE', `/api/databases/${tasks}/properties/project`)).status).toBe(200);
    expect((await schemaOf(projects)).some((p) => p.type === 'relation')).toBe(false);
    expect((await rowProps(launch))[other?.id as string]).toBeUndefined();
  });

  it('relate a database to itself: sub-items and their parent', async () => {
    const tasks = await createDatabase({ name: 'Plan' });
    await api('POST', `/api/databases/${tasks}/properties`, {
      id: 'subs',
      name: 'Sub-items',
      type: 'relation',
      config: { targetDatabaseId: tasks, twoWay: true },
    });
    const parentProp = (await schemaOf(tasks)).find((p) => p.name === 'Sub-items (parent)');
    expect(parentProp).toBeDefined();
    const child = await row(tasks, 'Child');
    const parent = await row(tasks, 'Parent', { subs: { pageIds: [child] } });
    expect(asRecord((await rowProps(child))[parentProp?.id as string]).pageIds).toEqual([parent]);
  });

  it('fill the other side from existing links when made two-way later', async () => {
    const teams = await createDatabase({ name: 'Teams' });
    const people = await createDatabase({ name: 'People' });
    await api('POST', `/api/databases/${people}/properties`, {
      id: 'team',
      name: 'Team',
      type: 'relation',
      config: { targetDatabaseId: teams },
    });
    const core = await row(teams, 'Core');
    const ana = await row(people, 'Ana', { team: { pageIds: [core] } });
    const made = await api('PATCH', `/api/databases/${people}/properties/team`, {
      config: { targetDatabaseId: teams, twoWay: true },
    });
    expect(made.status).toBe(200);
    const other = (await schemaOf(teams)).find((p) => p.type === 'relation');
    expect(asRecord((await rowProps(core))[other?.id as string]).pageIds).toEqual([ana]);
    // Renaming it keeps the link.
    await api('PATCH', `/api/databases/${people}/properties/team`, { name: 'Squad' });
    const renamed = (await schemaOf(people)).find((p) => p.id === 'team');
    expect(renamed?.config).toMatchObject({ twoWay: true, syncedPropertyId: other?.id });
  });
});

describe('relations across access', () => {
  const schemaOf = async (id: string) =>
    (asRecord(asRecord((await api('GET', `/api/databases/${id}`)).body.database).schema)
      .properties ?? []) as { type: string }[];

  /** A database of this workspace that is a stranger's private one. */
  const strangersDatabase = async () => {
    const id = await createDatabase({ name: 'Private' });
    await db
      .update(databases)
      .set({ teamspaceId: null, ownerId: `stranger-${ctx.workspaceId}` })
      .where(eq(databases.id, id));
    return id;
  };

  it('refuse a target in another workspace', async () => {
    const elsewhere = await createDatabase({ name: 'Elsewhere' });
    await db
      .update(databases)
      .set({ workspaceId: otherWorkspaceId })
      .where(eq(databases.id, elsewhere));
    const source = await createDatabase({ name: 'Source' });
    const added = await api('POST', `/api/databases/${source}/properties`, {
      name: 'Link',
      type: 'relation',
      config: { targetDatabaseId: elsewhere, twoWay: true },
    });
    expect(added.status).toBe(400);
    const [target] = await db.select().from(databases).where(eq(databases.id, elsewhere));
    expect(target?.propertiesSchema.properties.some((p) => p.type === 'relation')).toBe(false);
  });

  it('refuse a target the caller cannot open, one-way, two-way or at creation', async () => {
    const hidden = await strangersDatabase();
    const source = await createDatabase({ name: 'Source' });
    for (const twoWay of [false, true]) {
      const added = await api('POST', `/api/databases/${source}/properties`, {
        name: 'Link',
        type: 'relation',
        config: { targetDatabaseId: hidden, twoWay },
      });
      expect(added.status).toBe(403);
    }
    // Pointing an existing relation there is refused the same way.
    await api('POST', `/api/databases/${source}/properties`, {
      id: 'link',
      name: 'Link',
      type: 'relation',
    });
    const patched = await api('PATCH', `/api/databases/${source}/properties/link`, {
      config: { targetDatabaseId: hidden, twoWay: true },
    });
    expect(patched.status).toBe(403);
    const created = await api('POST', '/api/databases', {
      workspaceId: ctx.workspaceId,
      name: 'Sneaky',
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          {
            id: 'rel',
            name: 'Rel',
            type: 'relation',
            config: { targetDatabaseId: hidden, twoWay: true },
          },
        ],
      },
    });
    expect(created.status).toBe(403);
    const [target] = await db.select().from(databases).where(eq(databases.id, hidden));
    expect(target?.propertiesSchema.properties.some((p) => p.type === 'relation')).toBe(false);
    expect((await schemaOf(source)).filter((p) => p.type === 'relation')).toHaveLength(1);
  });
});

describe('GET /api/databases/:id/people', () => {
  it('lists the members and the guests a person property can name, for its editors', async () => {
    const databaseId = await createDatabase({ name: 'People' });
    const member = `member-${ctx.workspaceId}`;
    const guest = `guest-${ctx.workspaceId}`;
    const elsewhere = `elsewhere-${ctx.workspaceId}`;
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: ctx.workspaceId, userId: member, role: 'viewer' });
    const [page] = await db
      .insert(pages)
      .values({ workspaceId: ctx.workspaceId, ownerId: ctx.userId, order: 0 })
      .returning();
    const [foreign] = await db
      .insert(pages)
      .values({ workspaceId: otherWorkspaceId, ownerId: ctx.userId, order: 0 })
      .returning();
    await db.insert(pagePermissions).values([
      { pageId: idOf(page), userId: guest, role: 'editor', grantedBy: ctx.userId },
      // A member shared a page is still a member, not a guest.
      { pageId: idOf(page), userId: member, role: 'editor', grantedBy: ctx.userId },
      // A grant in another workspace makes nobody a person of this one.
      { pageId: idOf(foreign), userId: elsewhere, role: 'editor', grantedBy: ctx.userId },
    ]);

    const listed = await api('GET', `/api/databases/${databaseId}/people`);
    expect(listed.status).toBe(200);
    const people = asArray(listed.body.people).map(asRecord);
    const byId = new Map(people.map((p) => [p.userId, p]));
    expect(byId.get(ctx.userId)).toMatchObject({ guest: false });
    expect(byId.get(member)).toMatchObject({
      guest: false,
      user: { id: member, username: `handle-${member}` },
    });
    expect(byId.get(guest)).toMatchObject({ guest: true });
    expect(byId.has(elsewhere)).toBe(false);
    expect(people.filter((p) => p.userId === member)).toHaveLength(1);
    // Everyone listed is someone a write accepts.
    const row = await api('POST', `/api/databases/${databaseId}/rows`, { title: 'r' });
    await api('POST', `/api/databases/${databaseId}/properties`, {
      id: 'who',
      name: 'Who',
      type: 'person',
    });
    const set = await api('PATCH', `/api/pages/${idOf(row.body.row)}`, {
      properties: { who: { userIds: people.map((p) => p.userId) } },
    });
    expect(set.status).toBe(200);

    // A reader of the database is not handed the workspace's people.
    const owner = ctx.userId;
    ctx.userId = member;
    try {
      expect((await api('GET', `/api/databases/${databaseId}`)).status).toBe(200);
      expect((await api('GET', `/api/databases/${databaseId}/people`)).status).toBe(403);
    } finally {
      ctx.userId = owner;
    }
  });
});

describe('properties', () => {
  it('adds a property, assigning option ids', async () => {
    const databaseId = await createDatabase();
    const added = await api('POST', `/api/databases/${databaseId}/properties`, {
      name: 'Priority',
      type: 'select',
      config: { options: [{ name: 'High' }] },
    });
    expect(added.status).toBe(201);

    const properties = asArray(asRecord(asRecord(added.body.database).schema).properties).map((p) =>
      asRecord(p),
    );
    const priority = properties.find((p) => p.name === 'Priority');
    expect(priority).toBeDefined();
    const options = asArray(asRecord(priority?.config).options).map((o) => asRecord(o));
    expect(typeof options[0].id).toBe('string');
    expect(options[0].color).toBe('default');
  });

  it('409s a duplicate property id without touching the stored schema', async () => {
    const databaseId = await createDatabase();
    const conflict = await api('POST', `/api/databases/${databaseId}/properties`, {
      id: 'name',
      name: 'Name again',
      type: 'text',
    });
    expect(conflict.status).toBe(409);

    const [stored] = await db.select().from(databases).where(eq(databases.id, databaseId));
    expect(stored.propertiesSchema.properties.map((p) => p.id)).toEqual(['name', 'status']);
  });

  it('renames a property in place', async () => {
    const databaseId = await createDatabase();
    const renamed = await api('PATCH', `/api/databases/${databaseId}/properties/status`, {
      name: 'Stage',
    });
    expect(renamed.status).toBe(200);
    const [stored] = await db.select().from(databases).where(eq(databases.id, databaseId));
    const status = stored.propertiesSchema.properties.find((p) => p.id === 'status');
    expect(status?.name).toBe('Stage');
    expect(status?.type).toBe('status');
  });

  it('refuses to delete the Name property', async () => {
    const databaseId = await createDatabase();
    const refused = await api('DELETE', `/api/databases/${databaseId}/properties/name`);
    expect(refused.status).toBe(400);
    const [stored] = await db.select().from(databases).where(eq(databases.id, databaseId));
    expect(stored.propertiesSchema.properties.some((p) => p.id === 'name')).toBe(true);
  });

  it('drops the key from the schema and from every row that carries it', async () => {
    const databaseId = await createDatabase();
    const [created] = await db.select().from(databases).where(eq(databases.id, databaseId));
    const status = created.propertiesSchema.properties.find((p) => p.id === 'status');
    const withValue = await api('POST', `/api/databases/${databaseId}/rows`, {
      title: 'Has status',
      properties: { status: { optionId: status?.config?.options?.[0]?.id } },
    });
    const withoutValue = await api('POST', `/api/databases/${databaseId}/rows`, {
      title: 'No status',
    });
    const withValueId = idOf(withValue.body.row);
    const withoutValueId = idOf(withoutValue.body.row);

    // Positive control: the key is there to be removed.
    const [before] = await db.select().from(pages).where(eq(pages.id, withValueId));
    expect(Object.keys(before.properties)).toContain('status');

    const dropped = await api('DELETE', `/api/databases/${databaseId}/properties/status`);
    expect(dropped.status).toBe(200);

    const [stored] = await db.select().from(databases).where(eq(databases.id, databaseId));
    expect(stored.propertiesSchema.properties.some((p) => p.id === 'status')).toBe(false);

    const [after] = await db.select().from(pages).where(eq(pages.id, withValueId));
    expect(Object.keys(after.properties)).not.toContain('status');

    // The degenerate case: removing a key a row never had leaves `{}`, not
    // null. `jsonb - text` on a missing key is a no-op, unlike a replacement.
    const [untouched] = await db.select().from(pages).where(eq(pages.id, withoutValueId));
    expect(untouched.properties).toEqual({});
  });
});

describe('removing a property', () => {
  it('takes it out of every view and every rollup that read it, in the same write', async () => {
    const databaseId = await createDatabase({
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'due', name: 'Due', type: 'date' },
          { id: 'pts', name: 'Points', type: 'number' },
          { id: 'kept', name: 'Kept', type: 'number' },
        ],
      },
    });
    // A rollup reading this database's own points through a relation to itself.
    for (const property of [
      { id: 'rel', name: 'Parent', type: 'relation', config: { targetDatabaseId: databaseId } },
      {
        id: 'sum',
        name: 'Sum',
        type: 'rollup',
        config: { relationPropertyId: 'rel', targetPropertyId: 'pts', function: 'sum' },
      },
    ]) {
      expect((await api('POST', `/api/databases/${databaseId}/properties`, property)).status).toBe(
        201,
      );
    }
    const condition = (propertyId: string) => ({
      kind: 'condition',
      propertyId,
      operator: 'is_not_empty',
    });
    const board = await api('POST', `/api/databases/${databaseId}/views`, {
      name: 'Everything',
      type: 'timeline',
      filters: {
        kind: 'group',
        combinator: 'or',
        filters: [
          condition('kept'),
          { kind: 'group', combinator: 'and', filters: [condition('pts'), condition('due')] },
          { kind: 'group', combinator: 'and', filters: [condition('due')] },
        ],
      },
      sorts: [
        { propertyId: 'due', direction: 'asc' },
        { propertyId: 'kept', direction: 'desc' },
      ],
      groupBy: { propertyId: 'due' },
      hiddenProperties: ['due', 'kept'],
      frozenProperties: ['due'],
      config: { startPropertyId: 'due', endPropertyId: 'due', datePropertyId: 'due' },
    });
    expect(board.status).toBe(201);

    const dropped = await api('DELETE', `/api/databases/${databaseId}/properties/due`);
    expect(dropped.status).toBe(200);
    const [view] = await db
      .select()
      .from(databaseViews)
      .where(eq(databaseViews.id, idOf(board.body.view)));
    expect(view.filters).toEqual({
      kind: 'group',
      combinator: 'or',
      filters: [
        condition('kept'),
        { kind: 'group', combinator: 'and', filters: [condition('pts')] },
      ],
    });
    expect(view.sorts).toEqual([{ propertyId: 'kept', direction: 'desc' }]);
    expect(view.groupBy).toBeNull();
    expect(view.hiddenProperties).toEqual(['kept']);
    expect(view.frozenProperties).toEqual([]);
    expect(view.config).toEqual({});
    // The view is saveable again as it now stands.
    const resaved = await api('PATCH', `/api/databases/${databaseId}/views/${view.id}`, {
      filters: view.filters,
    });
    expect(resaved.status).toBe(200);

    expect((await api('DELETE', `/api/databases/${databaseId}/properties/pts`)).status).toBe(200);
    const rollupConfig = async () => {
      const [stored] = await db.select().from(databases).where(eq(databases.id, databaseId));
      return stored.propertiesSchema.properties.find((p) => p.id === 'sum')?.config;
    };
    expect(await rollupConfig()).toEqual({ relationPropertyId: 'rel', function: 'sum' });
    expect((await api('DELETE', `/api/databases/${databaseId}/properties/rel`)).status).toBe(200);
    expect(await rollupConfig()).toEqual({ function: 'sum' });
  });
});

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

describe('rows', () => {
  it('computes formulas from the row, and marks a cycle as an error', async () => {
    const databaseId = await createDatabase({
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'pts', name: 'Points', type: 'number' },
          {
            id: 'dbl',
            name: 'Double',
            type: 'formula',
            config: { expression: 'prop("Points") * 2' },
          },
          {
            id: 'lbl',
            name: 'Label',
            type: 'formula',
            config: { expression: 'prop("Name") + " (" + prop("Double") + ")"' },
          },
          { id: 'a', name: 'A', type: 'formula', config: { expression: 'prop("B") + 1' } },
          { id: 'b', name: 'B', type: 'formula', config: { expression: 'prop("A") + 1' } },
        ],
      },
    });
    const created = await api('POST', `/api/databases/${databaseId}/rows`, {
      title: 'Spec',
      properties: { pts: { number: 4 } },
    });
    const row = asRecord(created.body.row);
    const props = asRecord(row.properties);
    expect(props.dbl).toEqual({ number: 8 });
    expect(props.lbl).toEqual({ text: 'Spec (8)' });
    expect(asRecord(props.a).error).toMatch(/refers to itself/);
    expect(asRecord(props.b).error).toMatch(/refers to itself/);
  });

  it('creates rows from a row template, which is not itself listed as a row', async () => {
    const databaseId = await createDatabase();
    const made = await api('POST', `/api/databases/${databaseId}/rows`, { title: 'Bug report' });
    const templateId = idOf(made.body.row);
    await db
      .update(pages)
      .set({ template: true, icon: 'emoji:🐞' })
      .where(eq(pages.id, templateId));
    await db
      .insert(blocks)
      .values({ pageId: templateId, type: 'paragraph', content: { text: 'Steps:' }, order: 1 });

    const listed = await api('GET', `/api/databases/${databaseId}/rows`);
    expect((listed.body.rows as unknown[]).length).toBe(0);
    const templates = await api('GET', `/api/databases/${databaseId}/templates`);
    expect((templates.body.templates as { id: string }[]).map((t) => t.id)).toEqual([templateId]);

    const fromTemplate = await api('POST', `/api/databases/${databaseId}/rows`, { templateId });
    expect(fromTemplate.status).toBe(201);
    const row = asRecord(fromTemplate.body.row);
    expect(row.title).toBe('Bug report');
    const [stored] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, idOf(fromTemplate.body.row)));
    expect(stored?.icon).toBe('emoji:🐞');
    expect(stored?.template).toBe(false);
    const copied = await db
      .select()
      .from(blocks)
      .where(eq(blocks.pageId, stored?.id as string));
    expect(copied.map((b) => b.content.text)).toEqual(['Steps:']);

    expect(
      (
        await api('POST', `/api/databases/${databaseId}/rows`, {
          templateId: idOf(fromTemplate.body.row),
        })
      ).status,
    ).toBe(400);
  });

  it('creates a template in one step, and reads one row with its formulas whatever the view', async () => {
    const databaseId = await createDatabase();
    await api('POST', `/api/databases/${databaseId}/properties`, {
      id: 'pts',
      name: 'Points',
      type: 'number',
    });
    await api('POST', `/api/databases/${databaseId}/properties`, {
      id: 'dbl',
      name: 'Double',
      type: 'formula',
      config: { expression: 'prop("Points") * 2' },
    });
    const made = await api('POST', `/api/databases/${databaseId}/rows`, {
      title: 'Estimate',
      properties: { pts: { number: 3 } },
      template: true,
    });
    expect(made.status).toBe(201);
    const templateId = idOf(made.body.row);
    // Never a row, not even for a moment.
    const listed = await api('GET', `/api/databases/${databaseId}/rows`);
    expect(listed.body.rows).toEqual([]);
    const templates = await api('GET', `/api/databases/${databaseId}/templates`);
    const [template] = templates.body.templates as Record<string, unknown>[];
    expect(asRecord(asRecord(template).properties).dbl).toEqual({ number: 6 });

    const one = await api('GET', `/api/databases/${databaseId}/rows/${templateId}`);
    expect(one.status).toBe(200);
    expect(asRecord(asRecord(one.body.row).properties).dbl).toEqual({ number: 6 });
    const other = await createDatabase();
    expect((await api('GET', `/api/databases/${other}/rows/${templateId}`)).status).toBe(404);
  });

  it('numbers rows with an ID property, existing ones first, and never takes one from the client', async () => {
    const databaseId = await createDatabase();
    await api('POST', `/api/databases/${databaseId}/rows`, { title: 'first' });
    await api('POST', `/api/databases/${databaseId}/rows`, { title: 'second' });
    const added = await api('POST', `/api/databases/${databaseId}/properties`, {
      id: 'tid',
      name: 'ID',
      type: 'unique_id',
      config: { prefix: 'TASK' },
    });
    expect(added.status).toBe(201);
    const third = await api('POST', `/api/databases/${databaseId}/rows`, {
      title: 'third',
      properties: { tid: { number: 999 } },
    });
    expect(asRecord(asRecord(third.body.row).properties).tid).toEqual({ number: 3 });
    const rows = await db.select().from(pages).where(eq(pages.databaseId, databaseId));
    expect(
      rows.map((r) => [r.title, (r.properties.tid as { number: number }).number]).sort(),
    ).toEqual([
      ['first', 1],
      ['second', 2],
      ['third', 3],
    ]);
    const csv = await api('GET', `/api/databases/${databaseId}/export?format=csv`);
    expect(String(csv.body.text)).toContain('TASK-3');
  });

  it('stores property values as jsonb and mirrors the name into the title', async () => {
    const databaseId = await createDatabase();
    const created = await api('POST', `/api/databases/${databaseId}/rows`, {
      properties: { name: { text: 'From the name property' } },
    });
    expect(created.status).toBe(201);
    expect(asRecord(created.body.row).title).toBe('From the name property');

    const [stored] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, idOf(created.body.row)));
    expect(stored.properties).toEqual({ name: { text: 'From the name property' } });
    expect(stored.databaseId).toBe(databaseId);
    expect(stored.parentId).toBeNull();
  });

  it('drops keys naming an unknown or server-derived property', async () => {
    const databaseId = await createDatabase();
    const created = await api('POST', `/api/databases/${databaseId}/rows`, {
      title: 'Filtered',
      properties: {
        name: { text: 'Kept' },
        nope: { text: 'Unknown property' },
      },
    });
    const [stored] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, idOf(created.body.row)));
    expect(Object.keys(stored.properties)).toEqual(['name']);
  });

  it('refuses to set a property the database lacks or computes, and stores nothing', async () => {
    const databaseId = await createDatabase({
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'n', name: 'N', type: 'number' },
          { id: 'f', name: 'F', type: 'formula', config: { expression: 'prop("N") * 2' } },
        ],
      },
    });
    const rowId = idOf(
      (await api('POST', `/api/databases/${databaseId}/rows`, { title: 'r' })).body.row,
    );
    const unknown = await api('PATCH', `/api/pages/${rowId}`, {
      properties: { n: { number: 1 }, gone: { text: 'x' } },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe('UNKNOWN_PROPERTY');
    const computed = await api('PATCH', `/api/pages/${rowId}`, {
      properties: { f: { number: 9 } },
    });
    expect(computed.status).toBe(400);
    expect(computed.body.code).toBe('COMPUTED_PROPERTY');
    const [stored] = await db.select().from(pages).where(eq(pages.id, rowId));
    expect(stored?.properties.n).toBeUndefined();
  });

  it('refuses an option, a person or a related row the property cannot hold', async () => {
    const targetId = await createDatabase({ name: 'Targets' });
    const elsewhere = await createDatabase({ name: 'Elsewhere' });
    const target = idOf(
      (await api('POST', `/api/databases/${targetId}/rows`, { title: 'target' })).body.row,
    );
    const stray = idOf(
      (await api('POST', `/api/databases/${elsewhere}/rows`, { title: 'stray' })).body.row,
    );
    const databaseId = await createDatabase({
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          {
            id: 'pri',
            name: 'Priority',
            type: 'select',
            config: { options: [{ id: 'hi', name: 'Hi' }] },
          },
          {
            id: 'tags',
            name: 'Tags',
            type: 'multi_select',
            config: {
              options: [
                { id: 'a', name: 'A' },
                { id: 'b', name: 'B' },
              ],
            },
          },
          { id: 'who', name: 'Who', type: 'person' },
          { id: 'rel', name: 'Related', type: 'relation', config: { targetDatabaseId: targetId } },
        ],
      },
    });
    const create = (properties: Record<string, unknown>) =>
      api('POST', `/api/databases/${databaseId}/rows`, { title: 'r', properties });
    for (const [properties, code] of [
      [{ pri: { optionId: 'ghost' } }, 'UNKNOWN_OPTION'],
      [{ tags: { optionIds: ['a', 'ghost'] } }, 'UNKNOWN_OPTION'],
      [{ who: { userIds: [`stranger-${ctx.workspaceId}`] } }, 'UNKNOWN_PERSON'],
      [{ rel: { pageIds: [stray] } }, 'UNKNOWN_RELATED_ROW'],
    ] as const) {
      const refused = await create(properties);
      expect(refused.status, JSON.stringify(properties)).toBe(400);
      expect(refused.body.code).toBe(code);
    }
    const made = await create({
      pri: { optionId: 'hi' },
      tags: { optionIds: ['a', 'b'] },
      who: { userIds: [ctx.userId] },
      rel: { pageIds: [target] },
    });
    expect(made.status).toBe(201);
    const rowId = idOf(made.body.row);

    const patched = await api('PATCH', `/api/pages/${rowId}`, {
      properties: { rel: { pageIds: [target, stray] } },
    });
    expect(patched.status).toBe(400);
    expect(patched.body).toMatchObject({ code: 'UNKNOWN_RELATED_ROW', propertyId: 'rel' });
    const [unchanged] = await db.select().from(pages).where(eq(pages.id, rowId));
    expect(unchanged?.properties.rel).toEqual({ pageIds: [target] });

    // An id the row already holds stays when its option is gone: the client sends the list back.
    const removed = await api('PATCH', `/api/databases/${databaseId}/properties/tags`, {
      config: { options: [{ id: 'a', name: 'A' }] },
    });
    expect(removed.status).toBe(200);
    const kept = await api('PATCH', `/api/pages/${rowId}`, {
      properties: { tags: { optionIds: ['b'] } },
    });
    expect(kept.status).toBe(200);
  });

  it('numbers rows from the highest existing order', async () => {
    const databaseId = await createDatabase();
    const first = await api('POST', `/api/databases/${databaseId}/rows`, {
      title: 'first',
    });
    const second = await api('POST', `/api/databases/${databaseId}/rows`, {
      title: 'second',
    });
    expect(asRecord(first.body.row).order).toBe(0);
    expect(asRecord(second.body.row).order).toBe(1);
  });

  it('lists live rows, searches them, and pages them through an opaque cursor', async () => {
    const databaseId = await createDatabase();
    for (const title of ['alpha', 'beta', 'gamma']) {
      await api('POST', `/api/databases/${databaseId}/rows`, { title });
    }
    await db
      .update(pages)
      .set({ archived: true })
      .where(and(eq(pages.databaseId, databaseId), eq(pages.title, 'gamma')));

    const listed = await api('GET', `/api/databases/${databaseId}/rows`);
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(2);
    expect(asArray(listed.body.rows).map((r) => asRecord(r).title)).toEqual(['alpha', 'beta']);

    const searched = await api('GET', `/api/databases/${databaseId}/rows?search=alp`);
    expect(searched.body.total).toBe(1);

    const paged = await api('GET', `/api/databases/${databaseId}/rows?pageSize=1`);
    expect(asArray(paged.body.rows)).toHaveLength(1);
    const cursor = String(paged.body.cursor);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    const second = await api(
      'GET',
      `/api/databases/${databaseId}/rows?pageSize=1&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(asRecord(asArray(second.body.rows)[0]).title).toBe('beta');
    expect(second.body.cursor).toBeNull();
    // An offset is not a cursor.
    const offset = await api('GET', `/api/databases/${databaseId}/rows?pageSize=1&cursor=1`);
    expect(offset.status).toBe(400);
  });

  it('pages through rows the view cannot tell apart once each, and returns them whole', async () => {
    const databaseId = await createDatabase();
    const added = await api('POST', `/api/databases/${databaseId}/properties`, {
      name: 'Notes',
      type: 'text',
    });
    const notes = asArray(asRecord(asRecord(added.body.database).schema).properties)
      .map((p) => asRecord(p))
      .find((p) => p.name === 'Notes');
    const notesId = String(notes?.id);
    for (let i = 0; i < 23; i += 1) {
      await api('POST', `/api/databases/${databaseId}/rows`, {
        title: `row ${i}`,
        properties: { [notesId]: { text: `note ${i}` } },
      });
    }
    // Created in the same instant: only the id tells them apart.
    await db
      .update(pages)
      .set({ createdAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(pages.databaseId, databaseId));
    // A view sorting on a property every row shares: a checkbox none has set.
    const flagged = await api('POST', `/api/databases/${databaseId}/properties`, {
      name: 'Flag',
      type: 'checkbox',
    });
    const flagId = String(
      asArray(asRecord(asRecord(flagged.body.database).schema).properties)
        .map((p) => asRecord(p))
        .find((p) => p.name === 'Flag')?.id,
    );
    const view = await api('POST', `/api/databases/${databaseId}/views`, {
      name: 'All alike',
      type: 'table',
      sorts: [{ propertyId: flagId, direction: 'asc' }],
    });
    const viewId = idOf(view.body.view);

    const seen: Record<string, unknown>[] = [];
    let cursor: unknown = null;
    do {
      const page = await api(
        'GET',
        `/api/databases/${databaseId}/rows?viewId=${viewId}&pageSize=5${cursor ? `&cursor=${cursor}` : ''}`,
      );
      expect(page.body.total).toBe(23);
      seen.push(...asArray(page.body.rows).map((r) => asRecord(r)));
      cursor = page.body.cursor;
    } while (cursor);

    const ids = seen.map((r) => String(r.id));
    expect(new Set(ids).size).toBe(23);
    expect(ids).toEqual([...ids].sort());
    // Properties the view does not read come back too.
    for (const row of seen) {
      const n = String(row.title).slice('row '.length);
      expect(asRecord(asRecord(row.properties)[notesId]).text).toBe(`note ${n}`);
    }
  });

  it('applies a view filter and a view sort to the Postgres rows', async () => {
    const databaseId = await createDatabase();
    for (const title of ['keep me', 'drop me', 'keep also']) {
      await api('POST', `/api/databases/${databaseId}/rows`, { title });
    }

    const view = await api('POST', `/api/databases/${databaseId}/views`, {
      name: 'Keepers',
      type: 'table',
      filters: {
        kind: 'group',
        combinator: 'and',
        filters: [
          {
            kind: 'condition',
            propertyId: 'name',
            operator: 'contains',
            value: 'keep',
          },
        ],
      },
      sorts: [{ propertyId: 'name', direction: 'desc' }],
    });
    const viewId = idOf(view.body.view);

    const listed = await api('GET', `/api/databases/${databaseId}/rows?viewId=${viewId}`);
    expect(asArray(listed.body.rows).map((r) => asRecord(r).title)).toEqual([
      'keep me',
      'keep also',
    ]);
    expect(listed.body.total).toBe(2);
  });

  it('filters and sorts on a formula, and sorts options in their listed order', async () => {
    const databaseId = await createDatabase({
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'pts', name: 'Points', type: 'number' },
          {
            id: 'dbl',
            name: 'Double',
            type: 'formula',
            config: { expression: 'prop("Points") * 2' },
          },
          {
            id: 'pri',
            name: 'Priority',
            type: 'select',
            config: {
              options: [
                { id: 'zz-high', name: 'High' },
                { id: 'aa-low', name: 'Low' },
              ],
            },
          },
        ],
      },
    });
    for (const [title, pts, pri] of [
      ['one', 1, 'aa-low'],
      ['five', 5, 'zz-high'],
      ['three', 3, 'aa-low'],
    ] as const) {
      await api('POST', `/api/databases/${databaseId}/rows`, {
        title,
        properties: { pts: { number: pts }, pri: { optionId: pri } },
      });
    }
    const byFormula = await api('POST', `/api/databases/${databaseId}/views`, {
      name: 'Big',
      type: 'table',
      filters: {
        kind: 'group',
        combinator: 'and',
        filters: [{ kind: 'condition', propertyId: 'dbl', operator: '>', value: 4 }],
      },
      sorts: [{ propertyId: 'dbl', direction: 'desc' }],
    });
    const big = await api(
      'GET',
      `/api/databases/${databaseId}/rows?viewId=${idOf(byFormula.body.view)}`,
    );
    expect(asArray(big.body.rows).map((r) => asRecord(r).title)).toEqual(['five', 'three']);

    const byPriority = await api('POST', `/api/databases/${databaseId}/views`, {
      name: 'Priority',
      type: 'table',
      sorts: [
        { propertyId: 'pri', direction: 'asc' },
        { propertyId: 'pts', direction: 'asc' },
      ],
    });
    const sorted = await api(
      'GET',
      `/api/databases/${databaseId}/rows?viewId=${idOf(byPriority.body.view)}`,
    );
    // High is listed first, whatever its id.
    expect(asArray(sorted.body.rows).map((r) => asRecord(r).title)).toEqual([
      'five',
      'one',
      'three',
    ]);
  });

  it('resolves created_time, created_by and formula properties at read time', async () => {
    const databaseId = await createDatabase({
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'made', name: 'Made', type: 'created_time' },
          { id: 'by', name: 'By', type: 'created_by' },
          {
            id: 'calc',
            name: 'Calc',
            type: 'formula',
            config: { expression: '2 + 3' },
          },
        ],
      },
    });
    await api('POST', `/api/databases/${databaseId}/rows`, { title: 'Derived' });

    const listed = await api('GET', `/api/databases/${databaseId}/rows`);
    const properties = asRecord(asRecord(asArray(listed.body.rows)[0]).properties);
    expect(typeof asRecord(properties.made).start).toBe('string');
    expect(asRecord(properties.by).userIds).toEqual([ctx.userId]);
    expect(asRecord(properties.calc).number).toBe(5);
  });

  it('sums a rollup across rows referenced by uuid v7 ids', async () => {
    const targetId = await createDatabase({
      name: 'Amounts',
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'amount', name: 'Amount', type: 'number' },
        ],
      },
    });
    const five = await api('POST', `/api/databases/${targetId}/rows`, {
      title: 'five',
      properties: { amount: { number: 5 } },
    });
    const seven = await api('POST', `/api/databases/${targetId}/rows`, {
      title: 'seven',
      properties: { amount: { number: 7 } },
    });

    const sourceId = await createDatabase({
      name: 'Rollups',
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          {
            id: 'rel',
            name: 'Related',
            type: 'relation',
            config: { targetDatabaseId: targetId },
          },
          {
            id: 'total',
            name: 'Total',
            type: 'rollup',
            config: {
              relationPropertyId: 'rel',
              targetPropertyId: 'amount',
              function: 'sum',
            },
          },
        ],
      },
    });

    // The write itself is half the regression: `relationValueSchema` used to
    // require a 24-hex id, so a relation naming uuid v7 rows was a 400.
    const created = await api('POST', `/api/databases/${sourceId}/rows`, {
      title: 'Sums',
      properties: {
        rel: { pageIds: [idOf(five.body.row), idOf(seven.body.row)] },
      },
    });
    expect(created.status).toBe(201);

    const listed = await api('GET', `/api/databases/${sourceId}/rows`);
    const properties = asRecord(asRecord(asArray(listed.body.rows)[0]).properties);
    expect(asRecord(properties.total).number).toBe(12);
  });

  it('rolls up every row of a view from its own relations, and sorts by it', async () => {
    const targetId = await createDatabase({
      name: 'Points',
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'pts', name: 'Points', type: 'number' },
        ],
      },
    });
    const targets: string[] = [];
    for (let i = 1; i <= 10; i += 1) {
      const made = await api('POST', `/api/databases/${targetId}/rows`, {
        title: `t${i}`,
        properties: { pts: { number: i } },
      });
      targets.push(idOf(made.body.row));
    }
    const sourceId = await createDatabase({
      name: 'Many rollups',
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'rel', name: 'Related', type: 'relation', config: { targetDatabaseId: targetId } },
          {
            id: 'sum',
            name: 'Sum',
            type: 'rollup',
            config: { relationPropertyId: 'rel', targetPropertyId: 'pts', function: 'sum' },
          },
          {
            id: 'double',
            name: 'Double',
            type: 'formula',
            config: { expression: 'prop("Sum") * 2' },
          },
        ],
      },
    });
    // Row k relates to targets 1..k (sum k(k+1)/2); 60 rows.
    const ROWS = 60;
    for (let k = 1; k <= ROWS; k += 1) {
      await api('POST', `/api/databases/${sourceId}/rows`, {
        title: `r${k}`,
        properties: { rel: { pageIds: targets.slice(0, Math.min(k, 10)) } },
      });
    }
    const listed = await api('GET', `/api/databases/${sourceId}/rows?pageSize=500`);
    const rows = asArray(listed.body.rows).map((r) => asRecord(r));
    expect(rows).toHaveLength(ROWS);
    for (const row of rows) {
      const k = Math.min(Number(String(row.title).slice(1)), 10);
      const props = asRecord(row.properties);
      expect(asRecord(props.sum).number).toBe((k * (k + 1)) / 2);
      expect(asRecord(props.double).number).toBe(k * (k + 1));
    }

    // Sorted by the formula over the rollup, largest first.
    const views = await api('GET', `/api/databases/${sourceId}/views`);
    const viewId = idOf(asArray(views.body.views)[0]);
    const patched = await api('PATCH', `/api/databases/${sourceId}/views/${viewId}`, {
      sorts: [{ propertyId: 'double', direction: 'desc' }],
    });
    expect(patched.status).toBe(200);
    const sorted = await api(
      'GET',
      `/api/databases/${sourceId}/rows?viewId=${viewId}&pageSize=500`,
    );
    const first = asRecord(asArray(sorted.body.rows)[0]);
    expect(asRecord(asRecord(first.properties).double).number).toBe(110);
  });

  it('counts an empty relation as 0 and a missing one as blank', async () => {
    const targetId = await createDatabase({ name: 'Counted' });
    const databaseId = await createDatabase({
      name: 'Empty rollups',
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'rel', name: 'Related', type: 'relation', config: { targetDatabaseId: targetId } },
          {
            id: 'howMany',
            name: 'How many',
            type: 'rollup',
            config: {
              relationPropertyId: 'rel',
              targetPropertyId: 'amount',
              function: 'count',
            },
          },
        ],
      },
    });

    await api('POST', `/api/databases/${databaseId}/rows`, {
      title: 'empty list',
      properties: { rel: { pageIds: [] } },
    });
    await api('POST', `/api/databases/${databaseId}/rows`, {
      title: 'no relation at all',
    });

    const listed = await api('GET', `/api/databases/${databaseId}/rows`);
    const byTitle = new Map(
      asArray(listed.body.rows).map((r) => {
        const row = asRecord(r);
        return [String(row.title), asRecord(row.properties)];
      }),
    );
    expect(asRecord(byTitle.get('empty list')?.howMany).number).toBe(0);
    // No relation value at all is unresolvable, not zero — the em-dash case.
    expect(asRecord(byTitle.get('no relation at all')?.howMany).text).toBe('');
  });

  it('counts only live related rows, with no target property', async () => {
    const targetId = await createDatabase({ name: 'Counted live' });
    const kept = idOf(
      (await api('POST', `/api/databases/${targetId}/rows`, { title: 'kept' })).body.row,
    );
    const gone = idOf(
      (await api('POST', `/api/databases/${targetId}/rows`, { title: 'gone' })).body.row,
    );
    const sourceId = await createDatabase({
      name: 'Live count',
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'rel', name: 'Related', type: 'relation', config: { targetDatabaseId: targetId } },
          {
            id: 'n',
            name: 'N',
            type: 'rollup',
            config: { relationPropertyId: 'rel', function: 'count' },
          },
        ],
      },
    });
    await api('POST', `/api/databases/${sourceId}/rows`, {
      title: 'counts',
      properties: { rel: { pageIds: [kept, gone] } },
    });
    // Trashed once related: a relation cannot be given a row in the trash.
    expect((await api('DELETE', `/api/pages/${gone}`)).status).toBe(200);
    const listed = await api('GET', `/api/databases/${sourceId}/rows`);
    const props = asRecord(asRecord(asArray(listed.body.rows)[0]).properties);
    expect(asRecord(props.n).number).toBe(1);
  });

  it('rolls up nothing from a database the reader cannot open', async () => {
    const targetId = await createDatabase({
      name: 'Salaries',
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'pay', name: 'Pay', type: 'number' },
        ],
      },
    });
    const salary = idOf(
      (
        await api('POST', `/api/databases/${targetId}/rows`, {
          title: 'salary',
          properties: { pay: { number: 90_000 } },
        })
      ).body.row,
    );
    const sourceId = await createDatabase({
      name: 'People',
      schema: {
        properties: [
          { id: 'name', name: 'Name', type: 'text' },
          { id: 'rel', name: 'Related', type: 'relation', config: { targetDatabaseId: targetId } },
          {
            id: 'total',
            name: 'Total',
            type: 'rollup',
            config: { relationPropertyId: 'rel', targetPropertyId: 'pay', function: 'sum' },
          },
        ],
      },
    });
    await api('POST', `/api/databases/${sourceId}/rows`, {
      title: 'someone',
      properties: { rel: { pageIds: [salary] } },
    });
    const totalNow = async () =>
      asRecord(
        asRecord(
          asRecord(asArray((await api('GET', `/api/databases/${sourceId}/rows`)).body.rows)[0])
            .properties,
        ).total,
      );
    expect((await totalNow()).number).toBe(90_000);
    // The target becomes someone else's private database.
    await db
      .update(databases)
      .set({ teamspaceId: null, ownerId: `stranger-${ctx.workspaceId}` })
      .where(eq(databases.id, targetId));
    expect((await totalNow()).number).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

describe('views', () => {
  it('creates a view after the last order and lists it in order', async () => {
    const databaseId = await createDatabase();
    const created = await api('POST', `/api/databases/${databaseId}/views`, {
      name: 'Board',
      type: 'board',
      groupBy: { propertyId: 'status' },
      hiddenProperties: [],
    });
    expect(created.status).toBe(201);
    expect(asRecord(created.body.view).order).toBe(1);
    expect(asRecord(asRecord(created.body.view).groupBy).propertyId).toBe('status');
    expect(asRecord(created.body.view).hiddenProperties).toEqual([]);

    const listed = await api('GET', `/api/databases/${databaseId}/views`);
    expect(asArray(listed.body.views).map((v) => asRecord(v).name)).toEqual(['All', 'Board']);
  });

  it('honours an explicit order of 0 rather than treating it as absent', async () => {
    const databaseId = await createDatabase();
    const created = await api('POST', `/api/databases/${databaseId}/views`, {
      name: 'First',
      type: 'table',
      order: 0,
    });
    expect(asRecord(created.body.view).order).toBe(0);
  });

  it('promotes a view to default and demotes the previous one', async () => {
    const databaseId = await createDatabase();
    const created = await api('POST', `/api/databases/${databaseId}/views`, {
      name: 'Gallery',
      type: 'gallery',
    });
    const promotedId = idOf(created.body.view);

    const promoted = await api('PATCH', `/api/databases/${databaseId}/views/${promotedId}`, {
      isDefault: true,
    });
    expect(promoted.status).toBe(200);

    const stored = await db
      .select()
      .from(databaseViews)
      .where(eq(databaseViews.databaseId, databaseId));
    expect(stored.filter((v) => v.isDefault).map((v) => v.id)).toEqual([promotedId]);
  });

  it('distinguishes an omitted groupBy from an explicit null', async () => {
    const databaseId = await createDatabase();
    const created = await api('POST', `/api/databases/${databaseId}/views`, {
      name: 'Board',
      type: 'board',
      groupBy: { propertyId: 'status' },
    });
    const viewId = idOf(created.body.view);

    const renamed = await api('PATCH', `/api/databases/${databaseId}/views/${viewId}`, {
      name: 'Renamed',
    });
    expect(asRecord(asRecord(renamed.body.view).groupBy).propertyId).toBe('status');

    const ungrouped = await api('PATCH', `/api/databases/${databaseId}/views/${viewId}`, {
      groupBy: null,
    });
    expect(asRecord(ungrouped.body.view).groupBy).toBeNull();
  });

  it('keeps a form view’s description', async () => {
    const databaseId = await createDatabase({ name: 'Signups' });
    const created = await api('POST', `/api/databases/${databaseId}/views`, {
      name: 'Form',
      type: 'form',
      config: { description: 'Tell us who you are.' },
    });
    expect(created.status).toBe(201);
    expect(asRecord(asRecord(created.body.view).config).description).toBe('Tell us who you are.');
    const viewId = idOf(created.body.view);
    const patched = await api('PATCH', `/api/databases/${databaseId}/views/${viewId}`, {
      config: { description: 'Updated.' },
    });
    expect(asRecord(asRecord(patched.body.view).config).description).toBe('Updated.');
  });

  it('refuses a filter on a property the database lacks or with an operator it does not take', async () => {
    const databaseId = await createDatabase();
    const viewId = idOf(
      (await api('POST', `/api/databases/${databaseId}/views`, { name: 'V', type: 'table' })).body
        .view,
    );
    const only = (propertyId: string, operator: string) => ({
      kind: 'group',
      combinator: 'and',
      filters: [
        { kind: 'group', combinator: 'or', filters: [{ kind: 'condition', propertyId, operator }] },
      ],
    });
    for (const filters of [only('status', 'contains'), only('ghost', 'is_empty')]) {
      const refused = await api('PATCH', `/api/databases/${databaseId}/views/${viewId}`, {
        filters,
      });
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('INVALID_FILTER');
      const created = await api('POST', `/api/databases/${databaseId}/views`, {
        name: 'W',
        type: 'table',
        filters,
      });
      expect(created.status).toBe(400);
    }
    const accepted = await api('PATCH', `/api/databases/${databaseId}/views/${viewId}`, {
      filters: only('status', 'is_not'),
    });
    expect(accepted.status).toBe(200);
  });

  it('refuses a view belonging to another database', async () => {
    const first = await createDatabase();
    const second = await createDatabase();
    const stolen = await db
      .select()
      .from(databaseViews)
      .where(eq(databaseViews.databaseId, second));

    const patched = await api('PATCH', `/api/databases/${first}/views/${stolen[0].id}`, {
      name: 'Nope',
    });
    expect(patched.status).toBe(404);
    const [unchanged] = await db
      .select()
      .from(databaseViews)
      .where(eq(databaseViews.id, stolen[0].id));
    expect(unchanged.name).toBe('All');
  });

  it('refuses to delete the last view', async () => {
    const databaseId = await createDatabase();
    const [only] = await db
      .select()
      .from(databaseViews)
      .where(eq(databaseViews.databaseId, databaseId));

    const refused = await api('DELETE', `/api/databases/${databaseId}/views/${only.id}`);
    expect(refused.status).toBe(400);
    expect(
      await db.select().from(databaseViews).where(eq(databaseViews.databaseId, databaseId)),
    ).toHaveLength(1);
  });

  it('promotes the next view when the default is deleted', async () => {
    const databaseId = await createDatabase();
    const [original] = await db
      .select()
      .from(databaseViews)
      .where(eq(databaseViews.databaseId, databaseId));
    const extra = await api('POST', `/api/databases/${databaseId}/views`, {
      name: 'Second',
      type: 'list',
    });
    const extraId = idOf(extra.body.view);

    const deleted = await api('DELETE', `/api/databases/${databaseId}/views/${original.id}`);
    expect(deleted.status).toBe(200);

    const remaining = await db
      .select()
      .from(databaseViews)
      .where(eq(databaseViews.databaseId, databaseId));
    expect(remaining.map((v) => v.id)).toEqual([extraId]);
    expect(remaining[0].isDefault).toBe(true);
  });
});
