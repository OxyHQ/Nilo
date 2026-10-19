/**
 * A database's settings against PostgreSQL: locking it, ordering its
 * properties, changing a property's type (what becomes of the rows' values
 * and the views' filters on it), status groups, the rollup functions that
 * list or measure the related values, and the setup a new view starts with.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
const EDITOR = 'settings-editor';

type Json = Record<string, unknown>;
interface Property {
  id: string;
  name: string;
  type: string;
  config?: Json & {
    options?: { id: string; name: string }[];
    groups?: { id: string; optionIds: string[] }[];
  };
}
interface DatabaseBody {
  id: string;
  locked: boolean;
  schema: { properties: Property[] };
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': EDITOR },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function createDatabase(properties?: Property[]): Promise<string> {
  const created = await api('POST', '/databases', {
    workspaceId,
    name: 'Settings',
    ...(properties && { schema: { properties } }),
  });
  expect(created.status).toBe(201);
  return (created.json.database as DatabaseBody).id;
}

async function getDatabase(id: string): Promise<DatabaseBody> {
  const res = await api('GET', `/databases/${id}`);
  expect(res.status).toBe(200);
  return res.json.database as DatabaseBody;
}

async function addRow(databaseId: string, title: string, properties: Json = {}) {
  const res = await api('POST', `/databases/${databaseId}/rows`, { title, properties });
  expect(res.status).toBe(201);
  return (res.json.row as { id: string }).id;
}

/** Every row's stored value of `propertyId`, by title. */
async function stored(databaseId: string, propertyId: string) {
  const rows = await db
    .select({ title: pages.title, properties: pages.properties })
    .from(pages)
    .where(eq(pages.databaseId, databaseId));
  return Object.fromEntries(rows.map((r) => [r.title, r.properties[propertyId] ?? null]));
}

async function listRows(databaseId: string, viewId?: string) {
  const res = await api('GET', `/databases/${databaseId}/rows${viewId ? `?viewId=${viewId}` : ''}`);
  expect(res.status).toBe(200);
  return res.json.rows as { id: string; title: string; properties: Json }[];
}

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: testScope('settings'), ownerId: EDITOR })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db.insert(workspaceMembers).values({ workspaceId, userId: EDITOR, role: 'owner' });
  const app = express();
  app.use(express.json());
  app.use('/databases', databasesRouter);
  // Row edits go through the page route.
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

describe('a locked database', () => {
  it('refuses changes to its properties and views until unlocked, and its rows stay editable', async () => {
    const databaseId = await createDatabase();
    const views = (await api('GET', `/databases/${databaseId}/views`)).json.views as {
      id: string;
    }[];
    const second = await api('POST', `/databases/${databaseId}/views`, {
      name: 'Second',
      type: 'table',
    });
    const secondId = (second.json.view as { id: string }).id;

    const locked = await api('PATCH', `/databases/${databaseId}`, { locked: true });
    expect(locked.status).toBe(200);
    expect((locked.json.database as DatabaseBody).locked).toBe(true);
    const before = await getDatabase(databaseId);

    const refused = [
      await api('POST', `/databases/${databaseId}/properties`, { name: 'N', type: 'number' }),
      await api('PATCH', `/databases/${databaseId}/properties/status`, { name: 'Stage' }),
      await api('DELETE', `/databases/${databaseId}/properties/status`),
      await api('PUT', `/databases/${databaseId}/properties/order`, { ids: ['status', 'name'] }),
      await api('POST', `/databases/${databaseId}/views`, { name: 'Board', type: 'board' }),
      await api('PATCH', `/databases/${databaseId}/views/${views[0].id}`, { name: 'Renamed' }),
      await api('DELETE', `/databases/${databaseId}/views/${secondId}`),
    ];
    for (const res of refused) {
      expect(res.status).toBe(423);
      expect(res.json.code).toBe('DATABASE_LOCKED');
    }
    expect((await getDatabase(databaseId)).schema).toEqual(before.schema);
    const viewsAfter = (await api('GET', `/databases/${databaseId}/views`)).json.views as {
      name: string;
    }[];
    expect(viewsAfter.map((v) => v.name)).toEqual(['All', 'Second']);

    // Rows, and the database's own name, are not its schema.
    const rowId = await addRow(databaseId, 'Row');
    const edited = await api('PATCH', `/pages/${rowId}`, { title: 'Edited' });
    expect(edited.status).toBe(200);
    expect((await api('PATCH', `/databases/${databaseId}`, { name: 'Renamed' })).status).toBe(200);

    const unlocked = await api('PATCH', `/databases/${databaseId}`, { locked: false });
    expect((unlocked.json.database as DatabaseBody).locked).toBe(false);
    const added = await api('POST', `/databases/${databaseId}/properties`, {
      name: 'N',
      type: 'number',
    });
    expect(added.status).toBe(201);
  });

  it('is not related to two-way, which would add a property to it', async () => {
    const targetId = await createDatabase();
    const sourceId = await createDatabase();
    await api('PATCH', `/databases/${targetId}`, { locked: true });
    const twoWay = await api('POST', `/databases/${sourceId}/properties`, {
      name: 'Rel',
      type: 'relation',
      config: { targetDatabaseId: targetId, twoWay: true },
    });
    expect(twoWay.status).toBe(423);
    const oneWay = await api('POST', `/databases/${sourceId}/properties`, {
      name: 'Rel',
      type: 'relation',
      config: { targetDatabaseId: targetId },
    });
    expect(oneWay.status).toBe(201);
  });
});

