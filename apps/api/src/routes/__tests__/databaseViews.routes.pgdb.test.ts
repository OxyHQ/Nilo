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
  it('persists board column order and rejects ambiguous duplicate columns', async () => {
    const databaseId = await createDatabase();
    const view = await createView(databaseId, { type: 'board', groupBy: { propertyId: 'stage' } });
    const config = { boardColumnOrder: { propertyId: 'stage', columnIds: ['done', 'todo'] } };
    const path = `/databases/${databaseId}/views/${view.id}`;
    expect((await api('PATCH', path, { config })).status).toBe(200);
    const [stored] = await db.select().from(databaseViews).where(eq(databaseViews.id, view.id));
    expect(stored.config).toMatchObject(config);
    expect(
      (
        await api('PATCH', path, {
          config: { boardColumnOrder: { propertyId: 'stage', columnIds: ['todo', 'todo'] } },
        })
      ).status,
    ).toBe(400);
    await api('DELETE', `/databases/${databaseId}/properties/stage`);
    const [removed] = await db.select().from(databaseViews).where(eq(databaseViews.id, view.id));
    expect(removed.config.boardColumnOrder).toBeUndefined();
  });

  it.each(['board', 'gallery'])(
    'persists %s card layout and rejects unsupported sizes',
    async (type) => {
      const databaseId = await createDatabase();
      const config = { cardSize: 'large', coverSource: 'pageCover', fit: 'contain' };
      const view = await createView(databaseId, { type, config });
      const [stored] = await db.select().from(databaseViews).where(eq(databaseViews.id, view.id));
      expect(stored.config).toMatchObject(config);
      const changed = await api('PATCH', `/databases/${databaseId}/views/${view.id}`, {
        config: { cardSize: 'small', coverSource: 'none' },
      });
      expect(changed.status).toBe(200);
      const [updated] = await db.select().from(databaseViews).where(eq(databaseViews.id, view.id));
      expect(updated.config).toMatchObject({ cardSize: 'small', coverSource: 'none' });
      const invalid = await api('PATCH', `/databases/${databaseId}/views/${view.id}`, {
        config: { cardSize: 'giant' },
      });
      expect(invalid.status).toBe(400);
    },
  );

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
      config: {
        calculations: { notes: 'count_unique', points: 'sum' },
        groupOrder: ['b', null],
        collapsedGroups: ['a'],
        hiddenGroups: ['c'],
      },
    });
    const retyped = await api('PATCH', `/databases/${databaseId}/properties/notes`, {
      type: 'number',
    });
    expect(retyped.status).toBe(200);
    let [stored] = await db.select().from(databaseViews).where(eq(databaseViews.id, view.id));
    // A number counts its unique values too, and groups by ranges: the texts' groups go.
    expect(stored.config).toEqual({ calculations: { notes: 'count_unique', points: 'sum' } });
    expect(stored.groupBy).toEqual({ propertyId: 'notes' });
    await api('PATCH', `/databases/${databaseId}/properties/notes`, { type: 'files' });
    [stored] = await db.select().from(databaseViews).where(eq(databaseViews.id, view.id));
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

  it('groups board columns by relations without enabling relation grouping for other layouts or lanes', async () => {
    const databaseId = await createDatabase();
    const targetDatabaseId = await createDatabase();
    const property = await api('POST', `/databases/${databaseId}/properties`, {
      id: 'project',
      name: 'Project',
      type: 'relation',
      config: { targetDatabaseId },
    });
    expect(property.status).toBe(201);
    const board = await createView(databaseId, {
      type: 'board',
      groupBy: { propertyId: 'project' },
    });
    const path = `/databases/${databaseId}/views/${board.id}`;
    expect((await api('PATCH', path, { config: { cardSize: 'large' } })).status).toBe(200);
    expect((await api('PATCH', path, { groupBy: { propertyId: 'tags' } })).status).toBe(200);
    expect((await api('PATCH', path, { groupBy: { propertyId: 'project' } })).status).toBe(200);
    for (const body of [{ type: 'table' }, { subGroupBy: { propertyId: 'project' } }]) {
      const refused = await api('PATCH', path, body);
      expect(refused.status).toBe(400);
      expect(refused.json.code).toBe('INVALID_GROUP');
    }
    expect((await api('PATCH', path, { type: 'table', groupBy: null })).status).toBe(200);
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
    await api('POST', `/databases/${databaseId}/properties`, {
      id: 'files',
      name: 'Files',
      type: 'files',
    });
    const refused = await api('PATCH', `/databases/${databaseId}/views/${board.id}`, {
      subGroupBy: { propertyId: 'files' },
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

describe("a view's groups", () => {
  /** The rows of a grouped view as `[groupKey, title]`, every page walked. */
  const entries = async (databaseId: string, viewId: string, query = '') =>
    (await allPages(databaseId, viewId, query)).flatMap((p) =>
      p.rows.map((r) => [r.groupKey, r.title]),
    );

  it('groups numbers by the ranges a view sets, or by round ones spanning its rows', async () => {
    const databaseId = await createDatabase();
    for (const [title, points] of [
      ['low', -2],
      ['one', 1],
      ['four', 4.5],
      ['ten', 10],
      ['top', 25],
      ['none', null],
    ] as const) {
      await addRow(databaseId, title, points === null ? {} : { points: { number: points } });
    }
    const view = await createView(databaseId, {
      type: 'table',
      groupBy: { propertyId: 'points' },
      config: { numberGrouping: { from: 0, to: 20, step: 5 } },
    });
    expect(await entries(databaseId, view.id)).toEqual([
      ['-1', 'low'],
      ['0', 'one'],
      ['0', 'four'],
      ['2', 'ten'],
      ['4', 'top'],
      [null, 'none'],
    ]);
    const [page] = await allPages(databaseId, view.id);
    // Every range, even one no row is in, lowest first; below and above apart, the empty last.
    expect(page?.groups).toEqual([
      { key: '-1', count: 1, range: { from: null, to: 0 } },
      { key: '0', count: 2, range: { from: 0, to: 5 } },
      { key: '1', count: 0, range: { from: 5, to: 10 } },
      { key: '2', count: 1, range: { from: 10, to: 15 } },
      { key: '3', count: 0, range: { from: 15, to: 20 } },
      { key: '4', count: 1, range: { from: 20, to: null } },
      { key: null, count: 1 },
    ]);

    // Without ranges: steps of 5 from -5, past the largest number.
    await api('PATCH', `/databases/${databaseId}/views/${view.id}`, { config: {} });
    const [plain] = await allPages(databaseId, view.id);
    expect(plain?.groups?.map((g) => [g.key, g.count])).toEqual([
      ['0', 1],
      ['1', 2],
      ['2', 0],
      ['3', 1],
      ['4', 0],
      ['5', 0],
      ['6', 1],
      [null, 1],
    ]);
    expect(plain?.groups?.[0]).toEqual({ key: '0', count: 1, range: { from: -5, to: 0 } });

    for (const numberGrouping of [
      { from: 5, to: 5, step: 1 },
      { from: 0, to: 1000, step: 1 },
      { from: 0, to: 10, step: 0 },
    ]) {
      const refused = await api('PATCH', `/databases/${databaseId}/views/${view.id}`, {
        config: { numberGrouping },
      });
      expect(refused.status).toBe(400);
    }
  });

  it('groups a formula’s numbers in JS, as the stored ones', async () => {
    const databaseId = await createDatabase();
    await api('POST', `/databases/${databaseId}/properties`, {
      id: 'double',
      name: 'Double',
      type: 'formula',
      config: { expression: 'prop("Points") * 2' },
    });
    await addRow(databaseId, 'a', { points: { number: 1 } });
    await addRow(databaseId, 'b', { points: { number: 4 } });
    await addRow(databaseId, 'c');
    const view = await createView(databaseId, {
      type: 'list',
      groupBy: { propertyId: 'double' },
      config: { numberGrouping: { from: 0, to: 10, step: 5 }, calculations: { points: 'sum' } },
    });
    // No points doubles to 0.
    expect(await entries(databaseId, view.id)).toEqual([
      ['0', 'a'],
      ['0', 'c'],
      ['1', 'b'],
    ]);
    const calculated = await api('GET', `/databases/${databaseId}/views/${view.id}/calculations`);
    expect(calculated.json.groups).toEqual([
      { key: '0', calculations: { points: { function: 'sum', value: 1 } } },
      { key: '1', calculations: { points: { function: 'sum', value: 4 } } },
    ]);
  });

  it('orders the groups a view lists first, and leaves out the rows of those it hides', async () => {
    const databaseId = await createDatabase();
    await addRow(databaseId, 'a', { stage: { optionId: 'todo' }, tags: { optionIds: ['red'] } });
    await addRow(databaseId, 'b', {
      stage: { optionId: 'done' },
      tags: { optionIds: ['red', 'blue'] },
    });
    await addRow(databaseId, 'c', { tags: { optionIds: ['blue'] } });
    const view = await createView(databaseId, {
      type: 'table',
      groupBy: { propertyId: 'stage' },
      config: { groupOrder: [null, 'done'], hiddenGroups: ['todo'], collapsedGroups: ['done'] },
    });
    expect(view.config.collapsedGroups).toEqual(['done']);
    const pages = await allPages(databaseId, view.id);
    expect(pages.flatMap((p) => p.rows.map((r) => [r.groupKey, r.title]))).toEqual([
      [null, 'c'],
      ['done', 'b'],
    ]);
    expect(pages[0]?.total).toBe(2);
    expect(pages[0]?.groups).toEqual([
      { key: null, count: 1 },
      { key: 'done', count: 1 },
      { key: 'doing', count: 0 },
    ]);

    // A row with two labels is shown while one of its groups is.
    await api('PATCH', `/databases/${databaseId}/views/${view.id}`, {
      groupBy: { propertyId: 'tags' },
      config: { hiddenGroups: ['red'], calculations: { name: 'count_all' } },
    });
    const tagged = await allPages(databaseId, view.id);
    expect(tagged.flatMap((p) => p.rows.map((r) => [r.groupKey, r.title]))).toEqual([
      ['blue', 'b'],
      ['blue', 'c'],
    ]);
    expect(tagged[0]?.total).toBe(2);
    const calculated = await api('GET', `/databases/${databaseId}/views/${view.id}/calculations`);
    expect(calculated.json.calculations).toEqual({ name: { function: 'count_all', value: 2 } });
    expect(calculated.json.groups).toEqual([
      { key: 'blue', calculations: { name: { function: 'count_all', value: 2 } } },
    ]);

    for (const config of [
      { groupOrder: ['a', 'a'] },
      { hiddenGroups: [null, null] },
      { collapsedGroups: [3] },
    ]) {
      const refused = await api('PATCH', `/databases/${databaseId}/views/${view.id}`, { config });
      expect(refused.status).toBe(400);
    }
  });

  it('computes each group’s footer, every group in its order, an empty one to nothing', async () => {
    const databaseId = await createDatabase();
    for (const [stage, points, due] of [
      ['todo', 1, '2026-03-01T00:00:00.000Z'],
      ['todo', 2, '2026-03-04T00:00:00.000Z'],
      ['done', 4, null],
      [null, 8, null],
    ] as const) {
      await addRow(databaseId, 'r', {
        ...(stage && { stage: { optionId: stage } }),
        points: { number: points },
        ...(due && { due: { start: due } }),
      });
    }
    const view = await createView(databaseId, {
      type: 'table',
      groupBy: { propertyId: 'stage' },
      config: { calculations: { points: 'sum', due: 'date_range', stage: 'percent_empty' } },
    });
    const res = await api('GET', `/databases/${databaseId}/views/${view.id}/calculations`);
    expect(res.status).toBe(200);
    expect(res.json.calculations).toEqual({
      points: { function: 'sum', value: 15 },
      due: { function: 'date_range', value: 3 * 86_400_000 },
      stage: { function: 'percent_empty', value: 25 },
    });
    const sums = (res.json.groups as { key: string | null; calculations: Json }[]).map((g) => [
      g.key,
      (g.calculations.points as { value: number }).value,
      (g.calculations.due as { value: number | null }).value,
      (g.calculations.stage as { value: number | null }).value,
    ]);
    expect(sums).toEqual([
      ['todo', 3, 3 * 86_400_000, 0],
      ['doing', 0, null, null],
      ['done', 4, null, 0],
      [null, 8, null, 100],
    ]);
    // Ungrouped, the footer is the view's alone.
    await api('PATCH', `/databases/${databaseId}/views/${view.id}`, { groupBy: null });
    const ungrouped = await api('GET', `/databases/${databaseId}/views/${view.id}/calculations`);
    expect(ungrouped.json.groups).toBeUndefined();
  });

  it('groups a gallery’s cards and a timeline’s lanes, but not a calendar', async () => {
    const databaseId = await createDatabase();
    await addRow(databaseId, 'x', {
      stage: { optionId: 'done' },
      due: { start: '2026-03-01T00:00:00.000Z' },
    });
    await addRow(databaseId, 'y', { due: { start: '2026-03-02T00:00:00.000Z' } });
    for (const type of ['gallery', 'timeline']) {
      const view = await createView(databaseId, { type, groupBy: { propertyId: 'stage' } });
      expect(await entries(databaseId, view.id)).toEqual([
        ['done', 'x'],
        [null, 'y'],
      ]);
    }
    const calendar = await createView(databaseId, {
      type: 'calendar',
      groupBy: { propertyId: 'stage' },
    });
    const [page] = await allPages(databaseId, calendar.id);
    expect(page?.groups).toBeUndefined();
    expect(page?.rows.every((r) => r.groupKey === undefined)).toBe(true);
  });

  it('charts numbers by ranges spanning its rows', async () => {
    const databaseId = await createDatabase();
    for (const points of [1, 3, 12]) await addRow(databaseId, 'r', { points: { number: points } });
    const chart = await createView(databaseId, {
      type: 'chart',
      config: { chart: { type: 'bar', xAxis: { propertyId: 'points' } } },
    });
    const res = await api('GET', `/databases/${databaseId}/views/${chart.id}/chart`);
    expect((res.json.points as unknown[]).slice(0, 2)).toEqual([
      { key: '0', count: 1, value: 1, range: { from: 0, to: 2 } },
      { key: '1', count: 1, value: 1, range: { from: 2, to: 4 } },
    ]);
  });

  it('forgets its groups’ keys with their property, or grouped by another', async () => {
    const databaseId = await createDatabase();
    const keys = {
      groupOrder: ['done'],
      collapsedGroups: [null],
      hiddenGroups: ['todo'],
      numberGrouping: { from: 0, to: 10, step: 1 },
    };
    const table = await createView(databaseId, {
      type: 'table',
      groupBy: { propertyId: 'stage' },
      config: { ...keys, openIn: 'full_page' },
    });
    // A board's keys are of its sub-groups, not its columns.
    const board = await createView(databaseId, {
      type: 'board',
      groupBy: { propertyId: 'stage' },
      subGroupBy: { propertyId: 'done' },
      config: keys,
    });
    expect((await api('DELETE', `/databases/${databaseId}/properties/stage`)).status).toBe(200);
    const stored = async (id: string) =>
      (await db.select().from(databaseViews).where(eq(databaseViews.id, id)))[0];
    expect((await stored(table.id))?.config).toEqual({ openIn: 'full_page' });
    expect((await stored(board.id))?.config).toEqual(keys);

    // Grouped by another property, its keys go; given with the grouping, they are kept.
    await api('PATCH', `/databases/${databaseId}/views/${board.id}`, {
      subGroupBy: { propertyId: 'tags' },
    });
    expect((await stored(board.id))?.config).toEqual({});
    await api('PATCH', `/databases/${databaseId}/views/${board.id}`, {
      subGroupBy: { propertyId: 'done' },
      config: { hiddenGroups: ['true'] },
    });
    expect((await stored(board.id))?.config).toEqual({ hiddenGroups: ['true'] });
  });
});
