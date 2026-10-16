/**
 * Publishing to the web against PostgreSQL: who may publish, what the public
 * reads (and does not), subpages, restricted subtrees, indexing and the
 * stable address.
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
import { publishSlugFor } from '../publish.js';

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
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: publishRouter } = await import('../publish.js');
const { default: pagesRouter } = await import('../pages.js');
const { default: blocksRouter } = await import('../blocks.js');

let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let previousUrl: string | undefined;
const OWNER = 'pub-owner';
const EDITOR = 'pub-editor';

async function api(user: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(user && { 'x-test-user': user, 'x-workspace-id': workspaceId }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    headers: res.headers,
    json: (await res.json()) as Record<string, unknown>,
  };
}

async function page(title: string, parentId?: string): Promise<string> {
  const res = await api(OWNER, 'POST', '/pages', { workspaceId, title, parentId });
  return (res.json.page as { id: string }).id;
}

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: testScope('publish'), ownerId: OWNER })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: OWNER, role: 'owner' },
    { workspaceId, userId: EDITOR, role: 'editor' },
  ]);
  const app = express();
  app.use(express.json());
  app.use(publishRouter);
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

describe('publishSlugFor', () => {
  it('makes readable ASCII from the title, with a random suffix', () => {
    expect(publishSlugFor('Planificación del año')).toMatch(/^planificacion-del-ano-[0-9a-f]{10}$/);
    expect(publishSlugFor('東京')).toMatch(/^[0-9a-f]{10}$/);
  });
});

describe('publishing', () => {
  it('lets the public read the page and its unrestricted subpages, nothing more', async () => {
    const site = await page('Handbook');
    await api(OWNER, 'POST', `/pages/${site}/blocks/transactions`, {
      ops: [
        {
          kind: 'insert',
          id: uuidv7(),
          parentBlockId: null,
          afterId: null,
          type: 'paragraph',
          content: { text: 'Welcome' },
        },
      ],
    });
    const chapter = await page('Chapter', site);
    const secret = await page('Secret', site);
    await api(OWNER, 'PATCH', `/pages/${secret}`, { restricted: true });
    const deeper = await page('Deeper', secret);
    const elsewhere = await page('Elsewhere');

    const published = await api(OWNER, 'POST', `/pages/${site}/publish`);
    expect(published.status).toBe(200);
    const slug = published.json.slug as string;
    expect(published.json.published).toBe(true);

    const read = await api(null, 'GET', `/public/pages/${slug}`);
    expect(read.status).toBe(200);
    expect(read.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect((read.json.page as Record<string, unknown>).ownerId).toBeUndefined();
    // Laid out as its readers should see it.
    expect(read.json.page).toMatchObject({ font: 'default', fullWidth: false, smallText: false });
    expect((read.json.blocks as { content: { text: string } }[])[0]?.content.text).toBe('Welcome');
    expect((read.json.children as { id: string }[]).map((c) => c.id)).toEqual([chapter]);

    const sub = await api(null, 'GET', `/public/pages/${slug}/${chapter}`);
    expect(sub.status).toBe(200);
    expect((sub.json.breadcrumb as { id: string }[]).map((c) => c.id)).toEqual([site, chapter]);

    for (const hidden of [secret, deeper, elsewhere]) {
      expect((await api(null, 'GET', `/public/pages/${slug}/${hidden}`)).status).toBe(404);
    }
  });

  it('keeps the address across unpublishing and publishing again, and follows the indexing choice', async () => {
    const target = await page('Notes');
    const first = (await api(OWNER, 'POST', `/pages/${target}/publish`)).json.slug as string;
    expect((await api(OWNER, 'DELETE', `/pages/${target}/publish`)).json.published).toBe(false);
    expect((await api(null, 'GET', `/public/pages/${first}`)).status).toBe(404);
    const again = await api(OWNER, 'POST', `/pages/${target}/publish`, { allowIndexing: true });
    expect(again.json.slug).toBe(first);
    const read = await api(null, 'GET', `/public/pages/${first}`);
    expect(read.status).toBe(200);
    expect(read.headers.get('x-robots-tag')).toBeNull();
  });

  it('needs full access or the creator', async () => {
    const target = await page('Owned by the owner');
    const res = await api(EDITOR, 'POST', `/pages/${target}/publish`);
    expect(res.status).toBe(403);
    expect(res.json.required).toBe('admin');
  });

  it('answers 404 for addresses that are not published or malformed', async () => {
    expect((await api(null, 'GET', '/public/pages/nope-0000000000')).status).toBe(404);
    expect((await api(null, 'GET', '/public/pages/BAD%20SLUG')).status).toBe(404);
  });
});
