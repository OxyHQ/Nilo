/**
 * Page-level access against PostgreSQL, through the real routes and the real
 * membership check: restricted pages, grants and their inheritance, guests,
 * share links that hand out access, and the limits on who may share what.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from '@oxy.so/db';
import { eq } from 'drizzle-orm';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { databases } from '../../db/schema/databases.js';
import { pages } from '../../db/schema/pages.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';

const notified = vi.hoisted(() => [] as { userId: string; type: string }[]);

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
    // Oxy profiles: every user's avatar is a file id derived from their id.
    users: {
      getMany: async (ids: string[]) => ids.map((id) => ({ id, avatar: `avatar-of-${id}` })),
    },
    // The real limiters resolve an optional session through this; anonymous here.
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
  },
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/notification-service.js', () => ({
  sendNotification: vi.fn(async (options: { userId: string; type: string }) => {
    notified.push({ userId: options.userId, type: options.type });
    return {};
  }),
}));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: pagesRouter } = await import('../pages.js');
const { default: blocksRouter } = await import('../blocks.js');
const { default: pagePermissionsRouter } = await import('../page-permissions.js');
const { default: shareLinksRouter } = await import('../share-links.js');
const { default: backlinksRouter } = await import('../backlinks.js');
const { default: followsRouter } = await import('../page-follows.js');
const { default: commentsRouter } = await import('../comments.js');
const { default: databasesRouter } = await import('../databases.js');

let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let previous: { databaseUrl?: string; publicUrl?: string } = {};

// The cast: an owner, an admin, an editor and a viewer of the workspace, and
// a guest who belongs to none of it.
const OWNER = 'share-owner';
const ADMIN = 'share-admin';
const EDITOR = 'share-editor';
const VIEWER = 'share-viewer';
const GUEST = 'share-guest';

interface ApiResponse {
  status: number;
  json: Record<string, never> & Record<string, unknown>;
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
      'x-test-user': user,
      'x-workspace-id': workspaceId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

async function page(
  user: string,
  input: { parentId?: string; title?: string } = {},
): Promise<string> {
  const res = await api(user, 'POST', '/pages', { workspaceId, ...input });
  expect(res.status).toBe(201);
  return (res.json.page as { id: string }).id;
}

const share = (user: string, pageId: string, to: string, role: string) =>
  api(user, 'PUT', `/pages/${pageId}/permissions/${to}`, { role });

const listIds = async (user: string) =>
  (
    (await api(user, 'GET', `/pages?workspaceId=${workspaceId}`)).json.pages as { id: string }[]
  ).map((p) => p.id);

beforeAll(async () => {
  db = await getTestDb();
  previous = { databaseUrl: process.env.DATABASE_URL, publicUrl: process.env.OXYNILO_PUBLIC_URL };
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.OXYNILO_PUBLIC_URL = 'https://nilo.example.test';

  const scope = testScope('sharing');
  const [ws] = await db
    .insert(workspaces)
    .values({ name: scope, ownerId: OWNER })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: OWNER, role: 'owner' },
    { workspaceId, userId: ADMIN, role: 'admin' },
    { workspaceId, userId: EDITOR, role: 'editor' },
    { workspaceId, userId: VIEWER, role: 'viewer' },
  ]);

  const app = express();
  app.use(express.json());
  app.use(shareLinksRouter);
  app.use(backlinksRouter);
  app.use(followsRouter);
  app.use(commentsRouter);
  app.use(pagePermissionsRouter);
  app.use(blocksRouter);
  app.use('/pages', pagesRouter);
  app.use('/databases', databasesRouter);
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

describe('restricted pages', () => {
  it('shut out members without a grant, keep owners and admins, and keep whoever restricted it', async () => {
    const secret = await page(EDITOR, { title: 'secret' });
    const inside = await page(EDITOR, { parentId: secret });
    expect((await api(EDITOR, 'PATCH', `/pages/${secret}`, { restricted: true })).status).toBe(200);

    // The editor who restricted it holds a grant now.
    expect((await api(EDITOR, 'GET', `/pages/${inside}`)).status).toBe(200);
    for (const user of [OWNER, ADMIN])
      expect((await api(user, 'GET', `/pages/${inside}`)).status).toBe(200);

    const shut = await api(VIEWER, 'GET', `/pages/${secret}`);
    expect(shut.status).toBe(403);
    expect(shut.json.code).toBe('NO_PAGE_ACCESS');
    expect((await api(VIEWER, 'GET', `/pages/${inside}/blocks`)).status).toBe(403);
    expect(await listIds(VIEWER)).not.toContain(secret);
    expect(await listIds(VIEWER)).not.toContain(inside);
    expect(await listIds(OWNER)).toContain(inside);
  });

  it('may only be restricted with full access or by its creator', async () => {
    const mine = await page(OWNER);
    const res = await api(EDITOR, 'PATCH', `/pages/${mine}`, { restricted: true });
    expect(res.status).toBe(403);
    expect(res.json.required).toBe('admin');
  });

  it('cut off grants from above them', async () => {
    const top = await page(OWNER);
    const locked = await page(OWNER, { parentId: top });
    await api(OWNER, 'PATCH', `/pages/${locked}`, { restricted: true });
    await share(OWNER, top, GUEST, 'viewer');
    expect((await api(GUEST, 'GET', `/pages/${top}`)).status).toBe(200);
    expect((await api(GUEST, 'GET', `/pages/${locked}`)).status).toBe(403);
  });
});

describe('sharing with a guest', () => {
  it('opens the page and its subtree, nothing else, at the granted role', async () => {
    const parent = await page(OWNER, { title: 'parent' });
    const shared = await page(OWNER, { parentId: parent, title: 'shared' });
    const child = await page(OWNER, { parentId: shared, title: 'child' });
    const sibling = await page(OWNER, { parentId: parent, title: 'sibling' });

    expect((await share(OWNER, shared, GUEST, 'viewer')).status).toBe(200);
    expect(notified).toContainEqual({ userId: GUEST, type: 'page_shared' });

    const opened = await api(GUEST, 'GET', `/pages/${child}`);
    expect(opened.status).toBe(200);
    expect(opened.json.role).toBe('viewer');
    expect((await api(GUEST, 'GET', `/pages/${sibling}`)).status).toBe(403);
    expect((await api(GUEST, 'GET', `/pages/${parent}`)).status).toBe(403);

    // The path to it stays private.
    const crumbs = (await api(GUEST, 'GET', `/pages/${child}/breadcrumb`)).json.breadcrumb as {
      id: string;
    }[];
    expect(crumbs.map((c) => c.id)).toEqual([shared, child]);

    // A viewer writes nothing.
    const write = await api(GUEST, 'POST', `/pages/${child}/blocks/transactions`, {
      ops: [
        {
          kind: 'insert',
          id: uuidv7(),
          parentBlockId: null,
          afterId: null,
          type: 'paragraph',
          content: {},
        },
      ],
    });
    expect(write.status).toBe(403);

    // Listed under "shared with me", with roles.
    const sharedList = (await api(GUEST, 'GET', '/pages/shared')).json.shared as {
      workspace: { id: string };
      pages: { id: string; role: string }[];
    }[];
    const listed =
      sharedList.find((s) => s.workspace.id === workspaceId)?.pages.map((p) => p.id) ?? [];
    expect(listed).toEqual(expect.arrayContaining([shared, child]));
    expect(listed).not.toContain(parent);
    expect(listed).not.toContain(sibling);
  });

  it("shows a shared personal workspace with its owner's avatar until it has its own", async () => {
    const owner = 'share-personal-owner';
    const [personal] = await db
      .insert(workspaces)
      .values({ name: testScope('personal'), ownerId: owner, isPersonal: true })
      .returning({ id: workspaces.id });
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: personal.id, userId: owner, role: 'owner' });
    const created = await api(owner, 'POST', '/pages', { workspaceId: personal.id, title: 'mine' });
    expect(created.status).toBe(201);
    const pageId = (created.json.page as { id: string }).id;
    expect((await share(owner, pageId, GUEST, 'viewer')).status).toBe(200);

    const avatarOf = async () =>
      (
        (await api(GUEST, 'GET', '/pages/shared')).json.shared as {
          workspace: { id: string; avatar: string | null };
        }[]
      ).find((s) => s.workspace.id === personal.id)?.workspace.avatar;

    expect(await avatarOf()).toBe(`avatar-of-${owner}`);
    await db
      .update(workspaces)
      .set({ avatar: 'own-picture' })
      .where(eq(workspaces.id, personal.id));
    expect(await avatarOf()).toBe('own-picture');
  });

  it('lets an editor guest write and add subpages, but not top-level pages', async () => {
    const shared = await page(OWNER);
    await share(OWNER, shared, GUEST, 'editor');
    const write = await api(GUEST, 'POST', `/pages/${shared}/blocks/transactions`, {
      ops: [
        {
          kind: 'insert',
          id: uuidv7(),
          parentBlockId: null,
          afterId: null,
          type: 'paragraph',
          content: {},
        },
      ],
    });
    expect(write.status).toBe(200);
    expect((await api(GUEST, 'POST', '/pages', { workspaceId, parentId: shared })).status).toBe(
      201,
    );
    expect((await api(GUEST, 'POST', '/pages', { workspaceId })).status).toBe(403);
  });
});

describe('who may share what', () => {
  it('lets nobody give more than they hold, and viewers give nothing', async () => {
    const target = await page(OWNER);
    expect((await share(VIEWER, target, GUEST, 'viewer')).status).toBe(403);
    const tooMuch = await share(EDITOR, target, GUEST, 'admin');
    expect(tooMuch.status).toBe(403);
    expect((await share(EDITOR, target, GUEST, 'editor')).status).toBe(200);
  });

  it('lists who has access, with inherited grants marked', async () => {
    const top = await page(OWNER);
    const below = await page(OWNER, { parentId: top });
    await share(OWNER, top, GUEST, 'commenter');
    const res = await api(EDITOR, 'GET', `/pages/${below}/permissions`);
    expect(res.status).toBe(200);
    expect(res.json.openToWorkspace).toBe(true);
    expect(res.json.grants).toEqual([
      expect.objectContaining({
        userId: GUEST,
        role: 'commenter',
        inheritedFrom: top,
        viaShareLink: false,
      }),
    ]);
  });

  it('refuses an email that names no Oxy user, creating nobody', async () => {
    const target = await page(OWNER);
    const res = await api(OWNER, 'POST', `/pages/${target}/permissions`, {
      email: 'nobody@example.test',
      role: 'viewer',
    });
    expect(res.status).toBe(404);
    expect(res.json.code).toBe('USER_NOT_FOUND');
  });

  it('lets a person leave a page shared with them', async () => {
    const target = await page(OWNER);
    await share(OWNER, target, GUEST, 'viewer');
    expect((await api(GUEST, 'DELETE', `/pages/${target}/permissions/${GUEST}`)).status).toBe(200);
    expect((await api(GUEST, 'GET', `/pages/${target}`)).status).toBe(403);
  });
});

describe('share links', () => {
  it('hand out their scope to whoever opens them, until revoked', async () => {
    const target = await page(OWNER);
    const created = await api(OWNER, 'POST', `/pages/${target}/share`, { scope: 'edit' });
    expect(created.status).toBe(201);
    const link = created.json.shareLink as { id: string; token: string };

    const joined = await api(GUEST, 'POST', `/share/${link.token}/join`);
    expect(joined.status).toBe(200);
    expect(joined.json.role).toBe('editor');
    expect((await api(GUEST, 'GET', `/pages/${target}`)).json.role).toBe('editor');

    expect((await api(OWNER, 'DELETE', `/share-links/${link.id}`)).status).toBe(200);
    expect((await api(GUEST, 'GET', `/pages/${target}`)).status).toBe(403);
    expect((await api(GUEST, 'POST', `/share/${link.token}/join`)).status).toBe(410);
  });

  it('never lowers the access someone already has', async () => {
    const target = await page(OWNER);
    const created = await api(OWNER, 'POST', `/pages/${target}/share`, { scope: 'read' });
    const token = (created.json.shareLink as { token: string }).token;
    expect((await api(EDITOR, 'POST', `/share/${token}/join`)).json.role).toBe('editor');
  });
});

describe('duplicating a restricted page', () => {
  it('keeps it restricted to the same people', async () => {
    const source = await page(OWNER);
    await share(OWNER, source, GUEST, 'viewer');
    await api(OWNER, 'PATCH', `/pages/${source}`, { restricted: true });
    const copy = await api(OWNER, 'POST', `/pages/${source}/duplicate`);
    expect(copy.status).toBe(201);
    const copyId = (copy.json.page as { id: string; restricted: boolean }).id;
    expect((copy.json.page as { restricted: boolean }).restricted).toBe(true);
    expect((await api(VIEWER, 'GET', `/pages/${copyId}`)).status).toBe(403);
    expect((await api(GUEST, 'GET', `/pages/${copyId}`)).status).toBe(200);
  });
});

describe('database rows', () => {
  it('are as private as the page their inline database sits in', async () => {
    const host = await page(OWNER, { title: 'host' });
    const [database] = await db
      .insert(databases)
      .values({ workspaceId, name: 'Inline', ownerId: OWNER, isInline: true, parentPageId: host })
      .returning({ id: databases.id });
    const [row] = await db
      .insert(pages)
      .values({ workspaceId, ownerId: OWNER, title: 'row', databaseId: database?.id })
      .returning({ id: pages.id });
    expect((await api(VIEWER, 'GET', `/pages/${row?.id}`)).status).toBe(200);

    await api(OWNER, 'PATCH', `/pages/${host}`, { restricted: true });
    expect((await api(VIEWER, 'GET', `/pages/${row?.id}`)).status).toBe(403);
    expect(await listIds(VIEWER)).not.toContain(row?.id);
    // A grant on the host page reaches its rows.
    await share(OWNER, host, GUEST, 'viewer');
    expect((await api(GUEST, 'GET', `/pages/${row?.id}`)).status).toBe(200);
  });
});

describe('backlinks', () => {
  it('lists the pages that link to or mention a page, among those the caller can open', async () => {
    const target = await page(OWNER, { title: 'Target' });
    const viaBlock = await page(OWNER, { title: 'Via block' });
    const viaMention = await page(OWNER, { title: 'Via mention' });
    const viaLink = await page(OWNER, { title: 'Via link' });
    const secret = await page(OWNER, { title: 'Secret' });
    const insert = (pageId: string, type: string, content: Record<string, unknown>) =>
      api(OWNER, 'POST', `/pages/${pageId}/blocks/transactions`, {
        ops: [{ kind: 'insert', id: uuidv7(), parentBlockId: null, afterId: null, type, content }],
      });
    await insert(viaBlock, 'link_to_page', { pageId: target });
    await insert(viaMention, 'paragraph', {
      segments: [
        { text: 'see ' },
        { text: 'Target', mention: { indicator: '@', attributes: { kind: 'page', id: target } } },
      ],
    });
    await insert(viaLink, 'paragraph', { segments: [{ text: 'here', link: `/p/${target}` }] });
    await insert(secret, 'link_to_page', { pageId: target });
    await api(OWNER, 'PATCH', `/pages/${secret}`, { restricted: true });

    const titles = async (user: string) =>
      (
        (await api(user, 'GET', `/pages/${target}/backlinks`)).json.backlinks as {
          page: { title: string };
        }[]
      )
        .map((b) => b.page.title)
        .sort();
    expect(await titles(OWNER)).toEqual(['Secret', 'Via block', 'Via link', 'Via mention']);
    expect(await titles(VIEWER)).toEqual(['Via block', 'Via link', 'Via mention']);
  });

  it('quotes the first block that points here in reading order, nested ones included', async () => {
    const target = await page(OWNER, { title: 'Quoted' });
    const from = await page(OWNER, { title: 'From' });
    const [toggle, after, a, b, inside] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
    const mention = (text: string) => ({
      segments: [
        { text: `${text} ` },
        { text: 'Quoted', mention: { indicator: '@', attributes: { kind: 'page', id: target } } },
      ],
    });
    // The nested mention comes first on the page, though its own order (third
    // in the toggle) is larger than the later top-level block's (second).
    const insert = (
      id: string,
      parentBlockId: string | null,
      afterId: string | null,
      content = {},
    ) => ({
      kind: 'insert',
      id,
      parentBlockId,
      afterId,
      type: id === toggle ? 'toggle' : 'paragraph',
      content,
    });
    await api(OWNER, 'POST', `/pages/${from}/blocks/transactions`, {
      ops: [
        insert(toggle, null, null, { text: 'T' }),
        insert(after, null, toggle, mention('later')),
        insert(a, toggle, null),
        insert(b, toggle, a),
        insert(inside, toggle, b, mention('first')),
      ],
    });
    const [backlink] = (await api(OWNER, 'GET', `/pages/${target}/backlinks`)).json.backlinks as {
      text: string;
    }[];
    expect(backlink?.text.startsWith('first')).toBe(true);
  });
});

describe('following pages', () => {
  it('follows what you create and comment on, and tells followers of new comments', async () => {
    const target = await page(OWNER, { title: 'Followed' });
    expect((await api(OWNER, 'GET', `/pages/${target}/follow`)).json.following).toBe(true);
    expect((await api(VIEWER, 'GET', `/pages/${target}/follow`)).json.following).toBe(false);
    expect((await api(VIEWER, 'PUT', `/pages/${target}/follow`)).json.following).toBe(true);

    notified.length = 0;
    const comment = await api(EDITOR, 'POST', `/pages/${target}/comments`, {
      content: { segments: [{ type: 'text', text: 'Looks good' }] },
    });
    expect(comment.status).toBe(201);
    await new Promise((r) => setTimeout(r, 50));
    expect(
      notified
        .filter((n) => n.type === 'page_comment')
        .map((n) => n.userId)
        .sort(),
    ).toEqual([OWNER, VIEWER].sort());
    // The commenter follows it now.
    expect((await api(EDITOR, 'GET', `/pages/${target}/follow`)).json.following).toBe(true);
    expect((await api(VIEWER, 'DELETE', `/pages/${target}/follow`)).json.following).toBe(false);
  });

  it('tells people newly mentioned in the text who can open the page, once', async () => {
    const target = await page(OWNER, { title: 'Plan' });
    const block = uuidv7();
    const mention = (id: string) => ({
      text: `@${id}`,
      mention: { indicator: '@', attributes: { kind: 'user', id } },
    });
    const write = (ops: unknown[]) =>
      api(OWNER, 'POST', `/pages/${target}/blocks/transactions`, { ops });
    notified.length = 0;
    const first = await write([
      {
        kind: 'insert',
        id: block,
        parentBlockId: null,
        afterId: null,
        type: 'paragraph',
        content: {
          text: 'ask',
          segments: [{ text: 'ask ' }, mention(VIEWER), mention(GUEST), mention(OWNER)],
        },
      },
    ]);
    expect(first.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    // Not the writer, not a guest the page is not shared with.
    expect(notified.filter((n) => n.type === 'mention')).toEqual([
      { userId: VIEWER, type: 'mention' },
    ]);

    // Still mentioned after an edit, and in another block: not again.
    notified.length = 0;
    await write([
      {
        kind: 'update',
        id: block,
        content: { text: 'now', segments: [{ text: 'now ' }, mention(VIEWER)] },
      },
      {
        kind: 'insert',
        id: uuidv7(),
        parentBlockId: null,
        afterId: block,
        type: 'paragraph',
        content: { text: 'again', segments: [mention(VIEWER)] },
      },
    ]);
    await new Promise((r) => setTimeout(r, 50));
    expect(notified.filter((n) => n.type === 'mention')).toEqual([]);
  });

  it('takes emoji reactions on comments from those who may comment', async () => {
    const target = await page(OWNER, { title: 'Reacted' });
    const made = await api(OWNER, 'POST', `/pages/${target}/comments`, {
      content: { segments: [{ type: 'text', text: 'Ship it?' }] },
    });
    const id = (made.json.comment as { id: string }).id;
    const thumbs = encodeURIComponent('👍');
    expect((await api(EDITOR, 'PUT', `/comments/${id}/reactions/${thumbs}`)).status).toBe(200);
    const both = await api(OWNER, 'PUT', `/comments/${id}/reactions/${thumbs}`);
    expect(both.json.reactions).toEqual([{ emoji: '👍', userIds: [EDITOR, OWNER] }]);
    // Not words; not a viewer.
    expect((await api(OWNER, 'PUT', `/comments/${id}/reactions/yes`)).status).toBe(400);
    expect((await api(VIEWER, 'PUT', `/comments/${id}/reactions/${thumbs}`)).status).toBe(403);

    const listed = await api(OWNER, 'GET', `/pages/${target}/comments`);
    const [comment] = listed.json.comments as { reactions: unknown }[];
    expect(comment?.reactions).toEqual([{ emoji: '👍', userIds: [EDITOR, OWNER] }]);
    const taken = await api(EDITOR, 'DELETE', `/comments/${id}/reactions/${thumbs}`);
    expect(taken.json.reactions).toEqual([{ emoji: '👍', userIds: [OWNER] }]);
  });

  it('tells the followers who can open a page that it was edited, once in a while', async () => {
    const target = await page(OWNER, { title: 'Roadmap' });
    expect((await api(VIEWER, 'PUT', `/pages/${target}/follow`)).status).toBe(200);
    const edit = () =>
      api(EDITOR, 'POST', `/pages/${target}/blocks/transactions`, {
        ops: [
          {
            kind: 'insert',
            id: uuidv7(),
            parentBlockId: null,
            afterId: null,
            type: 'paragraph',
            content: {},
          },
        ],
      });
    notified.length = 0;
    expect((await edit()).status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    const edited = () =>
      notified
        .filter((n) => n.type === 'page_edited')
        .map((n) => n.userId)
        .sort();
    // The creator and the follower; not the editor.
    expect(edited()).toEqual([OWNER, VIEWER].sort());
    // Typing on: nothing more for now.
    expect((await edit()).status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(edited()).toEqual([OWNER, VIEWER].sort());
  });

  it('lets whoever may edit a page keep their own views of a database linked there', async () => {
    const created = await api(OWNER, 'POST', '/databases', { workspaceId, name: 'Roadmap' });
    const databaseId = (created.json.database as { id: string }).id;
    // A workspace viewer may only read the database, but may edit this page.
    const host = await page(OWNER, { title: 'My board' });
    await share(OWNER, host, VIEWER, 'editor');
    const blockId = uuidv7();
    const placed = await api(VIEWER, 'POST', `/pages/${host}/blocks/transactions`, {
      ops: [
        {
          kind: 'insert',
          id: blockId,
          parentBlockId: null,
          afterId: null,
          type: 'inline_database',
          content: { databaseId },
        },
      ],
    });
    expect(placed.status).toBe(200);

    const linked = await api(VIEWER, 'POST', `/databases/${databaseId}/views`, {
      name: 'Mine',
      type: 'table',
      blockId,
    });
    expect(linked.status).toBe(201);
    const viewId = (linked.json.view as { id: string }).id;
    // The database's own views stay its editors'.
    expect(
      (await api(VIEWER, 'POST', `/databases/${databaseId}/views`, { name: 'No', type: 'table' }))
        .status,
    ).toBe(403);
    const own = (await api(OWNER, 'GET', `/databases/${databaseId}/views`)).json.views as {
      id: string;
    }[];
    expect(own.map((v) => v.id)).not.toContain(viewId);
    const block = (await api(VIEWER, 'GET', `/databases/${databaseId}/views?blockId=${blockId}`))
      .json.views as { id: string }[];
    expect(block.map((v) => v.id)).toEqual([viewId]);
    expect(
      (
        await api(VIEWER, 'PATCH', `/databases/${databaseId}/views/${viewId}`, {
          sorts: [{ propertyId: 'name', direction: 'desc' }],
        })
      ).status,
    ).toBe(200);
    expect(
      (await api(VIEWER, 'GET', `/databases/${databaseId}/rows?viewId=${viewId}`)).status,
    ).toBe(200);

    // The block gone, its views go too.
    await api(VIEWER, 'POST', `/pages/${host}/blocks/transactions`, {
      ops: [{ kind: 'remove', id: blockId }],
    });
    expect((await api(OWNER, 'GET', `/databases/${databaseId}/rows?viewId=${viewId}`)).status).toBe(
      404,
    );
  });
});
