/**
 * Synced blocks against PostgreSQL, through the real
 * routes: where an original is shown and which originals a reader may paste
 * (`routes/synced-blocks.ts`), and what a reference shows in an export and
 * on a share link (`lib/synced-blocks.ts`).
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from '@oxy.so/db';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
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
  oxyClient: {
    users: { getMany: async (ids: string[]) => ids.map((id) => ({ id })) },
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
  },
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/notification-service.js', () => ({ sendNotification: vi.fn(async () => ({})) }));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: pagesRouter } = await import('../pages.js');
const { default: blocksRouter } = await import('../blocks.js');
const { default: shareLinksRouter } = await import('../share-links.js');
const { default: commentsRouter } = await import('../comments.js');
const { default: syncedBlocksRouter } = await import('../synced-blocks.js');

let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let previous: { databaseUrl?: string; publicUrl?: string } = {};

const OWNER = 'synced-owner';
const VIEWER = 'synced-viewer';

interface ApiResponse {
  status: number;
  json: Record<string, never> & Record<string, unknown>;
  text: string;
}

async function api(
  user: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      connection: 'close',
      'x-test-user': user,
      'x-workspace-id': workspaceId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
  return { status: res.status, json: isJson && text ? JSON.parse(text) : {}, text };
}

async function page(input: { title?: string; restricted?: boolean } = {}): Promise<string> {
  const res = await api(OWNER, 'POST', '/pages', { workspaceId, title: input.title ?? 'Page' });
  expect(res.status).toBe(201);
  const id = (res.json.page as { id: string }).id;
  if (input.restricted) {
    expect((await api(OWNER, 'PATCH', `/pages/${id}`, { restricted: true })).status).toBe(200);
  }
  return id;
}

type Op = { kind: 'insert'; id: string; parentBlockId: string | null; afterId: string | null };
const text = (value: string) => ({ text: value, segments: [{ text: value }] });

/** Blocks written as one change, each after the one before among its siblings. */
async function write(
  pageId: string,
  blocks: { id?: string; parent?: string; type: string; content?: Record<string, unknown> }[],
): Promise<string[]> {
  const last = new Map<string | null, string>();
  const ops: (Op & { type: string; content: unknown })[] = [];
  for (const block of blocks) {
    const id = block.id ?? uuidv7();
    const parent = block.parent ?? null;
    ops.push({
      kind: 'insert',
      id,
      parentBlockId: parent,
      afterId: last.get(parent) ?? null,
      type: block.type,
      content: block.content ?? {},
    });
    last.set(parent, id);
  }
  const res = await api(OWNER, 'POST', `/pages/${pageId}/blocks/transactions`, { ops });
  expect(res.status).toBe(200);
  return ops.map((op) => op.id);
}

/** An original on `pageId` holding paragraphs of `words`; its id, and its paragraphs'. */
async function original(pageId: string, ...words: string[]): Promise<[string, ...string[]]> {
  const id = uuidv7();
  const ids = await write(pageId, [
    { id, type: 'sync_block' },
    ...words.map((w) => ({ parent: id, type: 'paragraph', content: text(w) })),
  ]);
  return ids as [string, ...string[]];
}

const reference = (pageId: string, source: { blockId: string; pageId: string }) =>
  write(pageId, [
    { type: 'sync_block', content: { sourceBlockId: source.blockId, sourcePageId: source.pageId } },
  ]);

const exported = async (user: string, pageId: string, format = 'md') => {
  const res = await api(user, 'GET', `/pages/${pageId}/export?format=${format}`);
  expect(res.status).toBe(200);
  return res.text;
};

beforeAll(async () => {
  db = await getTestDb();
  previous = { databaseUrl: process.env.DATABASE_URL, publicUrl: process.env.OXYNILO_PUBLIC_URL };
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.OXYNILO_PUBLIC_URL = 'https://nilo.example.test';
  const [ws] = await db
    .insert(workspaces)
    .values({ name: testScope('synced'), ownerId: OWNER })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: OWNER, role: 'owner' },
    { workspaceId, userId: VIEWER, role: 'viewer' },
  ]);

  const app = express();
  app.use(express.json());
  app.use(syncedBlocksRouter);
  app.use(shareLinksRouter);
  app.use(blocksRouter);
  app.use(commentsRouter);
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
  process.env.DATABASE_URL = previous.databaseUrl;
  process.env.OXYNILO_PUBLIC_URL = previous.publicUrl;
});

