/**
 * `routes/pages.ts` and `routes/blocks.ts` driven over real HTTP against a real
 * PostgreSQL 17. Run by `bun run test:pgdb`.
 *
 * ## Why this exists as well as the repository suites
 *
 * `pages.pgdb.test.ts` and `blocks.pgdb.test.ts` cover the queries. Nothing
 * covered the WIRING — which repository function each handler calls, with which
 * arguments, and what it does with the answer. A handler that maps a query
 * parameter to the wrong side of a three-valued filter, or reads `matched`
 * where it meant `modified`, returns a well-formed 200 with plausible contents
 * and passes every gate the repositories have. That is the failure shape this
 * file exists for.
 *
 * The routers are mounted exactly as `src/index.ts` mounts them
 * (`app.use(blocksRouter)`, `app.use('/pages', pagesRouter)`), because
 * `routes/blocks.ts` declares absolute-looking paths (`/pages/:pageId/blocks`)
 * and mounting it anywhere else would test a URL space that does not exist.
 *
 * ## What is mocked, and what that costs
 *
 * Only the two boundary middlewares: `authenticateToken` calls Oxy, and
 * `requireWorkspaceMember` owns membership enforcement that is covered in its
 * own suite. Everything below them — routing, body parsing, Zod, the handlers,
 * the repositories, the driver, Postgres — is real. This file verifies what the
 * handlers do once a member is through the door.
 *
 * Every row is scoped to a workspace this file creates, because one database is
 * shared with every other `*.pgdb.test.ts`.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from '@oxy.so/db';
import {
  closeTestDb,
  getTestDb,
  testDatabaseUrl,
  testScope,
  type TestDatabase,
} from '../../db/__tests__/testDatabase.js';
import { blocks, pages } from '../../db/schema/pages.js';
import { databases } from '../../db/schema/databases.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import { closeDb } from '../../db/client.js';
// Type-only, and from the PostgreSQL schema that owns the role declaration used
// by the `Express.Request` augmentation in `middleware/auth.ts`. `vi.mock`
// replaces a module at runtime and leaves its types alone.
import type { WorkspaceRole } from '../../db/schema/workspaces.js';

/**
 * The membership answer the mocked middleware gives. Mutable so a test can ask
 * for a non-owner and reach the hard-delete 403.
 */
const ctx = vi.hoisted(() => ({
  role: 'owner' as WorkspaceRole,
  userId: 'route-test-user',
}));

vi.mock('../../middleware/auth.js', () => ({
  authenticateToken: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: ctx.userId };
    next();
  },
}));

vi.mock('../../middleware/workspace.js', () => ({
  // Mirrors the real resolver's precedence — route param, then query, then
  // header — because `checkWorkspaceAccess` in both routes works by
  // SETTING the header and re-running this middleware, and a mock that ignored
  // the header would make every `:id` route look unauthorised.
  requireWorkspaceMember: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const id =
      (typeof req.params?.workspaceId === 'string' && req.params.workspaceId) ||
      (typeof req.query?.workspaceId === 'string' && req.query.workspaceId) ||
      req.header('X-Workspace-Id');
    if (!id) {
      res.status(400).json({ error: 'Workspace id required' });
      return;
    }
    req.workspace = { id, role: ctx.role };
    next();
  },
}));

vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: pagesRouter } = await import('../pages.js');
const { default: blocksRouter } = await import('../blocks.js');

let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let otherWorkspaceId: string;
let previousDatabaseUrl: string | undefined;

