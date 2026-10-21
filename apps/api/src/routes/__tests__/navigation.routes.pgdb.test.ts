import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NavigationNeighbors } from '@oxy.so/nilo-contracts';
import { eq } from 'drizzle-orm';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import {
  closeTestDb,
  getTestDb,
  seedWorkspace,
  testDatabaseUrl,
  type TestDatabase,
} from '../../db/__tests__/testDatabase.js';
import { pagePermissions } from '../../db/schema/collab.js';
import { databases } from '../../db/schema/databases.js';
import { pages } from '../../db/schema/pages.js';
import { teamspaces } from '../../db/schema/teamspaces.js';
import { workspaceMembers } from '../../db/schema/workspaces.js';
import { createPage } from '../../repositories/pages.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticateToken: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const id = req.header('x-test-user');
    if (id) req.user = { id };
    next();
  },
}));
vi.mock('../../lib/logger.js', () => ({ log: { general: { error: vi.fn() } } }));
const { default: router } = await import('../navigation.js');
let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let oldUrl: string | undefined;
const OWNER = 'navigation-owner';
const MEMBER = 'navigation-member';
const GUEST = 'navigation-guest';
const page = (title: string, extra: Partial<Parameters<typeof createPage>[1]> = {}) =>
  createPage(db, { workspaceId, title, ownerId: OWNER, order: 0, teamspaceId: null, ...extra });
async function database(name: string, extra: Partial<typeof databases.$inferInsert> = {}) {
  const [result] = await db
    .insert(databases)
    .values({ workspaceId, name, ownerId: OWNER, ...extra })
    .returning();
  return result;
}
async function api(path: string, user: string | null = OWNER) {
  const res = await fetch(`${base}${path}`, { headers: user ? { 'x-test-user': user } : {} });
  return { status: res.status, body: (await res.json()) as NavigationNeighbors };
}
async function grant(pageId: string, userId = GUEST) {
  await db.insert(pagePermissions).values({ pageId, userId, role: 'viewer', grantedBy: OWNER });
}
beforeAll(async () => {
  db = await getTestDb();
  oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  workspaceId = await seedWorkspace(db, 'navigation');
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: OWNER, role: 'owner' },
    { workspaceId, userId: MEMBER, role: 'viewer' },
  ]);
  const app = express();
  app.use(router);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await closeDb();
  await closeTestDb();
  if (oldUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = oldUrl;
});

