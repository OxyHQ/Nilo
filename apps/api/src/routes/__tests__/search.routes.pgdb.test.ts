/**
 * `GET /search` against PostgreSQL: titles and block text, prefixes, titles
 * with a typo, input that looks like query syntax, access, and the GIN indexes
 * being usable.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from '@oxy.so/db';
import { sql } from 'drizzle-orm';
import { blocks, pages } from '../../db/schema/pages.js';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { pagePermissions } from '../../db/schema/collab.js';
import { teamspaces } from '../../db/schema/teamspaces.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';
import { createPage } from '../../repositories/pages.js';

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

  it('finds a title with a typo, below one that matches as typed', async () => {
    const weekly = await pageWith('Reunión semanal del equipo', []);
    expect((await search(OWNER, 'reunon semnal'))[0]?.page.id).toBe(weekly);
    expect((await search(OWNER, 'roadmpa')).map((r) => r.page.id)).toContain(roadmap);
    // Typed right, the title matching every word comes before a near one.
    const exact = await pageWith('Semana', []);
    const near = (await search(OWNER, 'semana')).map((r) => r.page.id);
    expect(near[0]).toBe(exact);
    // Nothing close: nothing found.
    expect(await search(OWNER, 'xylofón')).toEqual([]);
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

  it('narrows by title only, creator, teamspace and when a page was edited', async () => {
    const EDITOR = 'search-filter-editor';
    const [team] = await db
      .insert(teamspaces)
      .values({ workspaceId, name: 'Filters', privacy: 'open', createdBy: OWNER })
      .returning({ id: teamspaces.id });
    const started = new Date(Date.now() - 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const inTeam = await createPage(db, {
      workspaceId,
      ownerId: EDITOR,
      title: 'Planificación del equipo',
      order: 50,
      teamspaceId: team.id,
    });
    const mine = await createPage(db, {
      workspaceId,
      ownerId: OWNER,
      title: 'Planificación privada',
      order: 51,
      teamspaceId: null,
    });
    const filtered = async (params: Record<string, string>) =>
      (
        (
          await api(
            OWNER,
            'GET',
            `/search?${new URLSearchParams({ workspaceId, ...params }).toString()}`,
          )
        ).json.results as Result[]
      ).map((r) => r.page.id);

    // Text matches are left out when only titles are asked for.
    const everything = await filtered({ q: 'planificación' });
    expect(everything).toEqual(expect.arrayContaining([notes, inTeam.id, mine.id]));
    const titles = await filtered({ q: 'planificación', titleOnly: 'true' });
    expect(titles).toEqual(expect.arrayContaining([inTeam.id, mine.id]));
    expect(titles).not.toContain(notes);

    expect(await filtered({ q: 'planificación', createdBy: EDITOR })).toEqual([inTeam.id]);
    expect(await filtered({ q: 'planificación', teamspaceId: team.id })).toEqual([inTeam.id]);
    const privately = await filtered({ q: 'planificación', teamspaceId: 'private' });
    expect(privately).toContain(mine.id);
    expect(privately).not.toContain(inTeam.id);

    const recent = await filtered({ q: 'planificación', editedAfter: started.toISOString() });
    expect(recent.sort()).toEqual([inTeam.id, mine.id].sort());
    expect(
      await filtered({
        q: 'planificación',
        editedBefore: started.toISOString(),
        titleOnly: 'true',
      }),
    ).toEqual([]);

    // Filters with nothing typed: the pages they match, the latest edited first.
    expect(await filtered({ q: '', createdBy: EDITOR })).toEqual([inTeam.id]);
    expect(await filtered({ editedAfter: started.toISOString() })).toEqual([mine.id, inTeam.id]);
    // A guest's filtered search still stops at what is shared with them.
    expect(
      (await api('search-guest', 'GET', `/search?workspaceId=${workspaceId}&createdBy=${EDITOR}`))
        .json.results,
    ).toEqual([]);
    expect(
      (await api(OWNER, 'GET', `/search?workspaceId=${workspaceId}&editedAfter=yesterday`)).status,
    ).toBe(400);
  });

  it('preserves template inclusion for text search and exclusion for filter-only listings', async () => {
    const template = await createPage(db, {
      workspaceId,
      ownerId: OWNER,
      title: 'Templatequartz',
      order: 1,
      template: true,
      teamspaceId: null,
    });
    expect((await search(OWNER, 'templatequartz')).map((entry) => entry.page.id)).toEqual([
      template.id,
    ]);
    const filtered = await api(
      OWNER,
      'GET',
      `/search?${new URLSearchParams({ workspaceId, createdBy: OWNER, limit: '50' })}`,
    );
    expect((filtered.json.results as Result[]).map((entry) => entry.page.id)).not.toContain(
      template.id,
    );
    expect(await search(VIEWER, 'templatequartz')).toEqual([]);
  });

  it('combines title and body scores before applying the result limit', async () => {
    // The winner is fourth in each old candidate pool, but first after combining.
    const winner = await pageWith('Nebulastar', ['Nebulastar']);
    for (let i = 0; i < 3; i++) {
      await pageWith('Nebulastar', []);
      await pageWith(`Unrelated ${i}`, [Array(20).fill('Nebulastar').join(' ')]);
    }
    const result = await api(
      OWNER,
      'GET',
      `/search?${new URLSearchParams({ workspaceId, q: 'nebulastar', limit: '1' })}`,
    );
    const found = result.json.results as Result[];
    expect(found.map((entry) => entry.page.id)).toEqual([winner]);
    expect(found[0]?.matchedTitle).toBe(true);
    expect(found[0]?.snippet.some((part) => part.match)).toBe(true);
  });

  it('applies teamspace scope before the result limit', async () => {
    const [team] = await db
      .insert(teamspaces)
      .values({ workspaceId, name: 'Search target', privacy: 'open', createdBy: OWNER })
      .returning();
    const target = await createPage(db, {
      workspaceId,
      ownerId: OWNER,
      title: 'Lunarstone',
      order: 1,
      teamspaceId: team.id,
    });
    for (let i = 0; i < 7; i++) await pageWith('Lunarstone', []);
    const result = await api(
      OWNER,
      'GET',
      `/search?${new URLSearchParams({ workspaceId, q: 'lunarstone', limit: '1', teamspaceId: team.id })}`,
    );
    expect((result.json.results as Result[]).map((entry) => entry.page.id)).toEqual([target.id]);
  });

  it('does not let private body matches consume the result limit', async () => {
    const guest = testScope('search-body-guest');
    const shared = await createPage(db, {
      workspaceId,
      ownerId: OWNER,
      title: 'Shared body',
      order: 1,
      teamspaceId: null,
    });
    await db
      .insert(pagePermissions)
      .values({ pageId: shared.id, userId: guest, role: 'viewer', grantedBy: OWNER });
    await db
      .insert(blocks)
      .values({ pageId: shared.id, type: 'paragraph', content: { text: 'Cometstone' }, order: 0 });
    for (let i = 0; i < 4; i++) {
      const hidden = await createPage(db, {
        workspaceId,
        ownerId: OWNER,
        title: 'Private body',
        order: i + 2,
        teamspaceId: null,
      });
      await db.insert(blocks).values({
        pageId: hidden.id,
        type: 'paragraph',
        content: { text: Array(20).fill('Cometstone').join(' ') },
        order: 0,
      });
    }
    const result = await api(
      guest,
      'GET',
      `/search?${new URLSearchParams({ workspaceId, q: 'cometstone', limit: '1' })}`,
    );
    expect((result.json.results as Result[]).map((entry) => entry.page.id)).toEqual([shared.id]);
  });

  it('keeps quoted words contiguous, ordered, and exact in titles', async () => {
    const exact = await pageWith('Quasar release notes', []);
    await pageWith('Quasar release planning notes', []);
    await pageWith('Quasar notes release', []);
    await pageWith('Quasar releases notes', []);
    const result = await api(
      OWNER,
      'GET',
      `/search?${new URLSearchParams({ workspaceId, q: 'quasar "release notes"', titleOnly: 'true' })}`,
    );
    expect((result.json.results as Result[]).map((entry) => entry.page.id)).toEqual([exact]);
  });

  it('keeps quoted words together in one body block and retains case/accent folding', async () => {
    const exact = await pageWith('Phrase example', ['Un café azul brilla']);
    await pageWith('Separated words', ['Un café muy azul brilla']);
    await pageWith('Reversed words', ['Azul café']);
    await pageWith('Across blocks', ['café', 'azul']);
    const result = await search(OWNER, '"CAFÉ azul"');
    expect(result.map((entry) => entry.page.id)).toEqual([exact]);
    expect(result[0]?.snippet.some((part) => part.match)).toBe(true);
  });

  it('matches whole lexical phrases, with punctuation normalized and no stemming or prefix expansion', async () => {
    const exact = await pageWith('Aurorastone plan, day', []);
    await pageWith('Aurorastone planning day', []);
    await pageWith('Aurorastone plans day', []);
    await pageWith('Aurorastone plan days', []);
    const result = await api(
      OWNER,
      'GET',
      `/search?${new URLSearchParams({ workspaceId, q: 'aurorastone "plan day"', titleOnly: 'true' })}`,
    );
    expect((result.json.results as Result[]).map((entry) => entry.page.id)).toEqual([exact]);
    const unfinished = await search(OWNER, 'aurorastone "plan');
    expect(unfinished).toHaveLength(4);
  });

  it('does not let private title candidates consume the result limit', async () => {
    const guest = 'search-candidate-guest';
    const shared = await createPage(db, {
      workspaceId,
      ownerId: OWNER,
      title: 'Starlight',
      order: 0,
      teamspaceId: null,
    });
    await db
      .insert(pagePermissions)
      .values({ pageId: shared.id, userId: guest, role: 'viewer', grantedBy: OWNER });
    await db.insert(pages).values(
      Array.from({ length: 65 }, () => ({
        workspaceId,
        ownerId: OWNER,
        title: 'Starlight',
        updatedAt: new Date('2090-01-01T00:00:00Z'),
      })),
    );
    const result = await api(
      guest,
      'GET',
      `/search?${new URLSearchParams({ workspaceId, q: 'starlight', titleOnly: 'true' })}`,
    );
    expect((result.json.results as Result[]).map((entry) => entry.page.id)).toEqual([shared.id]);
  });

  it('can use the full-text and trigram indexes', async () => {
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
        await plan(sql`select id from pages where nilo_fold('semnal') <% nilo_fold(title)`),
      ).toContain('pages_title_trgm_idx');
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
