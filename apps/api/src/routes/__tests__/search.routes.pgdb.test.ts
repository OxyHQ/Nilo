/**
 * `GET /search` against PostgreSQL: titles and block text, prefixes, input
 * that looks like query syntax, access, and the GIN indexes being usable.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from '@oxy.so/db';
import { sql } from 'drizzle-orm';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { pagePermissions } from '../../db/schema/collab.js';
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

const { default: pagesRouter } = await import('../pages.js');
const { default: blocksRouter } = await import('../blocks.js');
const { default: searchRouter } = await import('../search.js');

let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let previousUrl: string | undefined;
const OWNER = 'search-owner';
const VIEWER = 'search-viewer';

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

async function pageWith(title: string, texts: string[], parentId?: string): Promise<string> {
  const created = await api(OWNER, 'POST', '/pages', { workspaceId, title, parentId });
  const id = (created.json.page as { id: string }).id;
  let afterId: string | null = null;
  const ops = texts.map((text) => {
    const blockId = uuidv7();
    const op = {
      kind: 'insert',
      id: blockId,
      parentBlockId: null,
      afterId,
      type: 'paragraph',
      content: { text },
    };
    afterId = blockId;
    return op;
  });
  if (ops.length > 0) await api(OWNER, 'POST', `/pages/${id}/blocks/transactions`, { ops });
  return id;
}

interface Result {
  page: { id: string };
  path: string[];
  matchedTitle: boolean;
  snippet: { text: string; match: boolean }[];
}
const search = async (user: string, q: string) =>
  (await api(user, 'GET', `/search?workspaceId=${workspaceId}&q=${encodeURIComponent(q)}`)).json
    .results as Result[];

let roadmap: string;
let notes: string;
let secret: string;

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: testScope('search'), ownerId: OWNER })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: OWNER, role: 'owner' },
    { workspaceId, userId: VIEWER, role: 'viewer' },
  ]);
  const app = express();
  app.use(express.json());
  app.use(blocksRouter);
  app.use('/pages', pagesRouter);
  app.use('/search', searchRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  roadmap = await pageWith('Roadmap 2027', ['Planificación trimestral del equipo']);
  notes = await pageWith(
    'Notas',
    ['La reunión de planificación es el lunes', 'Otro párrafo'],
    roadmap,
  );
  secret = await pageWith('Secreto', ['planificación confidencial']);
  await api(OWNER, 'PATCH', `/pages/${secret}`, { restricted: true });
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

describe('GET /search', () => {
  it('finds block text by word prefix, with the match marked in a snippet', async () => {
    const results = await search(OWNER, 'planif');
    expect(results.map((r) => r.page.id)).toEqual(expect.arrayContaining([roadmap, notes, secret]));
    const hit = results.find((r) => r.page.id === notes);
    expect(hit?.matchedTitle).toBe(false);
    expect(hit?.snippet.filter((p) => p.match).map((p) => p.text.toLowerCase())).toEqual([
      'planificación',
    ]);
    expect(hit?.path).toEqual(['Roadmap 2027']);
  });

  it('ranks a title match first and requires every word', async () => {
    expect((await search(OWNER, 'roadmap'))[0]?.page.id).toBe(roadmap);
    expect(await search(OWNER, 'reunión lunes')).toEqual([
      expect.objectContaining({ page: expect.objectContaining({ id: notes }) }),
    ]);
    expect(await search(OWNER, 'reunión martes')).toEqual([]);
  });

  it('ignores accents both ways, and still marks the word as written', async () => {
    const plain = await search(OWNER, 'reunion lunes');
    expect(plain.map((r) => r.page.id)).toEqual([notes]);
    const hit = (await search(OWNER, 'planificacion')).find((r) => r.page.id === notes);
    expect(hit?.snippet.filter((p) => p.match).map((p) => p.text.toLowerCase())).toEqual([
      'planificación',
    ]);
    expect((await search(OWNER, 'RÓADMAP'))[0]?.page.id).toBe(roadmap);
  });

  it('treats query syntax as text', async () => {
    expect(
      (
        await api(
          OWNER,
          'GET',
          `/search?workspaceId=${workspaceId}&q=${encodeURIComponent("plan:* | ! ' &")}`,
        )
      ).status,
    ).toBe(200);
    expect(await search(OWNER, '!!!')).toEqual([]);
  });

  it('leaves out pages the caller cannot open', async () => {
    const ids = (await search(VIEWER, 'planificación')).map((r) => r.page.id);
    expect(ids).toContain(notes);
    expect(ids).not.toContain(secret);
  });

  it('lets a guest search what is shared with them, and nobody else in', async () => {
    const GUEST = 'search-guest';
    await db
      .insert(pagePermissions)
      .values({ pageId: notes, userId: GUEST, role: 'viewer', grantedBy: OWNER });
    const found = (await search(GUEST, 'planificación')).map((r) => r.page.id);
    expect(found).toEqual([notes]);
    // The path above a shared page stays private.
    expect((await search(GUEST, 'reunión'))[0]?.path).toEqual([]);
    const stranger = await api(
      'search-stranger',
      'GET',
      `/search?workspaceId=${workspaceId}&q=plan`,
    );
    expect(stranger.status).toBe(403);
  });

  it('can use the full-text indexes', async () => {
    await db.execute(sql`set enable_seqscan = off`);
    try {
      const plan = async (query: ReturnType<typeof sql>) =>
        (await db.execute(sql`explain ${query}`))
          .map((row) => String(Object.values(row)[0]))
          .join('\n');
      expect(
        await plan(
          sql`select id from blocks where to_tsvector('nilo_search'::regconfig, coalesce(content ->> 'text', '')) @@ to_tsquery('nilo_search'::regconfig, 'plan:*')`,
        ),
      ).toContain('blocks_text_fts_idx');
      expect(
        await plan(
          sql`select id from pages where to_tsvector('nilo_search'::regconfig, title) @@ to_tsquery('nilo_search'::regconfig, 'plan:*')`,
        ),
      ).toContain('pages_title_fts_idx');
      expect(
        await plan(
          sql`select id from blocks b where b.content -> 'segments' @> '[{"mention":{"attributes":{"kind":"page","id":"x"}}}]'::jsonb`,
        ),
      ).toContain('blocks_segments_path_idx');
      expect(
        await plan(
          sql`select id from blocks b where b.type = 'link_to_page' and b.content ->> 'pageId' = 'x'`,
        ),
      ).toContain('blocks_link_to_page_idx');
    } finally {
      await db.execute(sql`set enable_seqscan = on`);
    }
  });
});