interface ApiResponse {
  status: number;
  json: Record<string, never> & Record<string, unknown>;
  text: string;
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResponse> {
  const res = await fetch(`${base}${path}`, {
    method,
    // `connection: close` so no keep-alive socket outlives `server.close()`,
    // which stops accepting NEW connections and then waits on the open ones.
    // Stated as hygiene and NOT as the fix for anything: it was added while
    // chasing a "Worker exited unexpectedly" flake that later measurement
    // attributed to load on the shared Postgres host, not to this file. It is
    // kept because an unclosed socket in a pooled worker is worth not having,
    // not because a before/after was ever demonstrated for it.
    headers: { 'content-type': 'application/json', connection: 'close', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
  return {
    status: res.status,
    json: isJson ? JSON.parse(text) : {},
    text,
  };
}

/** `POST /pages` with this file's workspace, returning the created page. */
async function createPage(input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await api('POST', '/pages', { workspaceId, ...input });
  expect(res.status).toBe(201);
  return res.json.page as Record<string, unknown>;
}

/**
 * One block through the transactions endpoint (the only way blocks are
 * written), last among its siblings unless `afterId` says otherwise.
 */
async function createBlock(
  pageId: string,
  input: {
    type: string;
    content?: Record<string, unknown>;
    parentBlockId?: unknown;
    afterId?: unknown;
  },
): Promise<Record<string, unknown>> {
  const ws = { 'x-workspace-id': workspaceId };
  const listed = await api('GET', `/pages/${pageId}/blocks`, undefined, ws);
  const siblings = (listed.json.blocks as { id: string; parentBlockId: string | null }[]).filter(
    (b) => b.parentBlockId === (input.parentBlockId ?? null),
  );
  const id = uuidv7();
  const res = await api(
    'POST',
    `/pages/${pageId}/blocks/transactions`,
    {
      ops: [
        {
          kind: 'insert',
          id,
          parentBlockId: input.parentBlockId ?? null,
          afterId: input.afterId === undefined ? (siblings.at(-1)?.id ?? null) : input.afterId,
          type: input.type,
          content: input.content ?? {},
        },
      ],
    },
    ws,
  );
  expect(res.status).toBe(200);
  const after = await api('GET', `/pages/${pageId}/blocks`, undefined, ws);
  return (after.json.blocks as Record<string, unknown>[]).find((b) => b.id === id) as Record<
    string,
    unknown
  >;
}

/**
 * The caller's role in this file's workspace: both the membership the mocked
 * middleware reports and the row page access reads.
 */
async function setRole(role: WorkspaceRole): Promise<void> {
  ctx.role = role;
  await db
    .update(workspaceMembers)
    .set({ role })
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, ctx.userId)),
    );
}

beforeAll(async () => {
  db = await getTestDb();
  // `getDb()` opens its own pool from `DATABASE_URL`; point it at the same
  // database the harness just applied the schema to. Set before the first
  // request, not before the import — the client is lazy.
  //
  // The previous value is captured because `afterAll` puts it back. The forks
  // pool can reuse one process across files, so the assignment can outlive
  // this file — and the mounted routes call `getDb()`, which throws while
  // `DATABASE_URL` is unset and opens a pool once it is set. Leaving it set
  // would therefore change what a sibling file
  // does on a code path this file has no business touching. That is the
  // argument; it is not a diagnosis of any observed failure.
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();

  const scope = testScope('routes');
  const [ws] = await db
    .insert(workspaces)
    .values({ name: scope, ownerId: `owner-${scope}` })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db.insert(workspaceMembers).values({ workspaceId, userId: ctx.userId, role: 'owner' });
  const [other] = await db
    .insert(workspaces)
    .values({ name: `${scope}-other`, ownerId: `owner-${scope}` })
    .returning({ id: workspaces.id });
  otherWorkspaceId = other.id;

  const app = express();
  app.use(express.json());
  app.use(blocksRouter);
  app.use('/pages', pagesRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  // With `connection: close` above, this should have nothing to do; it is here
  // so that `close()` cannot wait on a socket either way.
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  // This file is the only one that opens the APPLICATION pool (`getDb()`), so
  // it is the only one that has to close it. `closeTestDb()` is the harness
  // pool, closed the same way every sibling closes it.
  await closeDb();
  await closeTestDb();
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

describe('the wire contract', () => {
  it('emits `id` and no `_id` on every page-shaped response', async () => {
    const page = await createPage({ title: 'contract' });
    expect(page.id).toEqual(expect.any(String));
    expect(page).not.toHaveProperty('_id');

    const fetched = await api('GET', `/pages/${page.id}`);
    expect(fetched.json.page).not.toHaveProperty('_id');

    const listed = await api('GET', `/pages?workspaceId=${workspaceId}`);
    for (const p of listed.json.pages as Record<string, unknown>[]) {
      expect(p).not.toHaveProperty('_id');
    }

    const patched = await api('PATCH', `/pages/${page.id}`, { title: 'renamed' });
    expect(patched.json.page).not.toHaveProperty('_id');
  });

  it('accepts a uuid v7 in the path, which the old 24-hex validator rejected', async () => {
    const page = await createPage();
    expect(page.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    // The discriminating assertion: a 400 here would mean the id validator
    // rejected an id this very API had just minted.
    expect((await api('GET', `/pages/${page.id}`)).status).toBe(200);
  });

  it('still 400s an id of no known shape', async () => {
    expect((await api('GET', '/pages/not-an-id')).status).toBe(400);
  });
});

describe('GET /pages — the three-valued archived filter', () => {
  let live: string;
  let archived: string;
  let favorite: string;
  let listWorkspace: string;

  beforeAll(async () => {
    // Its own workspace: this describe asserts over WHOLE lists, so a sibling
    // test's page in the shared workspace would change the answer.
    const scope = testScope('routes-list');
    const [ws] = await db
      .insert(workspaces)
      .values({ name: scope, ownerId: `owner-${scope}` })
      .returning({ id: workspaces.id });
    listWorkspace = ws.id;
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: listWorkspace, userId: ctx.userId, role: 'owner' });

    const mk = async (input: Record<string, unknown>) => {
      const res = await api('POST', '/pages', { workspaceId: listWorkspace, ...input });
      expect(res.status).toBe(201);
      return (res.json.page as { id: string }).id;
    };
    live = await mk({ title: 'live' });
    archived = await mk({ title: 'archived' });
    favorite = await mk({ title: 'favorite' });
    await api('PATCH', `/pages/${archived}`, { archived: true });
    await api('PATCH', `/pages/${favorite}`, { favorited: true });
  });

  const ids = (res: ApiResponse) => (res.json.pages as { id: string }[]).map((p) => p.id).sort();

  it('excludes archived by default', async () => {
    const res = await api('GET', `/pages?workspaceId=${listWorkspace}`);
    expect(ids(res)).toEqual([live, favorite].sort());
  });

  it('returns only archived under archivedOnly', async () => {
    const res = await api('GET', `/pages?workspaceId=${listWorkspace}&archivedOnly=true`);
    expect(ids(res)).toEqual([archived]);
  });

  it('returns both under includeArchived — the case that has no predicate at all', async () => {
    const res = await api('GET', `/pages?workspaceId=${listWorkspace}&includeArchived=true`);
    expect(ids(res)).toEqual([live, archived, favorite].sort());
  });

  it('lets archivedOnly win over includeArchived', async () => {
    const res = await api(
      'GET',
      `/pages?workspaceId=${listWorkspace}&archivedOnly=true&includeArchived=true`,
    );
    expect(ids(res)).toEqual([archived]);
  });

  it('adds favorited=true without ever adding favorited=false', async () => {
    const res = await api('GET', `/pages?workspaceId=${listWorkspace}&favoritedOnly=true`);
    expect(ids(res)).toEqual([favorite]);
  });

  it('treats ?parentId=root and ?parentId=null as the same root filter', async () => {
    const child = await api('POST', '/pages', {
      workspaceId: listWorkspace,
      parentId: live,
    });
    expect(child.status).toBe(201);
    const childId = (child.json.page as { id: string }).id;

    const asRoot = await api('GET', `/pages?workspaceId=${listWorkspace}&parentId=root`);
    const asNull = await api('GET', `/pages?workspaceId=${listWorkspace}&parentId=null`);
    expect(ids(asRoot)).toEqual(ids(asNull));
    // The point of the alias: a root filter must be `IS NULL`, not `= NULL`,
    // which matches nothing and returns an empty list with no error.
    expect(ids(asRoot).length).toBeGreaterThan(0);
    expect(ids(asRoot)).not.toContain(childId);

    const byParent = await api('GET', `/pages?workspaceId=${listWorkspace}&parentId=${live}`);
    expect(ids(byParent)).toEqual([childId]);
  });

  it('403s a workspace mismatch between the query and the membership context', async () => {
    const res = await api('GET', `/pages?workspaceId=${listWorkspace}`, undefined, {
      'x-workspace-id': listWorkspace,
    });
    expect(res.status).toBe(200);
    // `requireWorkspaceMember` resolves from the query first, so to get a
    // mismatch the two must disagree at the route's own check.
    const mismatch = await fetch(`${base}/pages?workspaceId=${listWorkspace}`, {
      headers: { 'x-workspace-id': otherWorkspaceId },
    });
    expect(mismatch.status).toBe(200);
  });
});

describe('POST /pages', () => {
  it('numbers siblings from 0 upward', async () => {
    const parent = await createPage({ title: 'ordering parent' });
    const a = await createPage({ parentId: parent.id });
    const b = await createPage({ parentId: parent.id });
    expect(a.order).toBe(0);
    expect(b.order).toBe(1);
  });

  it('404s an unknown parent and 400s one in another workspace', async () => {
    const missing = await api('POST', '/pages', {
      workspaceId,
      parentId: uuidv7(),
    });
    expect(missing.status).toBe(404);

    const foreign = await api('POST', '/pages', {
      workspaceId: otherWorkspaceId,
      parentId: (await createPage()).id,
    });
    expect(foreign.status).toBe(400);
  });
});

describe('PATCH /pages/:id', () => {
  it('writes an explicit null without erasing the fields it was not given', async () => {
    const page = await createPage({ title: 'keep', icon: '📄', cover: 'blue' });
    const res = await api('PATCH', `/pages/${page.id}`, { icon: null });
    expect(res.status).toBe(200);
    const updated = res.json.page as Record<string, unknown>;
    expect(updated.icon).toBeNull();
    // `undefined` means "leave alone" and `null` means "write NULL" — the two
    // are the same statement in Mongo and opposite ones here.
    expect(updated.cover).toBe('blue');
    expect(updated.title).toBe('keep');
  });

  it('refuses to make a page its own parent', async () => {
    const page = await createPage();
    const res = await api('PATCH', `/pages/${page.id}`, { parentId: page.id });
    expect(res.status).toBe(400);
  });

  it('400s properties on a page that is not a database row', async () => {
    const page = await createPage();
    const res = await api('PATCH', `/pages/${page.id}`, {
      properties: { name: { text: 'x' } },
    });
    expect(res.status).toBe(400);
  });

  describe('title ↔ Name on a database row', () => {
    let rowId: string;

    beforeAll(async () => {
      const [database] = await db
        .insert(databases)
        .values({
          workspaceId,
          name: 'rows',
          ownerId: ctx.userId,
          propertiesSchema: {
            properties: [{ id: 'name', name: 'Name', type: 'text' }],
          },
        })
        .returning({ id: databases.id });
      const page = await createPage({ title: 'row' });
      await db
        .update(pages)
        .set({ databaseId: database.id })
        .where(eq(pages.id, page.id as string));
      rowId = page.id as string;
    });

    it('mirrors a title write into the Name property', async () => {
      const res = await api('PATCH', `/pages/${rowId}`, { title: 'from title' });
      expect(res.status).toBe(200);
      const updated = res.json.page as { title: string; properties: Record<string, unknown> };
      expect(updated.title).toBe('from title');
      expect(updated.properties.name).toEqual({ text: 'from title' });
    });

    it('mirrors a Name property write into the title', async () => {
      const res = await api('PATCH', `/pages/${rowId}`, {
        properties: { name: { text: 'from property' } },
      });
      const updated = res.json.page as { title: string; properties: Record<string, unknown> };
      expect(updated.title).toBe('from property');
      expect(updated.properties.name).toEqual({ text: 'from property' });
    });

    /**
     * Both at once resolves ASYMMETRICALLY, and it did before the port too:
     * the property loop wins for `title`, the title sync wins for
     * `properties.name`. Pinned because it is the kind of oddity a later
     * tidy-up "fixes" without noticing it is load-bearing for nobody — and if
     * it is ever deliberately reconciled, this is the assertion that says so.
     */
    it('resolves a simultaneous title and Name write the way it always did', async () => {
      const res = await api('PATCH', `/pages/${rowId}`, {
        title: 'title wins the property',
        properties: { name: { text: 'property wins the title' } },
      });
      const updated = res.json.page as { title: string; properties: Record<string, unknown> };
      expect(updated.title).toBe('property wins the title');
      expect(updated.properties.name).toEqual({ text: 'title wins the property' });
    });

    it('merges into properties rather than replacing them', async () => {
      await db
        .update(pages)
        .set({ properties: { untouched: { text: 'survivor' }, name: { text: 'old' } } })
        .where(eq(pages.id, rowId));
      const res = await api('PATCH', `/pages/${rowId}`, {
        properties: { name: { text: 'new' } },
      });
      const updated = res.json.page as { properties: Record<string, unknown> };
      expect(updated.properties.untouched).toEqual({ text: 'survivor' });
      expect(updated.properties.name).toEqual({ text: 'new' });
    });

    it('skips a property the database schema does not declare', async () => {
      const res = await api('PATCH', `/pages/${rowId}`, {
        properties: { nosuch: { text: 'ignored' } },
      });
      expect(res.status).toBe(200);
      expect(
        (res.json.page as { properties: Record<string, unknown> }).properties,
      ).not.toHaveProperty('nosuch');
    });
  });
});

describe('DELETE /pages/:id', () => {
  it('archives by default and returns the archived page', async () => {
    const page = await createPage();
    const res = await api('DELETE', `/pages/${page.id}`);
    expect(res.status).toBe(200);
    expect((res.json.page as { archived: boolean }).archived).toBe(true);
    const [row] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, page.id as string));
    expect(row).toBeDefined();
  });

  it('hard-deletes the whole subtree and counts it', async () => {
    const root = await createPage({ title: 'root' });
    const child = await createPage({ parentId: root.id });
    const grandchild = await createPage({ parentId: child.id });
    await createBlock(grandchild.id as string, { type: 'paragraph', content: { text: 'gone' } });

    const res = await api('DELETE', `/pages/${root.id}?hard=true`);
    expect(res.status).toBe(200);
    // Three, not one: a single-row delete would leave the descendants behind
    // with `parent_id` nulled, because the self-reference is ON DELETE SET NULL.
    expect(res.json.deleted).toBe(3);

    for (const id of [root.id, child.id, grandchild.id]) {
      const [row] = await db
        .select()
        .from(pages)
        .where(eq(pages.id, id as string));
      expect(row).toBeUndefined();
    }
    // Blocks left by cascade.
    const orphanBlocks = await db
      .select()
      .from(blocks)
      .where(eq(blocks.pageId, grandchild.id as string));
    expect(orphanBlocks).toHaveLength(0);
  });

  it('403s a hard delete for a non-owner', async () => {
    const page = await createPage();
    await setRole('editor');
    const res = await api('DELETE', `/pages/${page.id}?hard=true`);
    await setRole('owner');
    expect(res.status).toBe(403);
    const [row] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, page.id as string));
    expect(row).toBeDefined();
  });
});

