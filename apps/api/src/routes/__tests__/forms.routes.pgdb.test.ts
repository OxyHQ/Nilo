/**
 * Database forms against PostgreSQL: the link a form view gets, what the
 * public sees, responses becoming rows (validated, only the form's fields),
 * closed and sign-in-only forms, and the submission rate limit.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { databaseViews } from '../../db/schema/databases.js';
import { pages } from '../../db/schema/pages.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';
import { resetLocalRateLimits } from '../../lib/rate-limit.js';

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
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: formsRouter } = await import('../forms.js');
const { default: databasesRouter } = await import('../databases.js');

let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let previousUrl: string | undefined;
const EDITOR = 'form-editor';

async function api(user: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(user && {
        'x-test-user': user,
        authorization: 'Bearer test',
        'x-workspace-id': workspaceId,
      }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // A 429 comes from the SDK's limiter, whose body is not JSON.
  const text = await res.text();
  const json = (
    res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : {}
  ) as Record<string, unknown>;
  return { status: res.status, json };
}

/** A database with Name, a select and a hidden note, and a form view with its link. */
async function setup() {
  const created = await api(EDITOR, 'POST', '/databases', {
    workspaceId,
    name: 'Feedback',
    schema: {
      properties: [
        { id: 'name', name: 'Name', type: 'text' },
        {
          id: 'mood',
          name: 'Mood',
          type: 'select',
          config: { options: [{ name: 'Happy' }, { name: 'Sad' }] },
        },
        { id: 'note', name: 'Internal note', type: 'text' },
      ],
    },
  });
  const database = created.json.database as {
    id: string;
    schema: { properties: { id: string; config?: { options: { id: string }[] } }[] };
  };
  const view = await api(EDITOR, 'POST', `/databases/${database.id}/views`, {
    name: 'Tell us',
    type: 'form',
  });
  const viewId = (view.json.view as { id: string }).id;
  await db
    .update(databaseViews)
    .set({ hiddenProperties: ['note'] })
    .where(eq(databaseViews.id, viewId));
  const form = await api(EDITOR, 'PUT', `/databases/${database.id}/views/${viewId}/form`, {});
  const happy = database.schema.properties.find((p) => p.id === 'mood')?.config?.options[0]
    ?.id as string;
  return {
    databaseId: database.id,
    viewId,
    token: (form.json.form as { token: string }).token,
    happy,
  };
}

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: testScope('forms'), ownerId: EDITOR })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db.insert(workspaceMembers).values({ workspaceId, userId: EDITOR, role: 'owner' });
  const app = express();
  app.use(express.json());
  app.use(formsRouter);
  app.use(
    '/databases',
    (req, _res, next) => {
      req.user = { id: String(req.header('x-test-user')) };
      next();
    },
    databasesRouter,
  );
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => resetLocalRateLimits());

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousUrl;
});

describe('database forms', () => {
  it('show the public only the fields, and turn responses into rows', async () => {
    const { databaseId, token, happy } = await setup();
    const form = await api(null, 'GET', `/forms/${token}`);
    expect(form.status).toBe(200);
    expect(form.json.title).toBe('Tell us');
    expect((form.json.fields as { id: string }[]).map((f) => f.id)).toEqual(['name', 'mood']);

    const sent = await api(null, 'POST', `/forms/${token}`, {
      values: { name: { text: 'Great app' }, mood: { optionId: happy }, note: { text: 'sneaky' } },
    });
    expect(sent.status).toBe(201);
    const rows = await db.select().from(pages).where(eq(pages.databaseId, databaseId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Great app');
    // A hidden field cannot be filled from outside.
    expect(rows[0]?.properties).toEqual({ name: { text: 'Great app' }, mood: { optionId: happy } });
    expect(rows[0]?.ownerId).toMatch(/^form:/);
  });

  it('require the first field, and validate values', async () => {
    const { token } = await setup();
    expect((await api(null, 'POST', `/forms/${token}`, { values: {} })).status).toBe(400);
    expect(
      (await api(null, 'POST', `/forms/${token}`, { values: { name: { text: 1 } } })).status,
    ).toBe(400);
  });

  it('stop answering when closed, and ask for sign-in when required', async () => {
    const { databaseId, viewId, token } = await setup();
    await api(EDITOR, 'PUT', `/databases/${databaseId}/views/${viewId}/form`, {
      requireSignIn: true,
    });
    expect((await api(null, 'GET', `/forms/${token}`)).status).toBe(401);
    expect((await api(EDITOR, 'GET', `/forms/${token}`)).status).toBe(200);
    await api(EDITOR, 'PUT', `/databases/${databaseId}/views/${viewId}/form`, { open: false });
    expect((await api(EDITOR, 'GET', `/forms/${token}`)).status).toBe(404);
  });

  it('limit how fast one client can submit', async () => {
    const { token } = await setup();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      statuses.push(
        (await api(null, 'POST', `/forms/${token}`, { values: { name: { text: `r${i}` } } }))
          .status,
      );
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.slice(-2)).toEqual([429, 429]);
  });
});
