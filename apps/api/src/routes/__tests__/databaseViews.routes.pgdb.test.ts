/**
 * A view's layout against PostgreSQL, over HTTP: where it opens rows, its
 * columns' widths and order, its groups (a table's and a list's sections, a
 * board's sub-groups) paged without a group coming back, its footer
 * calculations over every row it shows, a chart view's points, and button
 * properties. `view-query.pgdb.test.ts` holds the SQL behind them to the JS.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { databaseViews, databases } from '../../db/schema/databases.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';

vi.mock('../../middleware/auth.js', () => ({
  oxyClient: {
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
  },
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
  log: {
    general: {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: (...args: unknown[]) => console.error('[route]', ...args),
    },
  },
}));

const { default: databasesRouter } = await import('../databases.js');
const { default: pagesRouter } = await import('../pages.js');

let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let previousUrl: string | undefined;
const EDITOR = 'views-editor';

type Json = Record<string, unknown>;
interface Row {
  id: string;
  title: string;
  groupKey?: string | null;
  properties: Json;
}
interface RowsBody {
  rows: Row[];
  total: number;
  cursor: string | null;
  groups?: { key: string | null; count: number }[];
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': EDITOR },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

const OPTIONS = [
  { id: 'todo', name: 'To do', color: 'gray' },
  { id: 'doing', name: 'Doing', color: 'blue' },
  { id: 'done', name: 'Done', color: 'green' },
];

/** A database of tasks: a select, labels, a number, a date, a checkbox. */
async function createDatabase(): Promise<string> {
  const created = await api('POST', '/databases', {
    workspaceId,
    name: 'Views',
    schema: {
      properties: [
        { id: 'name', name: 'Name', type: 'text' },
        { id: 'stage', name: 'Stage', type: 'select', config: { options: OPTIONS } },
        {
          id: 'tags',
          name: 'Tags',
          type: 'multi_select',
          config: {
            options: [
              { id: 'red', name: 'Red', color: 'red' },
              { id: 'blue', name: 'Blue', color: 'blue' },
            ],
          },
        },
        { id: 'points', name: 'Points', type: 'number' },
        { id: 'due', name: 'Due', type: 'date' },
        { id: 'done', name: 'Done', type: 'checkbox' },
        { id: 'notes', name: 'Notes', type: 'text' },
      ],
    },
  });
  expect(created.status).toBe(201);
  return (created.json.database as { id: string }).id;
}

async function addRow(databaseId: string, title: string, properties: Json = {}) {
  const res = await api('POST', `/databases/${databaseId}/rows`, { title, properties });
  expect(res.status).toBe(201);
  return (res.json.row as { id: string }).id;
}

async function createView(databaseId: string, body: Json) {
  const res = await api('POST', `/databases/${databaseId}/views`, { name: 'View', ...body });
  expect(res.status).toBe(201);
  return res.json.view as { id: string; config: Json; subGroupBy: unknown; groupBy: unknown };
}

/** Every page of a view's rows, walked through its cursor. */
async function allPages(databaseId: string, viewId: string, query = '') {
  const pages: RowsBody[] = [];
  let cursor: string | null = null;
  do {
    const res = await api(
      'GET',
      `/databases/${databaseId}/rows?viewId=${viewId}&pageSize=2${query}${
        cursor ? `&cursor=${cursor}` : ''
      }`,
    );
    expect(res.status).toBe(200);
    const page = res.json as unknown as RowsBody;
    pages.push(page);
    cursor = page.cursor;
  } while (cursor);
  return pages;
}

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: testScope('views'), ownerId: EDITOR })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db.insert(workspaceMembers).values({ workspaceId, userId: EDITOR, role: 'owner' });
  const app = express();
  app.use(express.json());
  app.use('/databases', databasesRouter);
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
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousUrl;
});