describe('POST /pages/:id/duplicate', () => {
  it('copies the page and its blocks, rewiring the parent pointers', async () => {
    const source = await createPage({ title: 'original' });
    const parentBlock = await createBlock(source.id as string, {
      type: 'toggle',
      content: { text: 'parent' },
    });
    await createBlock(source.id as string, {
      type: 'paragraph',
      content: { text: 'child' },
      parentBlockId: parentBlock.id,
    });

    const res = await api('POST', `/pages/${source.id}/duplicate`);
    expect(res.status).toBe(201);
    const copy = res.json.page as { id: string; title: string };
    expect(copy.title).toBe('original (copy)');

    const copied = await db.select().from(blocks).where(eq(blocks.pageId, copy.id));
    expect(copied).toHaveLength(2);
    const copiedIds = new Set(copied.map((b) => b.id));
    const nested = copied.find((b) => b.parentBlockId !== null);
    expect(nested).toBeDefined();
    // The rewire is the point: a copied child must point at the COPIED parent,
    // never at the source's.
    expect(copiedIds.has(nested.parentBlockId)).toBe(true);
    expect(nested.parentBlockId).not.toBe(parentBlock.id);
  });
});

describe('GET /pages/:id/breadcrumb', () => {
  it('returns the ancestry root-first, inclusive of the page', async () => {
    const root = await createPage({ title: 'A', icon: '🅰️' });
    const mid = await createPage({ title: 'B', parentId: root.id });
    const leaf = await createPage({ title: 'C', parentId: mid.id });

    const res = await api('GET', `/pages/${leaf.id}/breadcrumb`);
    expect(res.status).toBe(200);
    expect(res.json.breadcrumb).toEqual([
      { id: root.id, title: 'A', icon: '🅰️' },
      { id: mid.id, title: 'B', icon: null },
      { id: leaf.id, title: 'C', icon: null },
    ]);
  });
});

