import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uuidv7 } from '@oxy.so/db';
import type { PageActivityPage } from '@oxy.so/nilo-contracts';
import { eq } from 'drizzle-orm';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  closeTestDb,
  getTestDb,
  testDatabaseUrl,
  testScope,
  type TestDatabase,
} from '../../db/__tests__/testDatabase.js';
import { closeDb } from '../../db/client.js';
import { pageActivity } from '../../db/schema/page-activity.js';
import { pagePermissions } from '../../db/schema/collab.js';
import { databases } from '../../db/schema/databases.js';
import { pages } from '../../db/schema/pages.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import { createPage, findPageById, updatePage } from '../../repositories/pages.js';
import { listPageActivity } from '../../repositories/pageActivity.js';

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
}));
const { default: activityRouter } = await import('../page-activity.js');
let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let previousUrl: string | undefined;
const owner = testScope('activity-owner');

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'Activity tests', ownerId: owner })
    .returning();
  workspaceId = ws.id;
  await db.insert(workspaceMembers).values({ workspaceId, userId: owner, role: 'owner' });
  const app = express();
  app.use(activityRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousUrl;
});
const makePage = (parentId?: string) =>
  createPage(db, { workspaceId, ownerId: owner, title: 'Original', order: 0, parentId });
async function request(id: string, user: string | null = owner, query = '') {
  return fetch(`${base}/pages/${id}/activity${query}`, {
    headers: user ? { 'x-test-user': user } : {},
  });
}
async function grant(pageId: string, userId: string, role: 'viewer' | 'commenter' | 'editor') {
  await db.insert(pagePermissions).values({ pageId, userId, role, grantedBy: owner });
}

