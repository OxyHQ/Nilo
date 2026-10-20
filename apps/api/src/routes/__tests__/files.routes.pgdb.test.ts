/**
 * Attachments in Oxy's file manager against PostgreSQL: recording a file on a
 * page, who gets URLs for it (members, a copy of its block, a share link, a
 * published page) and who does not (another workspace, a page that never held
 * it), and the cache that spares Oxy's mint limit. Then Nilo's side of Oxy's
 * record of who uses a file (Oxy ADR 0043): letting go of an attachment, the
 * queue that tells Oxy, the daily run, and the file events Oxy sends back.
 */
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from '@oxy.so/db';
import { eq, inArray, isNull } from 'drizzle-orm';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import {
  fileReferenceRemovals,
  fileReferenceRuns,
  oxyFileEvents,
  oxyFileStatuses,
} from '../../db/schema/files.js';
import { pageDocs, pageFiles, pages, pageVersions } from '../../db/schema/pages.js';
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

type Reference = { fileId: string; entityType: string; entityId: string };
/** What Oxy was told to remove, and whether it answers. */
const removedInOxy: Reference[] = [];
let oxyDown = false;
const removeReferences = vi.fn(async (refs: Reference[]) => {
  if (oxyDown) throw Object.assign(new Error('Oxy is down'), { status: 503 });
  removedInOxy.push(...refs);
  return refs.map((ref) => ({ ...ref, result: 'removed' as const }));
});
/** The inventories reconciliation sent, and how it answers. */
const inventories: {
  entityType: string;
  items: { fileId: string; entityId: string }[];
  dryRun: boolean;
}[] = [];
let reconcileAnswer: 'ok' | 'in_progress' = 'ok';
const reconcileReferences = vi.fn(
  async (
    entityType: string,
    items: AsyncIterable<{ fileId: string; entityId: string }>,
    options: { dryRun?: boolean },
  ) => {
    if (reconcileAnswer === 'in_progress') {
      throw Object.assign(new Error('in progress'), { status: 409 });
    }
    const sent: { fileId: string; entityId: string }[] = [];
    for await (const item of items) sent.push(item);
    inventories.push({ entityType, items: sent, dryRun: options.dryRun === true });
    return {
      sessionId: 's',
      entityType,
      dryRun: options.dryRun === true,
      added: 0,
      removed: 0,
      unchanged: sent.length,
      refused: 0,
    };
  },
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
    assets: {
      linkedDownloadUrls: (ids: string[]) => linkedDownloadUrls(ids),
      references: {
        remove: (refs: Reference[]) => removeReferences(refs),
        reconcile: (
          entityType: string,
          items: AsyncIterable<{ fileId: string; entityId: string }>,
          options: { dryRun?: boolean },
        ) => reconcileReferences(entityType, items, options),
      },
    },
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
const { drainReferenceRemovals, runDailyFileWork, runDailyFileWorkIfDue } = await import(
  '../../lib/file-references.js'
);
const { OXY_FILE_EVENTS_PATH, oxyFileEventsHandler, rawFileEventBody } = await import(
  '../oxy-file-events.js'
);
const { resetPersonalWorkspace } = await import('../../repositories/workspaces.js');

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
  app.post(OXY_FILE_EVENTS_PATH, rawFileEventBody, (req, res) => {
    void oxyFileEventsHandler(req, res);
  });
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

  it("follow a page's uploaded cover and icon to its duplicate", async () => {
    const original = await page('Covered');
    const cover = await attach(original);
    const icon = await attach(original);
    const set = await api(OWNER, 'PATCH', `/pages/${original}`, {
      cover: `file:${cover}`,
      icon: `file:${icon}`,
    });
    expect(set.status).toBe(200);
    const copy = (await api(OWNER, 'POST', `/pages/${original}/duplicate`)).json.page as {
      id: string;
    };
    const ids = (await urlsFor(VIEWER, `/pages/${copy.id}/files/urls`, { ids: [cover, icon] }))
      .map((f) => f.id)
      .sort();
    expect(ids).toEqual([cover, icon].sort());
    // A page whose cover is something else does not serve them.
    const other = await page('Plain');
    expect(await urlsFor(OWNER, `/pages/${other}/files/urls`, { ids: [cover] })).toEqual([]);
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

/** The removals queued for `fileIds`, as Oxy would be told them. */
async function queued(fileIds: string[]) {
  return db
    .select({
      fileId: fileReferenceRemovals.fileId,
      entityType: fileReferenceRemovals.entityType,
      entityId: fileReferenceRemovals.entityId,
    })
    .from(fileReferenceRemovals)
    .where(inArray(fileReferenceRemovals.fileId, fileIds));
}

/** What Oxy last said about `fileId`; no record is `active`. */
const statusOf = async (fileId: string) =>
  (await db.select().from(oxyFileStatuses).where(eq(oxyFileStatuses.fileId, fileId)))[0]?.status ??
  'active';

const recorded = async (fileId: string) =>
  (await db.select().from(pageFiles).where(eq(pageFiles.fileId, fileId)))[0];

/** Run the daily run (its sweep, then reconciliation against the mock). */
const sweep = () => runDailyFileWork(db, { graceMs: 0 });

describe('letting go of an attachment', () => {
  it('keeps it, and its Oxy reference, while its page is in the trash', async () => {
    const target = await page('Trashed');
    const fileId = await attach(target);
    expect((await api(OWNER, 'DELETE', `/pages/${target}`)).status).toBe(200);
    await sweep();
    expect(await recorded(fileId)).toBeDefined();
    expect(await queued([fileId])).toEqual([]);
  });

  it('keeps it past its page while a copy of its block holds it, then lets it go', async () => {
    const original = await page('Original');
    const fileId = await attach(original);
    const copy = await page('Copy');
    await imageBlock(copy, fileId);
    expect((await api(OWNER, 'DELETE', `/pages/${original}?hard=true`)).status).toBe(200);

    // The page is gone, the attachment and the page its reference names are not.
    expect((await recorded(fileId))?.pageId).toBe(original);
    await sweep();
    expect(await recorded(fileId)).toBeDefined();
    expect((await urlsFor(OWNER, `/pages/${copy}/files/urls`, { ids: [fileId] })).length).toBe(1);

    expect((await api(OWNER, 'DELETE', `/pages/${copy}?hard=true`)).status).toBe(200);
    await sweep();
    expect(await recorded(fileId)).toBeUndefined();
    expect(await queued([fileId])).toEqual([{ fileId, entityType: 'page', entityId: original }]);
  });

  it("keeps it past its page while another page's cover holds it", async () => {
    const original = await page('Cover source');
    const fileId = await attach(original);
    const holder = await page('Cover holder');
    await api(OWNER, 'PATCH', `/pages/${holder}`, { cover: `file:${fileId}` });
    expect((await api(OWNER, 'DELETE', `/pages/${original}?hard=true`)).status).toBe(200);
    await sweep();
    expect(await recorded(fileId)).toBeDefined();

    await api(OWNER, 'PATCH', `/pages/${holder}`, { cover: null });
    await sweep();
    expect(await recorded(fileId)).toBeUndefined();
  });

  it('keeps it while a kept version or an unprojected document of another page holds it', async () => {
    const original = await page('Versioned');
    const fileId = await attach(original);
    const holder = await page('Holder');
    await db.insert(pageVersions).values({
      pageId: holder,
      blocksVersion: 1,
      blocks: [{ id: uuidv7(), parentBlockId: null, type: 'image', content: { fileId }, order: 1 }],
      createdBy: OWNER,
    });
    const other = await attach(original);
    const docHolder = await page('Doc holder');
    await db
      .insert(pageDocs)
      .values({ pageId: docHolder, state: Buffer.from(`\u0001yjs:${other}\u0000`, 'utf8') })
      .onConflictDoUpdate({
        target: pageDocs.pageId,
        set: { state: Buffer.from(`\u0001yjs:${other}\u0000`, 'utf8') },
      });
    expect((await api(OWNER, 'DELETE', `/pages/${original}?hard=true`)).status).toBe(200);
    await sweep();
    expect(await recorded(fileId)).toBeDefined();
    expect(await recorded(other)).toBeDefined();
    expect(await queued([fileId, other])).toEqual([]);
  });

  it('queues the removal whatever deletes the row: a reset of the personal workspace', async () => {
    const owner = testScope('files-reset');
    const [personal] = await db
      .insert(workspaces)
      .values({ name: testScope('files-personal'), ownerId: owner, isPersonal: true })
      .returning();
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: personal.id, userId: owner, role: 'owner' });
    const target = await page('Reset me', personal.id, owner);
    const fileId = await attach(target, owner);
    await resetPersonalWorkspace(db, personal, 'Personal');
    expect(await recorded(fileId)).toBeUndefined();
    expect(await queued([fileId])).toEqual([{ fileId, entityType: 'page', entityId: target }]);
  });

  it('queues nothing for a row recorded before page ids were kept', async () => {
    const target = await page('Legacy');
    const fileId = await attach(target);
    await db.update(pageFiles).set({ pageId: null }).where(eq(pageFiles.fileId, fileId));
    await db.delete(pageFiles).where(eq(pageFiles.fileId, fileId));
    expect(await queued([fileId])).toEqual([]);
  });
});

describe("a page's files property (Noted's attachments)", () => {
  const attachments = (...fileIds: string[]) => ({
    attachments: {
      files: [
        ...fileIds.map((fileId) => ({ name: 'a', fileId })),
        { name: 'l', url: 'https://x.test/l' },
      ],
    },
  });

  it('lets go of a file taken out of the property, unless the page was also given it', async () => {
    const note = await page('Note');
    const uploaded = await attach(note);
    await db
      .update(pages)
      .set({ properties: attachments('noted-a', 'noted-b', uploaded) })
      .where(eq(pages.id, note));
    await db
      .update(pages)
      .set({ properties: attachments('noted-b') })
      .where(eq(pages.id, note));
    expect(await queued(['noted-a', 'noted-b', uploaded])).toEqual([
      { fileId: 'noted-a', entityType: 'page', entityId: note },
    ]);
  });

  it('lets go of every listed file when the page is deleted for good', async () => {
    const note = await page('Erased note');
    await db
      .update(pages)
      .set({ properties: attachments('noted-c') })
      .where(eq(pages.id, note));
    expect((await api(OWNER, 'DELETE', `/pages/${note}`)).status).toBe(200);
    expect(await queued(['noted-c'])).toEqual([]);
    expect((await api(OWNER, 'DELETE', `/pages/${note}?hard=true`)).status).toBe(200);
    expect(await queued(['noted-c'])).toEqual([
      { fileId: 'noted-c', entityType: 'page', entityId: note },
    ]);
  });

  it('keeps an uploaded file referenced while the page still lists it', async () => {
    const note = await page('Listed upload');
    const uploaded = await attach(note);
    await db
      .update(pages)
      .set({ properties: attachments(uploaded) })
      .where(eq(pages.id, note));
    await db.delete(pageFiles).where(eq(pageFiles.fileId, uploaded));
    expect(await queued([uploaded])).toEqual([]);
  });

  it('are in the inventory reconciliation sends', async () => {
    const note = await page('Inventoried note');
    await db
      .update(pages)
      .set({ properties: attachments('noted-d') })
      .where(eq(pages.id, note));
    await db.delete(pageFiles).where(isNull(pageFiles.pageId));
    inventories.length = 0;
    await runDailyFileWork(db, { graceMs: 0 });
    expect(inventories[0]?.items).toContainEqual({ fileId: 'noted-d', entityId: note });
  });
});

describe('telling Oxy', () => {
  it('sends each queued removal once, and keeps it while Oxy cannot be told', async () => {
    await db.delete(fileReferenceRemovals);
    const target = await page('Told');
    const fileId = await attach(target);
    await db.delete(pageFiles).where(eq(pageFiles.fileId, fileId));
    removedInOxy.length = 0;

    oxyDown = true;
    const now = new Date();
    expect(await drainReferenceRemovals(db, now)).toEqual({ sent: 0, deferred: 1 });
    const [waiting] = await db
      .select()
      .from(fileReferenceRemovals)
      .where(eq(fileReferenceRemovals.fileId, fileId));
    expect(waiting?.attempts).toBe(1);
    expect(waiting?.lastError).toBe('Oxy is down');
    expect(waiting?.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    // Not due yet: nothing is sent.
    oxyDown = false;
    expect(await drainReferenceRemovals(db, now)).toEqual({ sent: 0, deferred: 0 });

    const later = new Date(now.getTime() + 2 * 60_000);
    expect(await drainReferenceRemovals(db, later)).toEqual({ sent: 1, deferred: 0 });
    expect(removedInOxy).toEqual([{ fileId, entityType: 'page', entityId: target }]);
    expect(await queued([fileId])).toEqual([]);
  });

  // `next_attempt_at` defaults to the database's clock, in microseconds; the
  // drain's clock is JavaScript's, in milliseconds, and may run behind it. A
  // minute behind stands for both, deterministically.
  it('sends a removal never tried at once, on a task whose clock is behind the database’s', async () => {
    await db.delete(fileReferenceRemovals);
    const target = await page('Fresh removal');
    const fileId = await attach(target);
    await db.delete(pageFiles).where(eq(pageFiles.fileId, fileId));
    removedInOxy.length = 0;

    const behind = new Date(Date.now() - 60_000);
    expect(await drainReferenceRemovals(db, behind)).toEqual({ sent: 1, deferred: 0 });
    expect(removedInOxy).toEqual([{ fileId, entityType: 'page', entityId: target }]);
    expect(await queued([fileId])).toEqual([]);
  });

  it('leases what it claims, so a second task does not send it too', async () => {
    await db.delete(fileReferenceRemovals);
    await db.insert(fileReferenceRemovals).values({
      fileId: 'leased-file',
      entityType: 'page',
      entityId: 'p',
      nextAttemptAt: new Date(Date.now() - 60_000),
    });
    let release: () => void = () => {};
    removeReferences.mockImplementationOnce(
      (refs) =>
        new Promise((resolve) => {
          release = () => resolve(refs.map((ref) => ({ ...ref, result: 'removed' as const })));
        }),
    );
    const first = drainReferenceRemovals(db);
    await vi.waitFor(() =>
      expect(removeReferences).toHaveBeenLastCalledWith([
        { fileId: 'leased-file', entityType: 'page', entityId: 'p' },
      ]),
    );
    expect(await drainReferenceRemovals(db)).toEqual({ sent: 0, deferred: 0 });
    release();
    expect(await first).toEqual({ sent: 1, deferred: 0 });
  });
});

describe('the daily run', () => {
  it('reconciles the page references and commits', async () => {
    const target = await page('Inventory');
    const fileId = await attach(target);
    // A row naming no page (another test's) would hold the commit back.
    await db.delete(pageFiles).where(isNull(pageFiles.pageId));

    inventories.length = 0;
    const report = await runDailyFileWork(db, { graceMs: 0 });
    expect(report.reconcile).toMatchObject({ dryRun: false, unnamed: 0 });
    expect(inventories.map((run) => [run.entityType, run.dryRun])).toEqual([['page', false]]);
    expect(inventories[0]?.items).toContainEqual({ fileId, entityId: target });
  });

  it('will not commit while an attachment names no page, nor fail on a run in progress', async () => {
    const target = await page('Unnamed');
    const fileId = await attach(target);
    await imageBlock(target, fileId);
    await db.update(pageFiles).set({ pageId: null }).where(eq(pageFiles.fileId, fileId));
    inventories.length = 0;
    const report = await runDailyFileWork(db, { graceMs: 0 });
    expect(report.reconcile).toMatchObject({ dryRun: true });
    expect(inventories[0]?.dryRun).toBe(true);
    expect(inventories[0]?.items.map((item) => item.fileId)).not.toContain(fileId);
    // Still held by its block, the sweep kept it; done with it now.
    await db.delete(pageFiles).where(eq(pageFiles.fileId, fileId));

    reconcileAnswer = 'in_progress';
    try {
      const busy = await runDailyFileWork(db, { graceMs: 0 });
      expect(busy.reconcile).toMatchObject({ skipped: 'in_progress' });
    } finally {
      reconcileAnswer = 'ok';
    }
  });

  it('runs once a day, whichever task asks', async () => {
    await db.delete(fileReferenceRuns).where(eq(fileReferenceRuns.job, 'nightly'));
    const now = new Date();
    const first = await runDailyFileWorkIfDue(db, { graceMs: 0, now });
    expect(first).not.toBeNull();
    expect(await runDailyFileWorkIfDue(db, { graceMs: 0, now })).toBeNull();
    const tomorrow = new Date(now.getTime() + 25 * 60 * 60_000);
    expect(await runDailyFileWorkIfDue(db, { graceMs: 0, now: tomorrow })).not.toBeNull();
  });

  it('asks Oxy again about a file marked trashed, in case its restore was never delivered', async () => {
    const target = await page('Restored');
    const fileId = await attach(target);
    await db
      .insert(oxyFileStatuses)
      .values({ fileId, status: 'trash', statusAt: new Date(Date.now() - 60_000) });
    resetLocalFileUrls();
    await sweep();
    expect(await statusOf(fileId)).toBe('active');
  });
});

const SECRET = 'whsec_test';

async function deliver(event: unknown, secret = SECRET) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const res = await fetch(`${base}${OXY_FILE_EVENTS_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'oxy-signature': `t=${t},v1=${v1}` },
    body,
  });
  return { status: res.status, text: await res.text() };
}

const fileEvent = (fileId: string, type: string, status: string, occurredAt: Date) => ({
  id: uuidv7(),
  type,
  occurredAt: occurredAt.toISOString(),
  file: { id: fileId, ownerKind: 'account', visibility: 'private', status },
  references: [{ entityType: 'page', entityId: 'p' }],
});

describe('file events from Oxy', () => {
  let previousSecret: string | undefined;
  beforeAll(() => {
    previousSecret = process.env.OXY_FILES_WEBHOOK_SECRET;
    process.env.OXY_FILES_WEBHOOK_SECRET = SECRET;
  });
  afterAll(() => {
    process.env.OXY_FILES_WEBHOOK_SECRET = previousSecret;
  });

  it('answer the endpoint challenge, even before a secret is configured', async () => {
    process.env.OXY_FILES_WEBHOOK_SECRET = '';
    try {
      const res = await fetch(`${base}${OXY_FILE_EVENTS_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'webhook.challenge', challenge: 'c-123' }),
      });
      expect(await res.json()).toEqual({ challenge: 'c-123' });
      // Any real event waits in Oxy's retries until the secret is set.
      expect((await deliver(fileEvent('x', 'file.deleted', 'deleted', new Date()))).status).toBe(
        503,
      );
    } finally {
      process.env.OXY_FILES_WEBHOOK_SECRET = SECRET;
    }
  });

  it('refuse a request Oxy did not sign', async () => {
    expect(
      (await deliver(fileEvent('x', 'file.deleted', 'deleted', new Date()), 'whsec_wrong')).status,
    ).toBe(401);
  });

  it('show a taken-down file as removed to readers, and stop asking Oxy for it', async () => {
    const target = await page('Takedown');
    const fileId = await attach(target);
    const path = `/pages/${target}/files/urls`;
    const event = fileEvent(fileId, 'file.blocked', 'blocked', new Date());
    expect((await deliver(event)).status).toBe(204);
    expect(await statusOf(fileId)).toBe('blocked');

    resetLocalFileUrls();
    linkedDownloadUrls.mockClear();
    const answer = (await api(VIEWER, 'POST', path, { ids: [fileId] })).json;
    expect(answer).toEqual({ files: [], removed: [fileId] });
    expect(linkedDownloadUrls).not.toHaveBeenCalled();

    // A redelivery is acknowledged and changes nothing.
    expect((await deliver(event)).status).toBe(204);
    const seen = await db.select().from(oxyFileEvents).where(eq(oxyFileEvents.eventId, event.id));
    expect(seen.length).toBe(1);
  });

  it('never let an older event overwrite a newer one', async () => {
    const target = await page('Out of order');
    const fileId = await attach(target);
    const now = Date.now();
    await deliver(fileEvent(fileId, 'file.restored', 'active', new Date(now)));
    await deliver(fileEvent(fileId, 'file.trashed', 'trash', new Date(now - 60_000)));
    expect(await statusOf(fileId)).toBe('active');
    await deliver(fileEvent(fileId, 'file.deleted', 'deleted', new Date(now + 60_000)));
    expect(await statusOf(fileId)).toBe('deleted');
    expect(
      (await api(OWNER, 'POST', `/pages/${target}/files/urls`, { ids: [fileId] })).json.removed,
    ).toEqual([fileId]);
  });

  it('acknowledge an event about a file Nilo does not hold', async () => {
    expect(
      (await deliver(fileEvent('not-nilos', 'file.visibility_changed', 'active', new Date())))
        .status,
    ).toBe(204);
  });
});