describe("a view's layout", () => {
  it('keeps where it opens rows, its column widths, its property order and its calculations', async () => {
    const databaseId = await createDatabase();
    const view = await createView(databaseId, {
      type: 'table',
      config: {
        openIn: 'center_peek',
        columnWidths: { name: 320, points: 90 },
        propertyOrder: ['points', 'stage', 'name'],
        calculations: { points: 'sum', stage: 'count_empty', done: 'percent_checked' },
      },
    });
    expect(view.config).toEqual({
      openIn: 'center_peek',
      columnWidths: { name: 320, points: 90 },
      propertyOrder: ['points', 'stage', 'name'],
      calculations: { points: 'sum', stage: 'count_empty', done: 'percent_checked' },
    });
    const [stored] = await db.select().from(databaseViews).where(eq(databaseViews.id, view.id));
    expect(stored.config.openIn).toBe('center_peek');
  });

  it('refuses a width out of bounds, an order naming a property twice and a calculation its type does not take', async () => {
    const databaseId = await createDatabase();
    const view = await createView(databaseId, { type: 'table' });
    const patch = (config: Json) =>
      api('PATCH', `/databases/${databaseId}/views/${view.id}`, { config });
    expect((await patch({ columnWidths: { points: 20 } })).status).toBe(400);
    expect((await patch({ columnWidths: { points: 5000 } })).status).toBe(400);
    expect((await patch({ propertyOrder: ['points', 'points'] })).status).toBe(400);
    expect((await patch({ openIn: 'somewhere' })).status).toBe(400);
    const sumOfText = await patch({ calculations: { notes: 'sum' } });
    expect(sumOfText.status).toBe(400);
    expect(sumOfText.json.code).toBe('INVALID_CALCULATION');
    expect((await patch({ calculations: { ghost: 'count_all' } })).json.code).toBe(
      'INVALID_CALCULATION',
    );
    expect((await patch({ calculations: { due: 'earliest', done: 'checked' } })).status).toBe(200);
  });

  it('forgets a removed property in its widths, order, calculations, sub-groups and chart', async () => {
    const databaseId = await createDatabase();
    const view = await createView(databaseId, {
      type: 'board',
      groupBy: { propertyId: 'stage' },
      subGroupBy: { propertyId: 'due', granularity: 'month' },
      config: {
        columnWidths: { due: 100, points: 120 },
        propertyOrder: ['due', 'points'],
        calculations: { due: 'latest', points: 'max' },
        chart: { type: 'line', xAxis: { propertyId: 'due' } },
      },
    });
    expect(view.subGroupBy).toEqual({ propertyId: 'due', granularity: 'month' });
    expect((await api('DELETE', `/databases/${databaseId}/properties/due`)).status).toBe(200);
    const [stored] = await db.select().from(databaseViews).where(eq(databaseViews.id, view.id));
    expect(stored.subGroupBy).toBeNull();
    expect(stored.groupBy).toEqual({ propertyId: 'stage' });
    expect(stored.config).toEqual({
      columnWidths: { points: 120 },
      propertyOrder: ['points'],
      calculations: { points: 'max' },
      chart: { type: 'line' },
    });
  });

  it('drops a calculation and a grouping the new type of their property does not take', async () => {
    const databaseId = await createDatabase();
    const view = await createView(databaseId, {
      type: 'table',
      groupBy: { propertyId: 'notes' },
      config: { calculations: { notes: 'count_unique', points: 'sum' } },
    });
    const retyped = await api('PATCH', `/databases/${databaseId}/properties/notes`, {
      type: 'number',
    });
    expect(retyped.status).toBe(200);
    let [stored] = await db.select().from(databaseViews).where(eq(databaseViews.id, view.id));
    // A number counts its unique values too, and no longer groups.
    expect(stored.config.calculations).toEqual({ notes: 'count_unique', points: 'sum' });
    expect(stored.groupBy).toBeNull();
    await api('PATCH', `/databases/${databaseId}/properties/points`, { type: 'checkbox' });
    [stored] = await db.select().from(databaseViews).where(eq(databaseViews.id, view.id));
    expect(stored.config.calculations).toEqual({ notes: 'count_unique' });
  });
});

