/**
 * `/notes` against PostgreSQL, through the real routes: notes are rows of the
 * personal workspace's notes database, written whole or in part, synced by
 * cursor with their deletions, labelled, filed, and guarded against changes
 * that would take a field away from Noted.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Note, NoteBlock, NotesSyncPage } from '@nilo/contracts';
import { uuidv7 } from '@oxy.so/db';
import express from 'express';
import { like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';
import { NOTE_PROPERTY } from '../../lib/databases/system.js';

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
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
    users: { get: async () => ({ username: 'ada' }) },
  },
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/notification-service.js', () => ({ sendNotification: vi.fn(async () => ({})) }));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: notesRouter } = await import('../notes.js');
const { default: workspacesRouter } = await import('../workspaces.js');
const { default: databasesRouter } = await import('../databases.js');
const { default: remindersRouter } = await import('../reminders.js');

let db: TestDatabase;
let server: Server;
let base: string;
let previousUrl: string | undefined;

const scope = testScope('notes-routes');
const USER = `${scope}-user`;

type Json = Record<string, unknown>;

async function api(method: string, path: string, body?: unknown, user = USER) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Json };
}

const block = (type: NoteBlock['type'], content: Json, order: number): NoteBlock => ({
  id: uuidv7(),
  parentBlockId: null,
  type,
  content,
  order,
});

async function sync(cursor?: string): Promise<NotesSyncPage> {
  const res = await api('GET', `/notes/sync${cursor ? `?cursor=${cursor}` : ''}`);
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json as unknown as NotesSyncPage;
}

async function create(fields: Json = {}): Promise<Note> {
  const res = await api('POST', '/notes', { title: 'A note', ...fields });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return res.json.note as Note;
}

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const app = express();
  app.use(express.json());
  app.use('/notes', notesRouter);
  app.use('/workspaces', workspacesRouter);
  app.use('/databases', databasesRouter);
  app.use(remindersRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.delete(workspaces).where(like(workspaces.ownerId, `${scope}%`));
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousUrl;
});

describe('the first sync', () => {
  it('provisions the notes and returns the whole, empty set', async () => {
    const page = await sync();
    expect(page).toMatchObject({ notes: [], deleted: [], hasMore: false, full: true });
    expect(page.labels).toEqual([]);
    expect(page.folders).toEqual([]);
  });
});

describe('writing a note', () => {
  it('creates one with its content, fields and reminder, and a retry finds it', async () => {
    const label = (await api('POST', '/notes/labels', { name: 'Work', color: 'blue' })).json
      .label as { id: string };
    const folder = (await api('POST', '/notes/folders', { name: 'Inbox' })).json.folder as {
      id: string;
    };
    const id = uuidv7();
    const remindAt = new Date(Date.now() + 3_600_000).toISOString();
    const body = {
      id,
      title: 'Groceries',
      color: 'yellow',
      labels: [label.id],
      folderId: folder.id,
      pinned: true,
      reminderAt: remindAt,
      attachments: ['oxy-file-1'],
      blocks: [
        block('paragraph', { text: 'For the weekend' }, 0),
        block('todo', { text: 'Milk', checked: false }, 1),
      ],
    };
    const first = await api('POST', '/notes', body);
    expect(first.status, JSON.stringify(first.json)).toBe(201);
    const note = first.json.note as Note;
    expect(note).toMatchObject({
      id,
      title: 'Groceries',
      color: 'yellow',
      labels: [label.id],
      folderId: folder.id,
      pinned: true,
      archived: false,
      trashed: false,
      kind: 'note',
      attachments: ['oxy-file-1'],
      reminderAt: remindAt,
    });
    expect(note.blocks.map((b) => [b.type, b.content.text])).toEqual([
      ['paragraph', 'For the weekend'],
      ['todo', 'Milk'],
    ]);

    const retry = await api('POST', '/notes', body);
    expect(retry.status).toBe(200);
    expect((retry.json.note as Note).id).toBe(id);
  });

  it('refuses an unknown label or folder', async () => {
    expect((await api('POST', '/notes', { labels: ['nope'] })).status).toBe(400);
    expect((await api('POST', '/notes', { folderId: uuidv7() })).status).toBe(400);
  });

  it('applies a patch on the version it was made on, and answers a stale one with the note', async () => {
    const note = await create({ blocks: [block('todo', { text: 'Call', checked: false }, 0)] });
    const [todo] = note.blocks;

    const ok = await api('PATCH', `/notes/${note.id}`, {
      baseUpdatedAt: note.updatedAt,
      color: 'green',
      blocks: [{ ...todo, content: { text: 'Call', checked: true } }],
    });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    const patched = ok.json.note as Note;
    expect(patched.color).toBe('green');
    // The block keeps its id: an edit, not a replacement.
    expect(patched.blocks).toEqual([
      expect.objectContaining({
        id: todo?.id,
        content: expect.objectContaining({ checked: true }),
      }),
    ]);

    const stale = await api('PATCH', `/notes/${note.id}`, {
      baseUpdatedAt: note.updatedAt,
      color: 'red',
    });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ code: 'STALE_NOTE', note: { color: 'green' } });
  });

  it('keeps app data by revision', async () => {
    const note = await create();
    const write = (baseRevision: number) =>
      api('PATCH', `/notes/${note.id}`, { appData: { data: { artifacts: [] }, baseRevision } });
    const first = await write(0);
    expect((first.json.note as Note).appData).toEqual({ data: { artifacts: [] }, revision: 1 });
    expect((await write(0)).json).toMatchObject({ code: 'STALE_APP_DATA' });
  });
});

describe('sync', () => {
  it('returns what changed and what was deleted since the cursor', async () => {
    // Read to the end of a pass, for a cursor that starts after it.
    let page = await sync();
    while (page.hasMore) page = await sync(page.cursor);
    const cursor = page.cursor;

    const kept = await create({ title: 'Kept' });
    const gone = await create({ title: 'Gone' });
    // Past the cursor's overlap, so only the changes below are new.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const later = await sync(cursor);
    expect(later.notes.map((n) => n.id)).toEqual(expect.arrayContaining([kept.id, gone.id]));

    await new Promise((resolve) => setTimeout(resolve, 1100));
    await api('PATCH', `/notes/${kept.id}`, { pinned: true });
    expect((await api('DELETE', `/notes/${gone.id}`)).status).toBe(200);
    const changes = await sync(later.cursor);
    expect(changes.full).toBe(false);
    expect(changes.notes.map((n) => n.id)).toEqual([kept.id]);
    expect(changes.deleted).toEqual([gone.id]);
  });

  it('pages a pass by limit without losing a note', async () => {
    const all = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const res = await api('GET', `/notes/sync?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      const page = res.json as unknown as NotesSyncPage;
      for (const note of page.notes) all.add(note.id);
      pages += 1;
      cursor = page.cursor;
      if (!page.hasMore) {
        expect(page.labels).toBeDefined();
        break;
      }
      expect(page.labels).toBeUndefined();
    }
    const listed = (await api('GET', '/notes?view=active')).json.notes as Note[];
    for (const note of listed) expect(all.has(note.id)).toBe(true);
    expect(pages).toBeGreaterThan(1);
  });

  it('picks up a reminder set from Nilo', async () => {
    const note = await create();
    const { cursor } = await sync();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const remindAt = new Date(Date.now() + 7_200_000).toISOString();
    expect((await api('POST', `/pages/${note.id}/reminders`, { remindAt })).status).toBe(201);
    const page = await sync(cursor);
    expect(page.notes.find((n) => n.id === note.id)?.reminderAt).toBe(remindAt);
  });
});

describe('labels', () => {
  it('are unique by name, and leave the notes when deleted', async () => {
    const created = await api('POST', '/notes/labels', { name: 'Ideas' });
    expect(created.status).toBe(201);
    const label = created.json.label as { id: string };
    expect((await api('POST', '/notes/labels', { name: 'ideas' })).status).toBe(409);

    const note = await create({ labels: [label.id] });
    expect((await api('DELETE', `/notes/labels/${label.id}`)).status).toBe(200);
    expect(((await api('GET', `/notes/${note.id}`)).json.note as Note).labels).toEqual([]);
  });
});

describe('folders', () => {
  it('nest, refuse a cycle, and give their contents to their parent when deleted', async () => {
    const make = async (name: string, parentId?: string) =>
      ((await api('POST', '/notes/folders', { name, parentId })).json.folder as { id: string }).id;
    const top = await make('Top');
    const middle = await make('Middle', top);
    const bottom = await make('Bottom', middle);

    const cycle = await api('PATCH', `/notes/folders/${top}`, { name: 'Top', parentId: bottom });
    expect(cycle.json).toMatchObject({ code: 'FOLDER_CYCLE' });

    const note = await create({ folderId: middle });
    expect((await api('DELETE', `/notes/folders/${middle}`)).status).toBe(200);

    const folders = (await api('GET', '/notes/folders')).json.folders as {
      id: string;
      parentId: string | null;
    }[];
    expect(folders.find((f) => f.id === middle)).toBeUndefined();
    expect(folders.find((f) => f.id === bottom)?.parentId).toBe(top);
    expect(((await api('GET', `/notes/${note.id}`)).json.note as Note).folderId).toBe(top);
  });
});

describe('the notes database in Nilo', () => {
  it('cannot be deleted, nor lose a property Noted reads; a label can still be renamed', async () => {
    const list = await api('GET', '/workspaces/personal');
    const workspaceId = (list.json.workspace as { id: string }).id;
    const databases = (await api('GET', `/databases?workspaceId=${workspaceId}`)).json
      .databases as { id: string; systemKey: string | null }[];
    const notes = databases.find((d) => d.systemKey === 'notes');
    expect(notes).toBeDefined();
    const id = notes?.id as string;

    expect((await api('DELETE', `/databases/${id}`)).json).toMatchObject({
      code: 'SYSTEM_DATABASE',
    });
    expect(
      (await api('DELETE', `/databases/${id}/properties/${NOTE_PROPERTY.pinned}`)).json,
    ).toMatchObject({ code: 'SYSTEM_PROPERTY' });
    expect(
      (await api('PATCH', `/databases/${id}/properties/${NOTE_PROPERTY.pinned}`, { type: 'text' }))
        .json,
    ).toMatchObject({ code: 'SYSTEM_PROPERTY' });
    const renamed = await api('PATCH', `/databases/${id}/properties/${NOTE_PROPERTY.pinned}`, {
      name: 'Starred',
    });
    expect(renamed.status, JSON.stringify(renamed.json)).toBe(200);
  });

  it('is emptied by a reset and comes back', async () => {
    await create({ title: 'Before reset' });
    const ws = (await api('GET', '/workspaces/personal')).json.workspace as {
      id: string;
      name: string;
    };
    const reset = await api('POST', `/workspaces/${ws.id}/reset`, { confirm: ws.name });
    expect(reset.status, JSON.stringify(reset.json)).toBe(200);
    const page = await sync();
    expect(page.notes).toEqual([]);
    expect(page.labels).toEqual([]);
  });
});