describe('PUT /databases/:id/properties/order', () => {
  it('puts the named properties first, keeps the rest after, and passes over unknown ids', async () => {
    const databaseId = await createDatabase([
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'a', name: 'A', type: 'text' },
      { id: 'b', name: 'B', type: 'text' },
      { id: 'c', name: 'C', type: 'text' },
    ]);
    const res = await api('PUT', `/databases/${databaseId}/properties/order`, {
      ids: ['c', 'gone', 'a'],
    });
    expect(res.status).toBe(200);
    const ids = (res.json.database as DatabaseBody).schema.properties.map((p) => p.id);
    expect(ids).toEqual(['c', 'a', 'name', 'b']);
    expect((await getDatabase(databaseId)).schema.properties.map((p) => p.id)).toEqual(ids);

    const twice = await api('PUT', `/databases/${databaseId}/properties/order`, {
      ids: ['a', 'a'],
    });
    expect(twice.status).toBe(400);
  });
});

describe('changing a property type', () => {
  it('converts the values the new type can hold and clears the others, on every row', async () => {
    const databaseId = await createDatabase([
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'v', name: 'Value', type: 'text' },
    ]);
    await addRow(databaseId, 'number', { v: { text: '1,500' } });
    await addRow(databaseId, 'words', { v: { text: 'many' } });
    await addRow(databaseId, 'empty');
    const toNumber = await api('PATCH', `/databases/${databaseId}/properties/v`, {
      type: 'number',
    });
    expect(toNumber.status).toBe(200);
    expect(await stored(databaseId, 'v')).toEqual({
      number: { number: 1500 },
      words: null,
      empty: null,
    });

    // Back to text: the number as people read it.
    await api('PATCH', `/databases/${databaseId}/properties/v`, { type: 'text' });
    expect(await stored(databaseId, 'v')).toEqual({
      number: { text: '1500' },
      words: null,
      empty: null,
    });
  });

  it('makes options of text, keeps option ids between option types, and names them as text', async () => {
    const databaseId = await createDatabase([
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'tag', name: 'Tag', type: 'text' },
    ]);
    await addRow(databaseId, 'one', { tag: { text: 'Red' } });
    await addRow(databaseId, 'two', { tag: { text: 'red' } });
    await addRow(databaseId, 'three', { tag: { text: 'Blue' } });
    const res = await api('PATCH', `/databases/${databaseId}/properties/tag`, { type: 'select' });
    const tag = (res.json.database as DatabaseBody).schema.properties.find((p) => p.id === 'tag');
    const options = tag?.config?.options ?? [];
    expect(options.map((o) => o.name)).toEqual(['Red', 'Blue']);
    const red = options[0].id;
    expect(await stored(databaseId, 'tag')).toEqual({
      one: { optionId: red },
      two: { optionId: red },
      three: { optionId: options[1].id },
    });

    // Select to status: the same options, now in groups (all "To-do").
    const status = await api('PATCH', `/databases/${databaseId}/properties/tag`, {
      type: 'status',
    });
    const asStatus = (status.json.database as DatabaseBody).schema.properties.find(
      (p) => p.id === 'tag',
    );
    expect(asStatus?.config?.groups).toEqual([
      { id: 'todo', optionIds: [red, options[1].id] },
      { id: 'in_progress', optionIds: [] },
      { id: 'complete', optionIds: [] },
    ]);
    expect((await stored(databaseId, 'tag')).one).toEqual({ optionId: red });

    const text = await api('PATCH', `/databases/${databaseId}/properties/tag`, { type: 'text' });
    const asText = (text.json.database as DatabaseBody).schema.properties.find(
      (p) => p.id === 'tag',
    );
    expect(asText?.config?.groups).toBeUndefined();
    expect(await stored(databaseId, 'tag')).toEqual({
      one: { text: 'Red' },
      two: { text: 'Red' },
      three: { text: 'Blue' },
    });
  });

  it('keeps what a formula showed, and drops the views’ filters on the property', async () => {
    const databaseId = await createDatabase([
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'pts', name: 'Points', type: 'number' },
      { id: 'f', name: 'Double', type: 'formula', config: { expression: 'prop("Points") * 2' } },
    ]);
    await addRow(databaseId, 'four', { pts: { number: 2 } });
    const created = await api('POST', `/databases/${databaseId}/views`, {
      name: 'Filtered',
      type: 'table',
      filters: {
        kind: 'group',
        combinator: 'and',
        filters: [
          { kind: 'condition', propertyId: 'f', operator: '>', value: 1 },
          { kind: 'condition', propertyId: 'pts', operator: 'is_not_empty' },
        ],
      },
      sorts: [{ propertyId: 'f', direction: 'asc' }],
    });
    const viewId = (created.json.view as { id: string }).id;

    const res = await api('PATCH', `/databases/${databaseId}/properties/f`, { type: 'number' });
    expect(res.status).toBe(200);
    expect(await stored(databaseId, 'f')).toEqual({ four: { number: 4 } });
    const [view] = await db.select().from(databaseViews).where(eq(databaseViews.id, viewId));
    expect(view.filters.filters).toEqual([
      { kind: 'condition', propertyId: 'pts', operator: 'is_not_empty' },
    ]);
    expect(view.sorts).toEqual([{ propertyId: 'f', direction: 'asc' }]);
    expect((await listRows(databaseId, viewId)).map((r) => r.title)).toEqual(['four']);
  });

  it('numbers the rows of a property becoming an ID, and never retypes the Name', async () => {
    const databaseId = await createDatabase([
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'n', name: 'N', type: 'text' },
    ]);
    await addRow(databaseId, 'first', { n: { text: 'x' } });
    await addRow(databaseId, 'second');
    await api('PATCH', `/databases/${databaseId}/properties/n`, { type: 'unique_id' });
    expect(await stored(databaseId, 'n')).toEqual({
      first: { number: 1 },
      second: { number: 2 },
    });
    const name = await api('PATCH', `/databases/${databaseId}/properties/name`, {
      type: 'number',
    });
    expect(name.status).toBe(400);
  });
});