describe('a grouped table', () => {
  it('pages its rows group by group, each group once, with every group counted', async () => {
    const databaseId = await createDatabase();
    for (const [title, stage] of [
      ['a', 'done'],
      ['b', 'todo'],
      ['c', null],
      ['d', 'done'],
      ['e', 'todo'],
      ['f', 'done'],
    ] as const) {
      await addRow(databaseId, title, stage ? { stage: { optionId: stage } } : {});
    }
    const view = await createView(databaseId, {
      type: 'table',
      groupBy: { propertyId: 'stage', hideEmpty: true },
      sorts: [{ propertyId: 'name', direction: 'desc' }],
    });
    expect(view.groupBy).toEqual({ propertyId: 'stage', hideEmpty: true });
    const pages = await allPages(databaseId, view.id);
    expect(pages.length).toBe(3);
    const entries = pages.flatMap((p) => p.rows.map((r) => [r.groupKey, r.title]));
    // Options as listed, the rows in each by the view's sort, the empty group last.
    expect(entries).toEqual([
      ['todo', 'e'],
      ['todo', 'b'],
      ['done', 'f'],
      ['done', 'd'],
      ['done', 'a'],
      [null, 'c'],
    ]);
    for (const page of pages) {
      expect(page.total).toBe(6);
      expect(page.groups).toEqual([
        { key: 'todo', count: 2 },
        { key: 'doing', count: 0 },
        { key: 'done', count: 3 },
        { key: null, count: 1 },
      ]);
    }
  });

  it('lists a row with two labels in both their groups, and groups dates by month in the reader’s zone', async () => {
    const databaseId = await createDatabase();
    await addRow(databaseId, 'both', { tags: { optionIds: ['red', 'blue'] } });
    await addRow(databaseId, 'none');
    // 23:30 UTC on Jan 31 is already February in Tokyo.
    await addRow(databaseId, 'late', {
      due: { start: '2026-01-31T23:30:00.000Z', includeTime: true },
    });
    await addRow(databaseId, 'day', { due: { start: '2026-01-31T00:00:00.000Z' } });
    const byTags = await createView(databaseId, { type: 'list', groupBy: { propertyId: 'tags' } });
    const tagged = (await allPages(databaseId, byTags.id)).flatMap((p) =>
      p.rows.map((r) => [r.groupKey, r.title]),
    );
    expect(tagged).toEqual([
      ['red', 'both'],
      ['blue', 'both'],
      [null, 'none'],
      [null, 'late'],
      [null, 'day'],
    ]);

    const byMonth = await createView(databaseId, {
      type: 'table',
      groupBy: { propertyId: 'due', granularity: 'month' },
    });
    const months = async (zone: string) =>
      (await allPages(databaseId, byMonth.id, `&timeZone=${zone}`)).flatMap((p) =>
        p.rows.map((r) => [r.groupKey, r.title]),
      );
    expect(await months('UTC')).toEqual([
      ['2026-01-01', 'late'],
      ['2026-01-01', 'day'],
      [null, 'both'],
      [null, 'none'],
    ]);
    expect(await months('Asia/Tokyo')).toEqual([
      ['2026-01-01', 'day'],
      ['2026-02-01', 'late'],
      [null, 'both'],
      [null, 'none'],
    ]);
    const unknown = await api(
      'GET',
      `/databases/${databaseId}/rows?viewId=${byMonth.id}&timeZone=Mars/Olympus`,
    );
    expect(unknown.status).toBe(400);
  });

  it('sub-groups a board, and refuses a grouping by a property that has no groups', async () => {
    const databaseId = await createDatabase();
    await addRow(databaseId, 'x', { stage: { optionId: 'todo' }, done: { checked: true } });
    await addRow(databaseId, 'y', { stage: { optionId: 'done' } });
    const board = await createView(databaseId, {
      type: 'board',
      groupBy: { propertyId: 'stage' },
      subGroupBy: { propertyId: 'done' },
    });
    const [page] = await allPages(databaseId, board.id);
    expect(page?.rows.map((r) => [r.groupKey, r.title])).toEqual([
      ['true', 'x'],
      ['false', 'y'],
    ]);
    expect(page?.groups).toEqual([
      { key: 'true', count: 1 },
      { key: 'false', count: 1 },
    ]);
    const refused = await api('PATCH', `/databases/${databaseId}/views/${board.id}`, {
      subGroupBy: { propertyId: 'points' },
    });
    expect(refused.status).toBe(400);
    expect(refused.json.code).toBe('INVALID_GROUP');
  });
});

