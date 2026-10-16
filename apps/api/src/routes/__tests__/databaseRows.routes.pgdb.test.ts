/**
 * `GET /databases/:id/rows` against PostgreSQL: pages walked through the
 * opaque cursor, `total`, page sizes, a row archived between two pages, a
 * cursor that is not one the API issued, and a view on a formula, which is
 * still filtered and sorted in JS. That the SQL agrees with the JS path value
 * for value is `lib/databases/view-query.pgdb.test.ts`'s.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { and, eq } from 'drizzle-orm';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { pages } from '../../db/schema/pages.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';

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
}));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: databasesRouter } = await import('../databases.js');

let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let previousUrl: string | undefined;
const EDITOR = 'rows-editor';

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': EDITOR },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

interface RowsPage {
  rows: { id: string; title: string; properties: Record<string, unknown> }[];
  total: number;
  cursor: string | null;
}

async function rows(databaseId: string, params: Record<string, string>) {
  const res = await api('GET', `/databases/${databaseId}/rows?${new URLSearchParams(params)}`);
  return { status: res.status, page: res.json as unknown as RowsPage };
}

/** Every page of a view, through the cursor. */
async function walk(databaseId: string, params: Record<string, string>) {
  const titles: string[] = [];
  const totals = new Set<number>();
  let cursor: string | null = null;
  do {
    const { status, page } = await rows(databaseId, { ...params, ...(cursor && { cursor }) });
    expect(status).toBe(200);
    titles.push(...page.rows.map((r) => r.title));
    totals.add(page.total);
    cursor = page.cursor;
  } while (cursor);
  return { titles, totals: [...totals] };
}

/** A database of `count` rows: "row 1".."row N", points N..1, even ones done. */
async function setup(count: number) {
  const created = await api('POST', '/databases', {
    workspaceId,
    name: 'Rows',
    schema: {
      properties: [
        { id: 'name', name: 'Name', type: 'text' },
        { id: 'points', name: 'Points', type: 'number' },
        { id: 'done', name: 'Done', type: 'checkbox' },
        {
          id: 'double',
          name: 'Double',
          type: 'formula',
          config: { expression: 'prop("Points") * 2' },
        },
      ],
    },
  });
  expect(created.status).toBe(201);
  const databaseId = (created.json.database as { id: string }).id;
  for (let i = 1; i <= count; i += 1) {
    const row = await api('POST', `/databases/${databaseId}/rows`, {
      title: `row ${i}`,
      properties: { points: { number: count + 1 - i }, done: { checked: i % 2 === 0 } },
    });
    expect(row.status).toBe(201);
  }
  return databaseId;
}

async function view(databaseId: string, body: Record<string, unknown>) {
  const res = await api('POST', `/databases/${databaseId}/views`, {
    name: 'View',
    type: 'table',
    ...body,
  });
  expect(res.status).toBe(201);
  return (res.json.view as { id: string }).id;
}

const titles = (numbers: number[]) => numbers.map((n) => `row ${n}`);
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: testScope('rows'), ownerId: EDITOR })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db.insert(workspaceMembers).values({ workspaceId, userId: EDITOR, role: 'owner' });
  const app = express();
  app.use(express.json());
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