describe('authorized navigation neighbors', () => {
  it('mixes sibling pages and databases, with real links and the queried anchor', async () => {
    const parent = await page('Parent');
    const a = await page('A', { parentId: parent.id });
    const b = await database('B', { parentPageId: parent.id });
    await page('Unrelated');
    await page('Archived', { parentId: parent.id, archived: true });
    await page('Template', { parentId: parent.id, template: true });
    const result = await api(`/pages/${a.id}/neighbors`);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      items: [
        { kind: 'page', id: a.id, title: 'A', icon: null, href: `/p/${a.id}`, current: true },
        { kind: 'database', id: b.id, title: 'B', icon: null, href: `/db/${b.id}`, current: false },
      ],
      nextCursor: null,
    });
    const dbResult = await api(`/databases/${b.id}/neighbors`);
    expect(dbResult.body.items.map((item) => [item.id, item.current])).toEqual([
      [a.id, false],
      [b.id, true],
    ]);
  });

  it('fills each page after permissions, continuing beyond a full batch of private siblings', async () => {
    const parent = await page('Private parent');
    const hidden = Array.from({ length: 40 }, (_, i) => ({
      workspaceId,
      ownerId: OWNER,
      title: `hidden ${i}`,
      parentId: parent.id,
      order: 0,
    }));
    await db.insert(pages).values(hidden);
    const visible = [];
    for (let i = 0; i < 4; i += 1) {
      const entry = await page(`shared ${i}`, { parentId: parent.id });
      await grant(entry.id);
      visible.push(entry);
    }
    const first = await api(`/pages/${visible[0]?.id}/neighbors?limit=2`, GUEST);
    expect(first.body.items.map((item) => item.id)).toEqual(
      visible.slice(0, 2).map((item) => item.id),
    );
    expect(first.body.nextCursor).toEqual(expect.any(String));
    expect(Buffer.from(first.body.nextCursor as string, 'base64url').toString()).not.toContain(
      parent.id,
    );
    // Inserting a later sibling and renaming an existing one cannot shift an offset.
    const later = await page('Later', { parentId: parent.id });
    await grant(later.id);
    await db
      .update(pages)
      .set({ title: 'Renamed' })
      .where(eq(pages.id, visible[0]?.id as string));
    const second = await api(
      `/pages/${visible[0]?.id}/neighbors?limit=3&cursor=${first.body.nextCursor}`,
      GUEST,
    );
    expect(second.body.items.map((item) => item.id)).toEqual([
      ...visible.slice(2).map((item) => item.id),
      later.id,
    ]);
    expect(second.body.nextCursor).toBeNull();
  });

  it('keeps a stable kind tie-breaker even when page and database IDs coincide', async () => {
    const parent = await page('Tie parent');
    const a = await page('Same id page', { parentId: parent.id });
    await database('Same id database', { id: a.id, parentPageId: parent.id });
    const first = await api(`/pages/${a.id}/neighbors?limit=1`);
    expect(first.body.items[0]?.kind).toBe('database');
    const second = await api(`/pages/${a.id}/neighbors?limit=1&cursor=${first.body.nextCursor}`);
    expect(second.body.items).toEqual([
      expect.objectContaining({ id: a.id, kind: 'page', current: true }),
    ]);
    expect(second.body.nextCursor).toBeNull();
  });

  it('does not enumerate a database through a row-only grant', async () => {
    const d = await database('Private database');
    const a = await page('Shared row', { databaseId: d.id });
    await page('Private row', { databaseId: d.id });
    await grant(a.id);
    const result = await api(`/pages/${a.id}/neighbors`, GUEST);
    expect(result.body.items.map((item) => item.id)).toEqual([a.id]);
    expect(result.body.nextCursor).toBeNull();
    expect((await api(`/databases/${d.id}/neighbors`, GUEST)).status).toBe(403);
  });

  it('enumerates authorized rows only after access to their database and honors restricted rows', async () => {
    const parent = await page('Shared database host');
    await grant(parent.id);
    const d = await database('Rows', { parentPageId: parent.id });
    const a = await page('First', { databaseId: d.id });
    const b = await page('Second', { databaseId: d.id });
    const restricted = await page('Restricted', { databaseId: d.id });
    await db.update(pages).set({ restricted: true }).where(eq(pages.id, restricted.id));
    await page('Elsewhere', { parentId: parent.id });
    const result = await api(`/pages/${a.id}/neighbors`, GUEST);
    expect(result.body.items.map((item) => item.id)).toEqual([a.id, b.id]);
  });

  it('scopes root siblings to their teamspace or private owner and never another workspace', async () => {
    const [team] = await db
      .insert(teamspaces)
      .values({ workspaceId, name: 'Open', createdBy: OWNER })
      .returning();
    const [other] = await db
      .insert(teamspaces)
      .values({ workspaceId, name: 'Other', createdBy: OWNER })
      .returning();
    const a = await page('Root', { teamspaceId: team.id });
    const d = await database('Root database', { teamspaceId: team.id });
    await page('Other team', { teamspaceId: other.id });
    await page('Other workspace', { workspaceId: await seedWorkspace(db, 'navigation-other') });
    const result = await api(`/pages/${a.id}/neighbors`, MEMBER);
    expect(result.body.items.map((item) => item.id)).toEqual([a.id, d.id]);
    const privatePage = await page('My private root');
    const someone = await page('Someone private', { ownerId: MEMBER });
    await grant(someone.id, OWNER);
    expect(
      (await api(`/pages/${privatePage.id}/neighbors?limit=30`)).body.items.map((item) => item.id),
    ).not.toContain(someone.id);
  });

  it('rechecks access and cursor location on every continuation', async () => {
    const parent = await page('Old parent');
    const a = await page('First', { parentId: parent.id });
    await page('Second', { parentId: parent.id });
    await grant(parent.id);
    const first = await api(`/pages/${a.id}/neighbors?limit=1`, GUEST);
    expect(first.body.nextCursor).not.toBeNull();
    await db.delete(pagePermissions).where(eq(pagePermissions.pageId, parent.id));
    expect(
      (await api(`/pages/${a.id}/neighbors?cursor=${first.body.nextCursor}`, GUEST)).status,
    ).toBe(403);
    const newParent = await page('New parent');
    await db.update(pages).set({ parentId: newParent.id }).where(eq(pages.id, a.id));
    expect((await api(`/pages/${a.id}/neighbors?cursor=${first.body.nextCursor}`)).status).toBe(
      400,
    );
  });

  it('rejects unauthenticated, inaccessible, archived, and malformed requests', async () => {
    const a = await page('Protected');
    expect((await api(`/pages/${a.id}/neighbors`, null)).status).toBe(401);
    expect((await api(`/pages/${a.id}/neighbors`, GUEST)).status).toBe(403);
    for (const query of ['limit=0', 'limit=31', 'limit=1.5', 'cursor=bad']) {
      expect((await api(`/pages/${a.id}/neighbors?${query}`)).status).toBe(400);
    }
    expect((await api('/pages/invalid/neighbors')).status).toBe(400);
    await db.update(pages).set({ archived: true }).where(eq(pages.id, a.id));
    expect((await api(`/pages/${a.id}/neighbors`)).status).toBe(404);
  });
});