describe('calculations', () => {
  it('are computed over every row the view shows, not only the page loaded', async () => {
    const databaseId = await createDatabase();
    for (const [title, points, done, due] of [
      ['a', 1, true, '2026-03-01T00:00:00.000Z'],
      ['b', 2, false, '2026-03-05T00:00:00.000Z'],
      ['c', 4, true, null],
      ['d', null, false, '2026-03-03T00:00:00.000Z'],
      ['skip', 100, true, null],
    ] as const) {
      await addRow(databaseId, title, {
        ...(points !== null && { points: { number: points } }),
        done: { checked: done },
        ...(due && { due: { start: due } }),
      });
    }
    const view = await createView(databaseId, {
      type: 'table',
      pageSize: 1,
      filters: {
        kind: 'group',
        combinator: 'and',
        filters: [
          { kind: 'condition', propertyId: 'name', operator: 'does_not_equal', value: 'skip' },
        ],
      },
      config: {
        calculations: {
          points: 'sum',
          done: 'percent_checked',
          due: 'date_range',
          name: 'count_all',
          stage: 'percent_empty',
        },
      },
    });
    const res = await api('GET', `/databases/${databaseId}/views/${view.id}/calculations`);
    expect(res.status).toBe(200);
    expect(res.json.calculations).toEqual({
      points: { function: 'sum', value: 7 },
      done: { function: 'percent_checked', value: 50 },
      due: { function: 'date_range', value: 4 * 86_400_000 },
      name: { function: 'count_all', value: 4 },
      stage: { function: 'percent_empty', value: 100 },
    });
    const searched = await api(
      'GET',
      `/databases/${databaseId}/views/${view.id}/calculations?search=b`,
    );
    expect((searched.json.calculations as Json).points).toEqual({ function: 'sum', value: 2 });
  });

  it('count a formula’s empty values in JS', async () => {
    const databaseId = await createDatabase();
    await api('POST', `/databases/${databaseId}/properties`, {
      id: 'double',
      name: 'Double',
      type: 'formula',
      config: { expression: 'prop("Points") * 2' },
    });
    await addRow(databaseId, 'a', { points: { number: 3 } });
    await addRow(databaseId, 'b');
    const view = await createView(databaseId, {
      type: 'table',
      config: { calculations: { double: 'sum', points: 'average' } },
    });
    const res = await api('GET', `/databases/${databaseId}/views/${view.id}/calculations`);
    expect(res.json.calculations).toEqual({
      double: { function: 'sum', value: 6 },
      points: { function: 'average', value: 3 },
    });
  });
});