describe('durable page activity', () => {
  it('records creation and actual metadata/property differences, excluding no-ops and personal ordering', async () => {
    const page = await makePage();
    await updatePage(db, page.id, {
      title: 'Renamed',
      icon: '📖',
      mergeProperties: { status: { optionId: 'done' } },
      lastEditedBy: owner,
    });
    await updatePage(db, page.id, {
      title: 'Renamed',
      icon: '📖',
      mergeProperties: { status: { optionId: 'done' } },
      order: 20,
      lastEditedBy: owner,
    });
    const result = await listPageActivity(db, page.id, 20);
    expect(result.items.map((event) => event.kind).sort()).toEqual([
      'created',
      'metadata_changed',
      'properties_changed',
    ]);
    expect(result.items.every((event) => event.actorIds.join() === owner)).toBe(true);
    expect(result.items.find((event) => event.kind === 'metadata_changed')?.changes).toEqual([
      { field: 'title', before: 'Original', after: 'Renamed' },
      { field: 'icon', before: null, after: '📖' },
    ]);
    expect(result.items.find((event) => event.kind === 'properties_changed')?.changes).toEqual([
      { field: 'properties', propertyId: 'status', before: null, after: { optionId: 'done' } },
    ]);
  });

  it('rolls back the event and page together, including nested canonical writes', async () => {
    const page = await makePage();
    await expect(
      db.transaction(async (tx) => {
        await updatePage(tx, page.id, { title: 'Should roll back', lastEditedBy: owner });
        throw new Error('Abort');
      }),
    ).rejects.toThrow('Abort');
    expect((await findPageById(db, page.id))?.title).toBe('Original');
    expect((await listPageActivity(db, page.id, 20)).items).toHaveLength(1);
    const id = uuidv7();
    await expect(
      db.transaction(async (tx) => {
        await createPage(tx, {
          id,
          workspaceId,
          ownerId: owner,
          title: 'Aborted creation',
          order: 0,
        });
        throw new Error('Abort creation');
      }),
    ).rejects.toThrow('Abort creation');
    expect(await findPageById(db, id)).toBeUndefined();
    expect((await listPageActivity(db, id, 20)).items).toEqual([]);
  });

  it('reads before values under the same lock, so concurrent edits form a real chain', async () => {
    const page = await makePage();
    await Promise.all(
      ['First', 'Second'].map((title) => updatePage(db, page.id, { title, lastEditedBy: owner })),
    );
    const events = (await listPageActivity(db, page.id, 20)).items.filter(
      (event) => event.kind === 'metadata_changed',
    );
    expect(events).toHaveLength(2);
    const first = events.find((event) => event.changes[0]?.before === 'Original');
    expect(first).toBeDefined();
    const next = events.find((event) => event.id !== first?.id);
    expect(next?.changes[0]?.before).toBe(first?.changes[0]?.after);
    expect(next?.changes[0]?.after).toBe((await findPageById(db, page.id))?.title);
  });

  it('does not invent creation events for existing rows or people for anonymous forms', async () => {
    const [old] = await db
      .insert(pages)
      .values({ workspaceId, ownerId: owner, title: 'Predates capture' })
      .returning();
    expect((await listPageActivity(db, old.id, 20)).items).toEqual([]);
    const response = await createPage(db, { workspaceId, ownerId: 'form:anonymous', order: 0 });
    expect((await listPageActivity(db, response.id, 20)).items[0]?.actorIds).toEqual([]);
  });

  it('paginates timestamp ties without duplicates, scopes cursors and rejects malformed bounds', async () => {
    const page = await makePage();
    for (const title of ['A', 'B', 'C'])
      await updatePage(db, page.id, { title, lastEditedBy: owner });
    await db
      .update(pageActivity)
      .set({ createdAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(pageActivity.pageId, page.id));
    const first = (await (await request(page.id, owner, '?limit=2')).json()) as PageActivityPage;
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = (await (
      await request(page.id, owner, `?limit=2&cursor=${first.nextCursor}`)
    ).json()) as PageActivityPage;
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((event) => event.id)).size).toBe(4);
    const other = await makePage();
    expect((await request(other.id, owner, `?cursor=${first.nextCursor}`)).status).toBe(400);
    for (const query of ['?cursor=garbage', '?limit=0', '?limit=51', '?limit=1.5'])
      expect((await request(page.id, owner, query)).status).toBe(400);
  });

  it('enforces editor access for direct and inherited grants and immediately reflects downgrade', async () => {
    const parent = await makePage();
    const child = await makePage(parent.id);
    await updatePage(db, child.id, { title: 'Historical secret', lastEditedBy: owner });
    for (const role of ['viewer', 'commenter', 'editor'] as const) {
      const direct = testScope(role);
      const inherited = testScope(role);
      await grant(child.id, direct, role);
      await grant(parent.id, inherited, role);
      for (const user of [direct, inherited]) {
        const response = await request(child.id, user);
        expect(response.status).toBe(role === 'editor' ? 200 : 403);
        if (role !== 'editor')
          expect(JSON.stringify(await response.json())).not.toContain('Historical secret');
      }
      if (role === 'editor') {
        await db
          .update(pagePermissions)
          .set({ role: 'viewer' })
          .where(eq(pagePermissions.userId, direct));
        expect((await request(child.id, direct)).status).toBe(403);
      }
    }
    expect((await request(child.id)).status).toBe(200);
    expect((await request(child.id, null)).status).toBe(401);
    expect((await request(child.id, 'outsider')).status).toBe(403);
    // The canonical access guard conceals absent and inaccessible pages alike.
    expect((await request(uuidv7())).status).toBe(403);
  });

  it('lets a row-only editor read only that row, without exposing database schema or sibling events', async () => {
    const [database] = await db
      .insert(databases)
      .values({
        workspaceId,
        ownerId: owner,
        name: 'Secret database',
        propertiesSchema: {
          properties: [
            {
              id: 'privatePropertyId',
              name: 'Historical field name',
              type: 'select',
              config: { options: [{ id: 'option', name: 'Historical option', color: 'blue' }] },
            },
          ],
        },
      })
      .returning();
    const row = await createPage(db, {
      workspaceId,
      databaseId: database.id,
      ownerId: owner,
      order: 0,
    });
    const other = await createPage(db, {
      workspaceId,
      databaseId: database.id,
      ownerId: owner,
      order: 1,
    });
    const guest = testScope('row-editor');
    await grant(row.id, guest, 'editor');
    await updatePage(db, row.id, {
      mergeProperties: { privatePropertyId: { optionId: 'option' } },
      lastEditedBy: owner,
    });
    await db
      .update(databases)
      .set({
        propertiesSchema: {
          properties: [
            {
              id: 'privatePropertyId',
              name: 'New field name',
              type: 'number',
              config: { format: 'percent' },
            },
          ],
        },
      })
      .where(eq(databases.id, database.id));
    const ownerResult = (await (await request(row.id)).json()) as PageActivityPage;
    expect(
      ownerResult.items.find((event) => event.kind === 'properties_changed')?.changes[0]?.property,
    ).toEqual({
      name: 'Historical field name',
      type: 'select',
      config: { options: [{ id: 'option', name: 'Historical option', color: 'blue' }] },
    });
    const response = await request(row.id, guest);
    expect(response.status).toBe(200);
    const text = JSON.stringify(await response.json());
    expect(text).toContain('privatePropertyId');
    expect(text).not.toContain('Secret database');
    expect(text).not.toContain('Historical field name');
    expect(text).not.toContain('Historical option');
    expect(text).not.toContain('New field name');
    expect(text).not.toContain(other.id);
    expect((await request(other.id, guest)).status).toBe(403);
  });

  it('removes activity with its page', async () => {
    const page = await makePage();
    await db.delete(pages).where(eq(pages.id, page.id));
    expect((await listPageActivity(db, page.id, 20)).items).toEqual([]);
  });
});
