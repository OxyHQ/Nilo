/**
 * Page history against PostgreSQL: when versions are kept, looking at one,
 * and restoring it — content back, block ids (and the comments anchored to
 * them) kept, the replaced state kept as a version, viewers kept out.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from '@oxy.so/db';
import { eq, sql } from 'drizzle-orm';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { materialize } from '@oxy.so/bloom-editor/yjs';
import { closeDb, getDb } from '../../db/client.js';
import { loadPageDoc } from '../../lib/page-docs.js';
import { comments } from '../../db/schema/collab.js';
import { blocks, pageVersions } from '../../db/schema/pages.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticateToken: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: String(req.header('x-test-user')) };
    next();
  },
  oxyClient: {
    // The real limiters resolve an optional session through this; anonymous here.
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
  },
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: historyRouter } = await import('../page-history.js');
const { default: pagesRouter } = await import('../pages.js');
const { default: blocksRouter } = await import('../blocks.js');

let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let previousUrl: string | undefined;
const EDITOR = 'history-editor';
const VIEWER = 'history-viewer';

async function api(user: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-test-user': user,
      'x-workspace-id': workspaceId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const tx = (pageId: string, ops: unknown[]) =>
  api(EDITOR, 'POST', `/pages/${pageId}/blocks/transactions`, { ops });
const versionsOf = async (user: string, pageId: string) =>
  (await api(user, 'GET', `/pages/${pageId}/versions`)).json.versions as {
    id: string;
    blockCount: number;
  }[];
/** Pretend the page's versions were kept long ago, so the next change keeps a new one. */
const ageVersions = (pageId: string) =>
  db
    .update(pageVersions)
    .set({ createdAt: sql`${pageVersions.createdAt} - interval '1 hour'` })
    .where(eq(pageVersions.pageId, pageId));
const textOf = async (pageId: string) =>
  (await db.select().from(blocks).where(eq(blocks.pageId, pageId)))
    .sort((a, b) => a.order - b.order)
    .map((b) => b.content.text);

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: testScope('history'), ownerId: EDITOR })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: EDITOR, role: 'owner' },
    { workspaceId, userId: VIEWER, role: 'viewer' },
  ]);
  const app = express();
  app.use(express.json());
  app.use(historyRouter);
  app.use(blocksRouter);
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