describe('a chart view', () => {
  it('starts on the first select, counts, sums and averages its groups in their order', async () => {
    const databaseId = await createDatabase();
    for (const [stage, points] of [
      ['done', 3],
      ['done', 5],
      ['todo', 1],
      [null, 10],
    ] as const) {
      await addRow(databaseId, 'r', {
        ...(stage && { stage: { optionId: stage } }),
        points: { number: points },
      });
    }
    const chart = await createView(databaseId, { type: 'chart' });
    expect(chart.config.chart).toEqual({ type: 'bar', xAxis: { propertyId: 'stage' } });
    const points = async () =>
      (await api('GET', `/databases/${databaseId}/views/${chart.id}/chart`)).json.points;
    expect(await points()).toEqual([
      { key: 'todo', count: 1, value: 1 },
      { key: 'doing', count: 0, value: 0 },
      { key: 'done', count: 2, value: 2 },
      { key: null, count: 1, value: 1 },
    ]);
    await api('PATCH', `/databases/${databaseId}/views/${chart.id}`, {
      config: {
        chart: {
          type: 'donut',
          xAxis: { propertyId: 'stage' },
          yAxis: { aggregate: 'sum', propertyId: 'points' },
        },
      },
    });
    expect((await points()) as unknown[]).toEqual([
      { key: 'todo', count: 1, value: 1 },
      { key: 'doing', count: 0, value: 0 },
      { key: 'done', count: 2, value: 8 },
      { key: null, count: 1, value: 10 },
    ]);
    await api('PATCH', `/databases/${databaseId}/views/${chart.id}`, {
      config: {
        chart: {
          type: 'line',
          xAxis: { propertyId: 'stage' },
          yAxis: { aggregate: 'average', propertyId: 'points' },
        },
      },
    });
    expect(((await points()) as { value: unknown }[]).map((p) => p.value)).toEqual([
      1,
      null,
      4,
      10,
    ]);
    const bad = await api('PATCH', `/databases/${databaseId}/views/${chart.id}`, {
      config: {
        chart: {
          type: 'bar',
          xAxis: { propertyId: 'stage' },
          yAxis: { aggregate: 'sum', propertyId: 'notes' },
        },
      },
    });
    expect(bad.json.code).toBe('INVALID_CHART');
  });
});

describe('a button property', () => {
  it('keeps its actions, refuses one that sets what its row cannot hold, and holds no value', async () => {
    const databaseId = await createDatabase();
    const added = await api('POST', `/databases/${databaseId}/properties`, {
      id: 'finish',
      name: 'Finish',
      type: 'button',
      config: {
        actions: [
          { kind: 'set_property', propertyId: 'done', value: { checked: true } },
          { kind: 'open_url', url: 'https://example.test/done' },
          { kind: 'create_row', title: 'Follow-up' },
        ],
      },
    });
    expect(added.status).toBe(201);
    const [stored] = await db.select().from(databases).where(eq(databases.id, databaseId));
    expect(
      stored.propertiesSchema.properties.find((p) => p.id === 'finish')?.config?.actions,
    ).toHaveLength(3);

    const wrongShape = await api('PATCH', `/databases/${databaseId}/properties/finish`, {
      config: { actions: [{ kind: 'set_property', propertyId: 'done', value: { text: 'yes' } }] },
    });
    expect(wrongShape.json.code).toBe('INVALID_BUTTON_ACTION');
    const script = await api('PATCH', `/databases/${databaseId}/properties/finish`, {
      config: { actions: [{ kind: 'open_url', url: 'javascript:alert(1)' }] },
    });
    expect(script.status).toBe(400);

    const rowId = await addRow(databaseId, 'task');
    const written = await api('PATCH', `/pages/${rowId}`, {
      properties: { finish: { checked: true } },
    });
    expect(written.status).toBe(400);
    expect(written.json.code).toBe('COMPUTED_PROPERTY');

    // Removing the property it sets drops that action, the others stay.
    await api('DELETE', `/databases/${databaseId}/properties/done`);
    const [after] = await db.select().from(databases).where(eq(databases.id, databaseId));
    expect(
      after.propertiesSchema.properties
        .find((p) => p.id === 'finish')
        ?.config?.actions?.map((a) => a.kind),
    ).toEqual(['open_url', 'create_row']);
  });
});