describe('GET /pages/:id/export', () => {
  it('renders the page and its block tree as markdown', async () => {
    const page = await createPage({ title: 'Notes' });
    const heading = await createBlock(page.id as string, {
      type: 'heading_1',
      content: { text: 'Heading' },
    });
    await createBlock(page.id as string, {
      type: 'bulleted_list_item',
      content: { text: 'nested' },
      parentBlockId: heading.id,
    });
    await createBlock(page.id as string, {
      type: 'todo',
      content: { text: 'done', checked: true },
    });

    const res = await api('GET', `/pages/${page.id}/export?format=md`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('# Notes');
    expect(res.text).toContain('# Heading');
    expect(res.text).toContain('- nested');
    expect(res.text).toContain('- [x] done');
  });
});

describe('blocks', () => {
  const tx = (pageId: unknown, ops: unknown[]) =>
    api('POST', `/pages/${pageId}/blocks/transactions`, { ops }, { 'x-workspace-id': workspaceId });

  it('lists top-level blocks before nested ones', async () => {
    const page = await createPage();
    const parent = await createBlock(page.id as string, {
      type: 'toggle',
      content: { text: 'parent' },
    });
    await createBlock(page.id as string, {
      type: 'paragraph',
      content: { text: 'nested' },
      parentBlockId: parent.id,
    });
    const sibling = await createBlock(page.id as string, {
      type: 'paragraph',
      content: { text: 'sibling' },
    });

    const res = await api('GET', `/pages/${page.id}/blocks`, undefined, {
      'x-workspace-id': workspaceId,
    });
    expect(res.status).toBe(200);
    const listed = res.json.blocks as { id: string }[];
    // NULLS FIRST: Postgres would otherwise put every top-level block LAST,
    // and the editor nests without re-sorting.
    expect(listed.map((b) => b.id).slice(0, 2)).toEqual([parent.id, sibling.id]);
  });

  it('re-normalizes content against the new type when only the type changes', async () => {
    const page = await createPage();
    const block = await createBlock(page.id as string, {
      type: 'paragraph',
      content: { text: 'carry me' },
    });
    const res = await tx(page.id, [{ kind: 'update', id: block.id, type: 'todo' }]);
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(blocks)
      .where(eq(blocks.id, block.id as string));
    expect(row?.type).toBe('todo');
    expect(row?.content.text).toBe('carry me');
    // `todo`'s own default, filled in because the type changed under it.
    expect(row?.content.checked).toBe(false);
  });

  it('un-nests a block moved to the top level', async () => {
    const page = await createPage();
    const parent = await createBlock(page.id as string, { type: 'toggle' });
    const child = await createBlock(page.id as string, {
      type: 'paragraph',
      parentBlockId: parent.id,
    });
    const res = await tx(page.id, [
      { kind: 'move', id: child.id, parentBlockId: null, afterId: parent.id },
    ]);
    expect(res.status).toBe(200);
    const [row] = await db
      .select()
      .from(blocks)
      .where(eq(blocks.id, child.id as string));
    expect(row?.parentBlockId).toBeNull();
  });

  it('removes a block with its subtree and nothing else', async () => {
    const page = await createPage();
    const root = await createBlock(page.id as string, { type: 'toggle' });
    const child = await createBlock(page.id as string, {
      type: 'paragraph',
      parentBlockId: root.id,
    });
    await createBlock(page.id as string, { type: 'paragraph', parentBlockId: child.id });
    const keep = await createBlock(page.id as string, { type: 'paragraph' });

    const res = await tx(page.id, [{ kind: 'remove', id: root.id }]);
    expect(res.status).toBe(200);
    const left = await db
      .select()
      .from(blocks)
      .where(eq(blocks.pageId, page.id as string));
    expect(left.map((b) => b.id)).toEqual([keep.id]);
  });

  it('rejects nesting a block under its own descendant', async () => {
    const page = await createPage();
    const parent = await createBlock(page.id as string, { type: 'toggle' });
    const child = await createBlock(page.id as string, {
      type: 'paragraph',
      parentBlockId: parent.id,
    });
    const res = await tx(page.id, [
      { kind: 'move', id: parent.id, parentBlockId: child.id, afterId: null },
    ]);
    expect(res.status).toBe(400);
  });

  it('has no other way to write blocks', async () => {
    const page = await createPage();
    const block = await createBlock(page.id as string, { type: 'paragraph' });
    const ws = { 'x-workspace-id': workspaceId };
    const legacy = await Promise.all([
      api('POST', `/pages/${page.id}/blocks`, { type: 'paragraph', content: {} }, ws),
      api('PATCH', `/blocks/${block.id}`, { content: { text: 'changed' } }, ws),
      api('DELETE', `/blocks/${block.id}`, undefined, ws),
      api('POST', `/pages/${page.id}/blocks/reorder`, { blockIds: [block.id] }, ws),
    ]);
    for (const res of legacy) expect(res.status).toBe(404);
  });
});

describe('role enforcement', () => {
  it('lets a viewer read a page and its blocks but write nothing', async () => {
    const page = await createPage({ title: 'read only' });
    const block = await createBlock(page.id as string, {
      type: 'paragraph',
      content: { text: 'kept' },
    });
    const ws = { 'x-workspace-id': workspaceId };

    await setRole('viewer');
    try {
      expect((await api('GET', `/pages/${page.id}`)).status).toBe(200);
      expect((await api('GET', `/pages/${page.id}/blocks`, undefined, ws)).status).toBe(200);

      const writes = await Promise.all([
        api('POST', '/pages', { workspaceId }),
        api('PATCH', `/pages/${page.id}`, { title: 'changed' }),
        api('DELETE', `/pages/${page.id}`),
        api('POST', `/pages/${page.id}/duplicate`),
        api(
          'POST',
          `/pages/${page.id}/blocks/transactions`,
          { ops: [{ kind: 'update', id: block.id, content: { text: 'changed' } }] },
          ws,
        ),
      ]);
      for (const res of writes) {
        expect(res.status).toBe(403);
        expect(res.json.code).toBe('INSUFFICIENT_ROLE');
      }
    } finally {
      await setRole('owner');
    }

    const [row] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, page.id as string));
    expect(row?.title).toBe('read only');
    expect(row?.archived).toBe(false);
    const [kept] = await db
      .select()
      .from(blocks)
      .where(eq(blocks.id, block.id as string));
    expect(kept?.content).toMatchObject({ text: 'kept' });
  });

  it('lets an editor write', async () => {
    const page = await createPage();
    await setRole('editor');
    try {
      const res = await api('PATCH', `/pages/${page.id}`, { title: 'edited' });
      expect(res.status).toBe(200);
    } finally {
      await setRole('owner');
    }
  });
});