describe('where an original is shown', () => {
  it('lists its references on pages the reader can open, and nothing for a reference', async () => {
    const home = await page({ title: 'Home' });
    const [source] = await original(home, 'Shared words');
    const open = await page({ title: 'Open' });
    const secret = await page({ title: 'Secret', restricted: true });
    const [openRef] = await reference(open, { blockId: source, pageId: home });
    const [secretRef] = await reference(secret, { blockId: source, pageId: home });

    const owner = await api(OWNER, 'GET', `/blocks/${source}/synced`);
    expect(owner.status).toBe(200);
    expect(owner.json.original).toEqual({
      blockId: source,
      page: { id: home, title: 'Home', icon: null },
    });
    const ownerRefs = (owner.json.references as { blockId: string }[]).map((r) => r.blockId);
    expect(ownerRefs.sort()).toEqual([openRef, secretRef].sort());

    const viewer = await api(VIEWER, 'GET', `/blocks/${source}/synced`);
    expect(viewer.status).toBe(200);
    expect(viewer.json.references).toEqual([
      { blockId: openRef, page: { id: open, title: 'Open', icon: null } },
    ]);

    expect((await api(OWNER, 'GET', `/blocks/${openRef}/synced`)).status).toBe(404);
  });

  it('is not told to someone who cannot open the original', async () => {
    const secret = await page({ restricted: true });
    const [source] = await original(secret, 'Hidden');
    expect((await api(VIEWER, 'GET', `/blocks/${source}/synced`)).status).toBe(403);
  });
});

describe('the originals a reader may paste', () => {
  it('lists originals with their first words, never references or what is shut', async () => {
    const listed = await page({ title: 'Listed' });
    const [source] = await original(listed, 'First   line', 'Second');
    const [ref] = await reference(listed, { blockId: source, pageId: listed });
    const secret = await page({ restricted: true });
    const [hidden] = await original(secret, 'Not yours');

    const viewer = await api(VIEWER, 'GET', `/workspaces/${workspaceId}/synced-blocks`);
    expect(viewer.status).toBe(200);
    const mine = viewer.json.syncedBlocks as { blockId: string; preview: string }[];
    expect(mine.find((b) => b.blockId === source)).toEqual({
      blockId: source,
      page: { id: listed, title: 'Listed', icon: null },
      preview: 'First line Second',
    });
    expect(mine.map((b) => b.blockId)).not.toContain(hidden);
    // Only originals are offered.
    expect(mine.map((b) => b.blockId)).not.toContain(ref);

    const owner = await api(OWNER, 'GET', `/workspaces/${workspaceId}/synced-blocks`);
    const theirs = (owner.json.syncedBlocks as { blockId: string }[]).map((b) => b.blockId);
    expect(theirs).toContain(hidden);
  });
});

describe('exporting a page with a reference', () => {
  it('shows the original’s blocks to whoever may read them, and leaves them out otherwise', async () => {
    const secret = await page({ title: 'Source', restricted: true });
    const [source] = await original(secret, 'Only for the owner');
    const open = await page({ title: 'Reader' });
    await write(open, [{ type: 'paragraph', content: text('Before') }]);
    await reference(open, { blockId: source, pageId: secret });

    const owner = await exported(OWNER, open);
    expect(owner).toContain('Before');
    expect(owner).toContain('Only for the owner');
    expect(await exported(OWNER, open, 'html')).toContain(
      '<div class="synced"><p>Only for the owner</p></div>',
    );

    const viewer = await exported(VIEWER, open);
    expect(viewer).toContain('Before');
    expect(viewer).not.toContain('Only for the owner');
  });

  it('shows an original once when it holds a reference to itself', async () => {
    const home = await page();
    const [source] = await original(home, 'Round');
    await write(home, [
      {
        parent: source,
        type: 'sync_block',
        content: { sourceBlockId: source, sourcePageId: home },
      },
    ]);
    const other = await page();
    await reference(other, { blockId: source, pageId: home });
    const md = await exported(OWNER, other);
    expect(md.match(/Round/g)).toHaveLength(1);
  });

  it('shows nothing once the original is deleted', async () => {
    const home = await page();
    const [source] = await original(home, 'Gone soon');
    const other = await page();
    await reference(other, { blockId: source, pageId: home });
    const removed = await api(OWNER, 'POST', `/pages/${home}/blocks/transactions`, {
      ops: [{ kind: 'remove', id: source }],
    });
    expect(removed.status).toBe(200);
    expect(await exported(OWNER, other)).not.toContain('Gone soon');
  });
});

describe('a shared page with synced blocks', () => {
  it('shows an original on the shared page itself, and no other page’s', async () => {
    const elsewhere = await page();
    const [far] = await original(elsewhere, 'Far away');
    const shared = await page();
    const [near] = await original(shared, 'Right here');
    await reference(shared, { blockId: near, pageId: shared });
    await reference(shared, { blockId: far, pageId: elsewhere });

    const link = await api(OWNER, 'POST', `/pages/${shared}/share`, { scope: 'read' });
    expect(link.status).toBe(201);
    const token = (link.json.shareLink as { token: string }).token;
    const read = await fetch(`${base}/share/${token}`);
    const body = (await read.json()) as { synced: Record<string, { content: { text: string } }[]> };
    expect(Object.keys(body.synced)).toEqual([near]);
    expect(body.synced[near]?.map((b) => b.content.text)).toEqual(['Right here']);
  });
});
