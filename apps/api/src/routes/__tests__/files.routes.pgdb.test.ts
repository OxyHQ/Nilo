/**
 * Attachments in Oxy's file manager against PostgreSQL: recording a file on a
 * page, who gets URLs for it (members, a copy of its block, a share link, a
 * published page) and who does not (another workspace, a page that never held
 * it), and the cache that spares Oxy's mint limit.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from '@oxy.so/db';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';

/** Files their owners linked to Nilo in Oxy, and what Oxy measured. */
const linked = new Map<string, { mime: string; size: number }>();
const linkedDownloadUrls = vi.fn(async (ids: string[]) =>
  ids.flatMap((id) => {
    const file = linked.get(id);
    return file
      ? [
          {
            id,
            url: `https://files.example.test/${id}?sig=${uuidv7()}`,
            expiresIn: 300,
            sha256: 'x',
            ...file,
          },
        ]
      : [];
  }),
);

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
    assets: { linkedDownloadUrls: (ids: string[]) => linkedDownloadUrls(ids) },
  },
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: filesRouter } = await import('../files.js');
const { default: publishRouter } = await import('../publish.js');
const { default: shareLinksRouter } = await import('../share-links.js');
const { default: pagesRouter } = await import('../pages.js');
const { default: blocksRouter } = await import('../blocks.js');
const { resetLocalFileUrls } = await import('../../lib/files.js');

let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let otherWorkspaceId: string;
let previousUrl: string | undefined;
let previousPublicUrl: string | undefined;
const OWNER = 'files-owner';
const VIEWER = 'files-viewer';
const STRANGER = 'files-stranger';

async function api(user: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(user && { 'x-test-user': user }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function page(title: string, inWorkspace = workspaceId, user = OWNER): Promise<string> {
  const res = await api(user, 'POST', '/pages', { workspaceId: inWorkspace, title });
  return (res.json.page as { id: string }).id;
}

async function imageBlock(pageId: string, fileId: string, user = OWNER): Promise<void> {
  const res = await api(user, 'POST', `/pages/${pageId}/blocks/transactions`, {
    ops: [
      {
        kind: 'insert',
        id: uuidv7(),
        parentBlockId: null,
        afterId: null,
        type: 'image',
        content: { fileId, caption: 'A diagram' },
      },
    ],
  });
  expect(res.status).toBe(200);
}

/** A file uploaded to Oxy and linked to Nilo by its owner, then recorded on `pageId`. */
async function attach(pageId: string, user = OWNER): Promise<string> {
  const fileId = uuidv7().replace(/-/g, '').slice(0, 24);
  linked.set(fileId, { mime: 'image/png', size: 2048 });
  const res = await api(user, 'POST', `/pages/${pageId}/files`, { fileId, name: 'diagram.png' });
  expect(res.status).toBe(201);
  return fileId;
}

const urlsFor = async (user: string | null, path: string, body: unknown) =>
  ((await api(user, 'POST', path, body)).json.files as { id: string; url: string }[]) ?? [];

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  previousPublicUrl = process.env.OXYNILO_PUBLIC_URL;
  process.env.OXYNILO_PUBLIC_URL = 'https://nilo.example.test';
  const [ws, other] = await db
    .insert(workspaces)
    .values([
      { name: testScope('files'), ownerId: OWNER },
      { name: testScope('files-other'), ownerId: STRANGER },
    ])
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
  otherWorkspaceId = other.id;
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: OWNER, role: 'owner' },
    { workspaceId, userId: VIEWER, role: 'viewer' },
    { workspaceId: otherWorkspaceId, userId: STRANGER, role: 'owner' },
  ]);
  const app = express();
  app.use(express.json());
  app.use(filesRouter);
  app.use(publishRouter);
  app.use(shareLinksRouter);
  app.use(blocksRouter);
  app.use('/pages', pagesRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => resetLocalFileUrls());

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousUrl;
  process.env.OXYNILO_PUBLIC_URL = previousPublicUrl;
});