describe('status groups', () => {
  it('come with a new database and a new status property, and stay whole as options change', async () => {
    const databaseId = await createDatabase();
    const status = (await getDatabase(databaseId)).schema.properties.find((p) => p.id === 'status');
    const [todo, doing, done] = status?.config?.options ?? [];
    expect(status?.config?.groups).toEqual([
      { id: 'todo', optionIds: [todo.id] },
      { id: 'in_progress', optionIds: [doing.id] },
      { id: 'complete', optionIds: [done.id] },
    ]);

    const added = await api('POST', `/databases/${databaseId}/properties`, {
      id: 'stage',
      name: 'Stage',
      type: 'status',
    });
    const stage = (added.json.database as DatabaseBody).schema.properties.find(
      (p) => p.id === 'stage',
    );
    expect(stage?.config?.options?.map((o) => o.name)).toEqual([
      'Not started',
      'In progress',
      'Done',
    ]);
    expect(stage?.config?.groups?.map((g) => g.optionIds.length)).toEqual([1, 1, 1]);

    // An option moved to "Complete", one added in no group: it goes to "To-do".
    const moved = await api('PATCH', `/databases/${databaseId}/properties/status`, {
      config: {
        options: [...(status?.config?.options ?? []), { id: 'new', name: 'Blocked' }],
        groups: [
          { id: 'in_progress', optionIds: [doing.id] },
          { id: 'complete', optionIds: [todo.id, done.id] },
        ],
      },
    });
    expect(moved.status).toBe(200);
    const after = (moved.json.database as DatabaseBody).schema.properties.find(
      (p) => p.id === 'status',
    );
    expect(after?.config?.groups).toEqual([
      { id: 'todo', optionIds: ['new'] },
      { id: 'in_progress', optionIds: [doing.id] },
      { id: 'complete', optionIds: [todo.id, done.id] },
    ]);
  });
});