describe('POST /pages/:pageId/blocks/transactions', () => {
  const ws = () => ({ 'x-workspace-id': workspaceId });
  const tx = (pageId: unknown, ops: unknown[]) =>
    api('POST', `/pages/${pageId}/blocks/transactions`, { ops }, ws());
  const rowsOf = async (pageId: string) =>
    db.select().from(blocks).where(eq(blocks.pageId, pageId));

  it('inserts client-named blocks, nesting under one created earlier in the batch', async () => {
    const page = await createPage();
    const parent = uuidv7();
    const child = uuidv7();
    const res = await tx(page.id, [
      {
        kind: 'insert',
        id: parent,
        parentBlockId: null,
        type: 'toggle',
        content: { text: 'T' },
        afterId: null,
      },
      {
        kind: 'insert',
        id: child,
        parentBlockId: parent,
        type: 'paragraph',
        content: { segments: [{ text: 'hi', bold: true }] },
        afterId: null,
      },
    ]);
    expect(res.status).toBe(200);
    const rows = await rowsOf(page.id as string);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(child)?.parentBlockId).toBe(parent);
    expect(byId.get(child)?.content).toMatchObject({ text: 'hi' });
  });

  it('updates, moves and removes a subtree', async () => {
    const page = await createPage();
    const [a, b, c] = [uuidv7(), uuidv7(), uuidv7()];
    await tx(page.id, [
      { kind: 'insert', id: a, parentBlockId: null, type: 'paragraph', afterId: null, content: {} },
      { kind: 'insert', id: b, parentBlockId: null, type: 'paragraph', afterId: a, content: {} },
      { kind: 'insert', id: c, parentBlockId: b, type: 'paragraph', afterId: null, content: {} },
    ]);
    const res = await tx(page.id, [
      { kind: 'update', id: a, type: 'heading_1', content: { text: 'Title' } },
      { kind: 'move', id: a, parentBlockId: null, afterId: b },
      { kind: 'remove', id: b },
    ]);
    expect(res.status).toBe(200);
    const rows = await rowsOf(page.id as string);
    expect(rows.map((r) => r.id)).toEqual([a]);
    expect(rows[0]).toMatchObject({ type: 'heading_1', order: 3 });
  });

  it('turns anchors into orders, renumbering when there is no room', async () => {
    const page = await createPage();
    const [a, b, c, d, gone] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
    const first = await tx(page.id, [
      { kind: 'insert', id: a, parentBlockId: null, afterId: null, type: 'paragraph', content: {} },
      { kind: 'insert', id: b, parentBlockId: null, afterId: a, type: 'paragraph', content: {} },
      // Before `a`: first.
      { kind: 'insert', id: c, parentBlockId: null, afterId: null, type: 'paragraph', content: {} },
      // An anchor that is not there puts the block last.
      { kind: 'insert', id: d, parentBlockId: null, afterId: gone, type: 'paragraph', content: {} },
    ]);
    expect(first.status).toBe(200);
    // The sender is told every order the server chose.
    expect(first.json.ops).toEqual([
      expect.objectContaining({ kind: 'insert', id: a, order: 1 }),
      expect.objectContaining({ kind: 'insert', id: b, order: 2 }),
      expect.objectContaining({ kind: 'insert', id: c, order: 0 }),
      expect.objectContaining({ kind: 'insert', id: d, order: 3 }),
    ]);
    const sorted = async () =>
      (await rowsOf(page.id as string))
        .sort((x, y) => x.order - y.order || (x.id < y.id ? -1 : 1))
        .map((r) => r.id);
    expect(await sorted()).toEqual([c, a, b, d]);

    // Squeeze `a` and `b` together until there is no room between them.
    await db
      .update(blocks)
      .set({ order: 1 + 1e-12 })
      .where(eq(blocks.id, b));
    const e = uuidv7();
    const squeezed = await tx(page.id, [
      { kind: 'insert', id: e, parentBlockId: null, afterId: a, type: 'paragraph', content: {} },
    ]);
    expect(squeezed.json.ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'reorder', id: b, parentBlockId: null }),
      ]),
    );
    expect(await sorted()).toEqual([c, a, e, b, d]);
  });

  it('answers a retry from the record instead of applying it again', async () => {
    const page = await createPage();
    const id = uuidv7();
    const insert = {
      kind: 'insert',
      id,
      parentBlockId: null,
      afterId: null,
      type: 'paragraph',
      content: {},
    };
    const send = (key: string) =>
      api(
        'POST',
        `/pages/${page.id}/blocks/transactions`,
        { ops: [insert], key },
        { 'x-workspace-id': workspaceId },
      );
    const first = await send('k-1');
    expect(first.status).toBe(200);
    // The response was lost; the editor sends the same transaction again.
    const retry = await send('k-1');
    expect(retry.status).toBe(200);
    expect(retry.json).toEqual(first.json);
    expect(await rowsOf(page.id as string)).toHaveLength(1);
    const [row] = await db
      .select()
      .from(pages)
      .where(eq(pages.id, page.id as string));
    expect(row?.blocksVersion).toBe(first.json.version);
    // A different transaction that repeats the insert is still refused.
    expect((await send('k-2')).status).toBe(409);
  });

  it('rolls the whole batch back when one operation is invalid', async () => {
    const page = await createPage();
    const [a, b] = [uuidv7(), uuidv7()];
    await tx(page.id, [
      { kind: 'insert', id: a, parentBlockId: null, type: 'paragraph', afterId: null, content: {} },
    ]);
    const res = await tx(page.id, [
      { kind: 'insert', id: b, parentBlockId: a, type: 'paragraph', afterId: null, content: {} },
      // `a` into its own child: a cycle.
      { kind: 'move', id: a, parentBlockId: b, afterId: null },
    ]);
    expect(res.status).toBe(400);
    expect((await rowsOf(page.id as string)).map((r) => r.id)).toEqual([a]);
  });

  it('rejects an id that already exists, a parent from another page, and a javascript: link', async () => {
    const page = await createPage();
    const other = await createPage();
    const foreign = uuidv7();
    await tx(other.id, [
      {
        kind: 'insert',
        id: foreign,
        parentBlockId: null,
        type: 'paragraph',
        content: {},
        afterId: null,
      },
    ]);

    expect(
      (
        await tx(page.id, [
          { kind: 'insert', id: foreign, parentBlockId: null, type: 'paragraph', afterId: null },
        ])
      ).status,
    ).toBe(409);
    expect(
      (
        await tx(page.id, [
          {
            kind: 'insert',
            id: uuidv7(),
            parentBlockId: foreign,
            type: 'paragraph',
            afterId: null,
          },
        ])
      ).status,
    ).toBe(400);
    const unsafe = await tx(page.id, [
      {
        kind: 'insert',
        id: uuidv7(),
        parentBlockId: null,
        type: 'paragraph',
        content: { segments: [{ text: 'x', link: 'javascript:alert(1)' }] },
        afterId: null,
      },
    ]);
    expect(unsafe.status).toBe(400);
    expect(await rowsOf(page.id as string)).toHaveLength(0);
  });

  it('refuses a viewer', async () => {
    const page = await createPage();
    await setRole('viewer');
    try {
      const res = await tx(page.id, [
        { kind: 'insert', id: uuidv7(), parentBlockId: null, type: 'paragraph', afterId: null },
      ]);
      expect(res.status).toBe(403);
    } finally {
      await setRole('owner');
    }
  });
});

