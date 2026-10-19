/**
 * Comments on a stretch of a block's text against PostgreSQL, through the
 * real routes: what an anchor keeps, and what is refused.
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
const { default: commentsRouter } = await import('../comments.js');

let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let previous: { databaseUrl?: string; publicUrl?: string } = {};

const OWNER = 'anchor-owner';
const VIEWER = 'anchor-viewer';

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

beforeAll(async () => {
  db = await getTestDb();
  previous = { databaseUrl: process.env.DATABASE_URL, publicUrl: process.env.OXYNILO_PUBLIC_URL };
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.OXYNILO_PUBLIC_URL = 'https://nilo.example.test';
  const [ws] = await db
    .insert(workspaces)
    .values({ name: testScope('comment-anchor'), ownerId: OWNER })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: OWNER, role: 'owner' },
    { workspaceId, userId: VIEWER, role: 'viewer' },
  ]);

  const app = express();
  app.use(express.json());
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

describe('a comment on a stretch of text', () => {
  it('keeps where it is and what it quotes', async () => {
    const home = await page();
    const [paragraph] = await write(home, [{ type: 'paragraph', content: text('Hello world') }]);
    const created = await api(OWNER, 'POST', `/pages/${home}/comments`, {
      blockId: paragraph,
      anchor: { start: 6, end: 11, quote: 'world' },
      content: { segments: [{ text: 'Which world?' }] },
    });
    expect(created.status).toBe(201);
    expect((created.json.comment as { anchor: unknown }).anchor).toEqual({
      start: 6,
      end: 11,
      quote: 'world',
    });
    const listed = await api(OWNER, 'GET', `/pages/${home}/comments`);
    const comments = listed.json.comments as { id: string; anchor: unknown }[];
    expect(comments.find((c) => c.anchor !== null)?.anchor).toEqual({
      start: 6,
      end: 11,
      quote: 'world',
    });

    // A reply is on its thread; a comment on a block without one has none.
    const root = (created.json.comment as { id: string }).id;
    const reply = await api(OWNER, 'POST', `/pages/${home}/comments`, {
      blockId: paragraph,
      parentCommentId: root,
      content: { segments: [{ text: 'This one' }] },
    });
    expect((reply.json.comment as { anchor: unknown }).anchor).toBeNull();
  });

  it('is refused without its block, as a reply, or when the quote is not the stretch', async () => {
    const home = await page();
    const [paragraph] = await write(home, [{ type: 'paragraph', content: text('Hello world') }]);
    const content = { segments: [{ text: 'Hm' }] };
    const root = await api(OWNER, 'POST', `/pages/${home}/comments`, {
      blockId: paragraph,
      content,
    });
    const refused = [
      { anchor: { start: 0, end: 5, quote: 'Hello' }, content },
      {
        blockId: paragraph,
        parentCommentId: (root.json.comment as { id: string }).id,
        anchor: { start: 0, end: 5, quote: 'Hello' },
        content,
      },
      { blockId: paragraph, anchor: { start: 0, end: 4, quote: 'Hello' }, content },
      { blockId: paragraph, anchor: { start: 3, end: 3, quote: '' }, content },
    ];
    for (const body of refused) {
      expect((await api(OWNER, 'POST', `/pages/${home}/comments`, body)).status).toBe(400);
    }
  });
});