describe('rollups', () => {
  it('show the related values as they read, and the share of them empty or not', async () => {
    const targetId = await createDatabase([
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'done', name: 'Done', type: 'checkbox' },
      { id: 'pts', name: 'Points', type: 'number' },
    ]);
    const a = await addRow(targetId, 'Alpha', { done: { checked: true }, pts: { number: 3 } });
    const b = await addRow(targetId, 'Beta', { done: { checked: false } });
    const c = await addRow(targetId, 'Gamma', { pts: { number: 5 } });
    const rollup = (id: string, targetPropertyId: string, fn: string): Property => ({
      id,
      name: id,
      type: 'rollup',
      config: { relationPropertyId: 'rel', targetPropertyId, function: fn },
    });
    const sourceId = await createDatabase([
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'rel', name: 'Rel', type: 'relation', config: { targetDatabaseId: targetId } },
      rollup('names', 'name', 'show_original'),
      rollup('points', 'pts', 'show_original'),
      rollup('undone', 'done', 'percent_empty'),
      rollup('scored', 'pts', 'percent_not_empty'),
    ]);
    await addRow(sourceId, 'All', { rel: { pageIds: [a, b, c] } });
    await addRow(sourceId, 'None', { rel: { pageIds: [] } });
    const rows = await listRows(sourceId);
    const all = rows.find((r) => r.title === 'All')?.properties;
    expect(all?.names).toEqual({ text: 'Alpha, Beta, Gamma' });
    expect(all?.points).toEqual({ text: '3, 5' });
    expect(all?.undone).toEqual({ number: 66.67 });
    expect(all?.scored).toEqual({ number: 66.67 });
    const none = rows.find((r) => r.title === 'None')?.properties;
    expect(none?.names).toEqual({ text: '' });
    expect(none?.undone).toEqual({ text: '' });
  });
});

describe('a new view', () => {
  it('starts on the first date property, the first status, or page covers, unless told otherwise', async () => {
    const databaseId = await createDatabase([
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'kind', name: 'Kind', type: 'select' },
      { id: 'when', name: 'When', type: 'date' },
      { id: 'stage', name: 'Stage', type: 'status' },
      { id: 'due', name: 'Due', type: 'date' },
    ]);
    const make = async (body: Json) => {
      const res = await api('POST', `/databases/${databaseId}/views`, { name: 'V', ...body });
      expect(res.status).toBe(201);
      return res.json.view as { groupBy: unknown; config: Json };
    };
    expect((await make({ type: 'calendar' })).config).toEqual({ datePropertyId: 'when' });
    expect((await make({ type: 'timeline' })).config).toEqual({ startPropertyId: 'when' });
    expect((await make({ type: 'board' })).groupBy).toEqual({ propertyId: 'stage' });
    expect((await make({ type: 'gallery' })).config).toEqual({ coverSource: 'pageCover' });
    expect((await make({ type: 'table' })).config).toEqual({});
    // What the request says wins, an explicit ungrouped board too.
    expect((await make({ type: 'calendar', config: { datePropertyId: 'due' } })).config).toEqual({
      datePropertyId: 'due',
    });
    expect((await make({ type: 'board', groupBy: null })).groupBy).toBeNull();
  });
});