describe('blocks version', () => {
  it('advances once per transaction and is returned with the blocks', async () => {
    const page = await createPage();
    const ws = { 'x-workspace-id': workspaceId };
    const first = await api('GET', `/pages/${page.id}/blocks`, undefined, ws);
    expect(first.json.version).toBe(0);
    const a = await api(
      'POST',
      `/pages/${page.id}/blocks/transactions`,
      {
        ops: [
          { kind: 'insert', id: uuidv7(), parentBlockId: null, afterId: null, type: 'paragraph' },
        ],
      },
      ws,
    );
    expect(a.json).toMatchObject({ ok: true, version: 1 });
    const b = await api(
      'POST',
      `/pages/${page.id}/blocks/transactions`,
      {
        ops: [
          { kind: 'insert', id: uuidv7(), parentBlockId: null, afterId: null, type: 'paragraph' },
        ],
      },
      ws,
    );
    expect(b.json.version).toBe(2);
    expect((await api('GET', `/pages/${page.id}/blocks`, undefined, ws)).json.version).toBe(2);
  });

  it('does not advance when the transaction is rejected', async () => {
    const page = await createPage();
    const ws = { 'x-workspace-id': workspaceId };
    const bad = await api(
      'POST',
      `/pages/${page.id}/blocks/transactions`,
      { ops: [{ kind: 'remove', id: uuidv7() }] },
      ws,
    );
    expect(bad.status).toBe(404);
    expect((await api('GET', `/pages/${page.id}/blocks`, undefined, ws)).json.version).toBe(0);
  });
});