describe('GET /databases/:id/rows', () => {
  it('pages a sorted, filtered view through its cursor, with its total on every page', async () => {
    const databaseId = await setup(30);
    const viewId = await view(databaseId, {
      sorts: [{ propertyId: 'points', direction: 'asc' }],
      filters: {
        kind: 'group',
        combinator: 'and',
        filters: [{ kind: 'condition', propertyId: 'done', operator: 'is', value: true }],
      },
    });
    // Points ascending is rows descending; only the even rows are done.
    const want = titles(range(1, 15).map((n) => 32 - 2 * n));
    for (const pageSize of ['1', '4', '15', '500']) {
      expect(await walk(databaseId, { viewId, pageSize })).toEqual({ titles: want, totals: [15] });
    }
    const searched = await walk(databaseId, { viewId, pageSize: '2', search: 'ROW 2' });
    expect(searched).toEqual({ titles: titles([28, 26, 24, 22, 20, 2]), totals: [6] });
  });

  it('keeps page sizes between 1 and 500, the view’s own by default', async () => {
    const databaseId = await setup(3);
    const viewId = await view(databaseId, { pageSize: 2 });
    expect((await rows(databaseId, { viewId })).page.rows).toHaveLength(2);
    expect((await rows(databaseId, { viewId, pageSize: '0' })).page.rows).toHaveLength(1);
    const all = await rows(databaseId, { viewId, pageSize: '100000' });
    expect(all.page.rows.map((r) => r.title)).toEqual(titles([1, 2, 3]));
    expect(all.page.cursor).toBeNull();
  });

  it('carries on after a row archived between two pages', async () => {
    const databaseId = await setup(10);
    const viewId = await view(databaseId, { sorts: [{ propertyId: 'points', direction: 'desc' }] });
    const first = await rows(databaseId, { viewId, pageSize: '4' });
    expect(first.page.rows.map((r) => r.title)).toEqual(titles([1, 2, 3, 4]));
    // The row the cursor points after, and the one that would have come next.
    for (const title of ['row 4', 'row 5']) {
      await db
        .update(pages)
        .set({ archived: true })
        .where(and(eq(pages.databaseId, databaseId), eq(pages.title, title)));
    }
    const second = await rows(databaseId, {
      viewId,
      pageSize: '4',
      cursor: first.page.cursor as string,
    });
    expect(second.status).toBe(200);
    expect(second.page.rows.map((r) => r.title)).toEqual(titles([6, 7, 8, 9]));
    expect(second.page.total).toBe(8);
  });

  it('refuses a cursor it did not issue', async () => {
    const databaseId = await setup(3);
    const sorted = await view(databaseId, { sorts: [{ propertyId: 'points', direction: 'asc' }] });
    const computed = await view(databaseId, {
      sorts: [{ propertyId: 'double', direction: 'asc' }],
    });
    const issued = (await rows(databaseId, { viewId: sorted, pageSize: '1' })).page
      .cursor as string;
    const offset = (await rows(databaseId, { viewId: computed, pageSize: '1' })).page
      .cursor as string;
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const decoded = JSON.parse(Buffer.from(issued, 'base64url').toString()) as {
      after: unknown[];
      at: string;
      id: string;
    };
    const refused = [
      '50',
      'not a cursor!',
      encode('a string'),
      encode({ offset: -1 }),
      encode({ offset: 1, extra: true }),
      encode({ ...decoded, after: [] }),
      encode({ ...decoded, after: ['3'] }),
      encode({ ...decoded, after: [1, 2] }),
      encode({ ...decoded, at: '2026-02-30T00:00:00.000000Z' }),
      encode({ ...decoded, at: "2026-01-01'; drop table pages; --" }),
      encode({ ...decoded, id: 'not-an-id' }),
      encode({ row: decoded.id.replace(/.$/u, (c) => (c === '0' ? '1' : '0')) }),
      'x'.repeat(3000),
      // A position in a view sorted in SQL is not one in a view sorted in JS, and the other way round.
      offset,
    ];
    for (const cursor of refused) {
      const res = await rows(databaseId, { viewId: sorted, cursor });
      expect(res.status, cursor).toBe(400);
    }
    expect((await rows(databaseId, { viewId: computed, cursor: issued })).status).toBe(400);
    expect((await rows(databaseId, { viewId: sorted, cursor: issued })).status).toBe(200);
  });

  it('still filters and sorts a view on a formula in JS, paged the same way', async () => {
    const databaseId = await setup(12);
    const viewId = await view(databaseId, {
      sorts: [{ propertyId: 'double', direction: 'asc' }],
      filters: {
        kind: 'group',
        combinator: 'and',
        filters: [{ kind: 'condition', propertyId: 'done', operator: 'is', value: false }],
      },
    });
    const walked = await walk(databaseId, { viewId, pageSize: '4' });
    expect(walked).toEqual({ titles: titles([11, 9, 7, 5, 3, 1]), totals: [6] });
    const first = await rows(databaseId, { viewId, pageSize: '1' });
    expect(first.page.rows[0]?.properties.double).toEqual({ number: 4 });
  });
});