describe('page history', () => {
  it('keeps the state before the first change after a quiet spell, and restores it', async () => {
    const pageId = (
      (await api(EDITOR, 'POST', '/pages', { workspaceId, title: 'Doc' })).json.page as {
        id: string;
      }
    ).id;
    const [a, b] = [uuidv7(), uuidv7()];
    // An empty page with no history is not worth a version.
    await tx(pageId, [
      {
        kind: 'insert',
        id: a,
        parentBlockId: null,
        afterId: null,
        type: 'paragraph',
        content: { text: 'one' },
      },
      {
        kind: 'insert',
        id: b,
        parentBlockId: null,
        afterId: a,
        type: 'paragraph',
        content: { text: 'two' },
      },
    ]);
    expect(await versionsOf(EDITOR, pageId)).toEqual([]);

    // The next change keeps "one, two"; changes right after it keep nothing.
    await tx(pageId, [{ kind: 'update', id: a, content: { text: 'ONE' } }]);
    await tx(pageId, [{ kind: 'remove', id: b }]);
    const kept = await versionsOf(EDITOR, pageId);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.blockCount).toBe(2);

    // A comment anchored to `b`, which is gone now: restoring brings `b` back
    // under the same id.
    const [comment] = await db
      .insert(comments)
      .values({
        workspaceId,
        pageId,
        blockId: null,
        authorId: EDITOR,
        contentSegments: [{ type: 'text', text: 'on a' }],
        contentPlainText: 'on a',
      })
      .returning({ id: comments.id });
    await db
      .update(comments)
      .set({ blockId: a })
      .where(eq(comments.id, comment?.id as string));

    const version = await api(EDITOR, 'GET', `/pages/${pageId}/versions/${kept[0]?.id}`);
    expect(
      (version.json.blocks as { content: { text: string } }[]).map((x) => x.content.text).sort(),
    ).toEqual(['one', 'two']);

    const restored = await api(EDITOR, 'POST', `/pages/${pageId}/versions/${kept[0]?.id}/restore`);
    expect(restored.status).toBe(200);
    expect(await textOf(pageId)).toEqual(['one', 'two']);
    const ids = (await db.select().from(blocks).where(eq(blocks.pageId, pageId)))
      .map((x) => x.id)
      .sort();
    expect(ids).toEqual([a, b].sort());
    // Restored in the document, which every editor and device syncs from, not
    // only in the rows read from it.
    const document = materialize(await loadPageDoc(getDb(), pageId));
    expect(
      document.root.map((id) => (document.blocks[id]?.text ?? []).map((x) => x.text).join('')),
    ).toEqual(['one', 'two']);
    const [still] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, comment?.id as string));
    expect(still?.blockId).toBe(a);

    // What the restore replaced ("ONE") is a version too, so it can be undone.
    const after = await versionsOf(EDITOR, pageId);
    expect(after).toHaveLength(2);
    expect(after[0]?.blockCount).toBe(1);
  });

  it('keeps a new version once the last one is old enough', async () => {
    const pageId = (
      (await api(EDITOR, 'POST', '/pages', { workspaceId })).json.page as { id: string }
    ).id;
    const a = uuidv7();
    await tx(pageId, [
      {
        kind: 'insert',
        id: a,
        parentBlockId: null,
        afterId: null,
        type: 'paragraph',
        content: { text: '1' },
      },
    ]);
    await tx(pageId, [{ kind: 'update', id: a, content: { text: '2' } }]);
    await ageVersions(pageId);
    await tx(pageId, [{ kind: 'update', id: a, content: { text: '3' } }]);
    expect(await versionsOf(EDITOR, pageId)).toHaveLength(2);
    // And who made the change is recorded on the page.
    const read = await api(EDITOR, 'GET', `/pages/${pageId}`);
    expect((read.json.page as { lastEditedBy: string }).lastEditedBy).toBe(EDITOR);
  });

  it('restores nesting: blocks the version keeps come out from under blocks it does not', async () => {
    const pageId = (
      (await api(EDITOR, 'POST', '/pages', { workspaceId })).json.page as { id: string }
    ).id;
    const [p, c] = [uuidv7(), uuidv7()];
    await tx(pageId, [
      {
        kind: 'insert',
        id: c,
        parentBlockId: null,
        afterId: null,
        type: 'paragraph',
        content: { text: 'child' },
      },
    ]);
    // A real edit: the page as it was before it is kept as a version.
    await tx(pageId, [{ kind: 'update', id: c, content: { text: 'child, edited' } }]);
    const [kept] = await versionsOf(EDITOR, pageId);
    // Later, `c` was nested under a new toggle `p`.
    await tx(pageId, [
      {
        kind: 'insert',
        id: p,
        parentBlockId: null,
        afterId: null,
        type: 'toggle',
        content: { text: 'p' },
      },
      { kind: 'move', id: c, parentBlockId: p, afterId: null },
    ]);
    expect(
      (await api(EDITOR, 'POST', `/pages/${pageId}/versions/${kept?.id}/restore`)).status,
    ).toBe(200);
    const rows = await db.select().from(blocks).where(eq(blocks.pageId, pageId));
    expect(rows.map((r) => [r.id, r.parentBlockId])).toEqual([[c, null]]);
  });

  it('lets viewers look but not restore', async () => {
    const pageId = (
      (await api(EDITOR, 'POST', '/pages', { workspaceId })).json.page as { id: string }
    ).id;
    const a = uuidv7();
    await tx(pageId, [
      { kind: 'insert', id: a, parentBlockId: null, afterId: null, type: 'paragraph', content: {} },
    ]);
    await tx(pageId, [{ kind: 'update', id: a, content: { text: 'x' } }]);
    const [kept] = await versionsOf(VIEWER, pageId);
    expect(kept).toBeDefined();
    expect(
      (await api(VIEWER, 'POST', `/pages/${pageId}/versions/${kept?.id}/restore`)).status,
    ).toBe(403);
  });
});