describe('recording an attachment', () => {
  it('takes what Oxy measured and answers with a first URL', async () => {
    const target = await page('Notes');
    const fileId = uuidv7().replace(/-/g, '').slice(0, 24);
    linked.set(fileId, { mime: 'image/webp', size: 1234 });
    const res = await api(OWNER, 'POST', `/pages/${target}/files`, { fileId, name: 'photo.webp' });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ fileId, name: 'photo.webp', mime: 'image/webp', size: 1234 });
    expect(res.json.url).toMatch(/^https:\/\/files\.example\.test\//);
    expect(res.json.expiresIn).toBeGreaterThan(200);
  });

  it('refuses a file Oxy will not serve to Nilo, and a reader of the page', async () => {
    const target = await page('Notes');
    expect(
      (await api(OWNER, 'POST', `/pages/${target}/files`, { fileId: 'not-linked', name: 'x' }))
        .status,
    ).toBe(422);
    linked.set('linked-but-viewer', { mime: 'image/png', size: 1 });
    expect(
      (
        await api(VIEWER, 'POST', `/pages/${target}/files`, {
          fileId: 'linked-but-viewer',
          name: 'x',
        })
      ).status,
    ).toBe(403);
  });

  it('keeps a file in the workspace that recorded it first', async () => {
    const mine = await page('Mine');
    const fileId = await attach(mine);
    const theirs = await page('Theirs', otherWorkspaceId, STRANGER);
    const res = await api(STRANGER, 'POST', `/pages/${theirs}/files`, { fileId, name: 'stolen' });
    expect(res.status).toBe(409);
  });
});

describe('URLs for readers', () => {
  it('serve members who can read the page, nobody else', async () => {
    const target = await page('Report');
    const fileId = await attach(target);
    const path = `/pages/${target}/files/urls`;
    expect((await urlsFor(VIEWER, path, { ids: [fileId] })).map((f) => f.id)).toEqual([fileId]);
    expect((await api(STRANGER, 'POST', path, { ids: [fileId] })).status).toBe(403);
    expect((await api(null, 'POST', path, { ids: [fileId] })).status).toBe(401);
  });

  it('follow a copy of the block to another page of the workspace, not to other workspaces', async () => {
    const original = await page('Original');
    const fileId = await attach(original);
    const copy = await page('Copy');
    expect(await urlsFor(OWNER, `/pages/${copy}/files/urls`, { ids: [fileId] })).toEqual([]);
    await imageBlock(copy, fileId);
    expect((await urlsFor(OWNER, `/pages/${copy}/files/urls`, { ids: [fileId] })).length).toBe(1);

    // Someone who learnt the id cannot read it through a block of their own workspace.
    const theirs = await page('Theirs', otherWorkspaceId, STRANGER);
    await imageBlock(theirs, fileId, STRANGER);
    expect(await urlsFor(STRANGER, `/pages/${theirs}/files/urls`, { ids: [fileId] })).toEqual([]);
  });

  it('serve whoever holds a live share link, until it is revoked', async () => {
    const target = await page('Shared');
    const fileId = await attach(target);
    const created = await api(OWNER, 'POST', `/pages/${target}/share`, { scope: 'read' });
    const link = created.json.shareLink as { id: string; token: string };
    const path = `/share/${link.token}/files/urls`;
    expect((await urlsFor(null, path, { ids: [fileId] })).length).toBe(1);
    await api(OWNER, 'DELETE', `/share-links/${link.id}`);
    expect((await api(null, 'POST', path, { ids: [fileId] })).status).toBe(410);
  });

  it('serve anyone reading a published page or its subpages', async () => {
    const site = await page('Site');
    const fileId = await attach(site);
    const sub = (await api(OWNER, 'POST', '/pages', { workspaceId, title: 'Sub', parentId: site }))
      .json.page as { id: string };
    const subFile = await attach(sub.id);
    const path = (slug: string) => `/public/pages/${slug}/files/urls`;
    expect((await api(null, 'POST', path('no-such-site'), { ids: [fileId] })).status).toBe(404);

    const slug = (await api(OWNER, 'POST', `/pages/${site}/publish`)).json.slug as string;
    expect((await urlsFor(null, path(slug), { ids: [fileId, subFile] })).map((f) => f.id)).toEqual([
      fileId,
    ]);
    expect(
      (await urlsFor(null, path(slug), { pageId: sub.id, ids: [subFile] })).map((f) => f.id),
    ).toEqual([subFile]);
  });

  it('reuse a minted URL instead of asking Oxy again', async () => {
    const target = await page('Cached');
    const fileId = await attach(target);
    resetLocalFileUrls();
    linkedDownloadUrls.mockClear();
    const path = `/pages/${target}/files/urls`;
    const first = await urlsFor(OWNER, path, { ids: [fileId] });
    const second = await urlsFor(OWNER, path, { ids: [fileId] });
    expect(second[0]?.url).toBe(first[0]?.url);
    expect(linkedDownloadUrls).toHaveBeenCalledTimes(1);
  });
});
