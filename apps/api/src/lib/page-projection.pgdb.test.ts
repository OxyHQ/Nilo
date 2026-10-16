/**
 * What a page still has to project lives in the database: an update marks
 * the page, a projection clears the mark and records who edited from the
 * updates themselves, and the sweep projects a page no process had waiting
 * (its task stopped, its projection failed) or one an older image left
 * unmarked.
 */
import { uuidv7 } from '@oxy.so/db';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  closeTestDb,
  getTestDb,
  seedWorkspace,
  type TestDatabase,
  testDatabaseUrl,
} from '../db/__tests__/testDatabase.js';
import { closeDb, getDb } from '../db/client.js';
import { blocks, pageDocs, pages } from '../db/schema/pages.js';
import { appendUpdate, loadPageState } from './page-docs.js';
import {
  projectPage,
  reconcileProjections,
  SWEEP_AFTER_MS,
  sweepProjections,
} from './page-projection.js';

vi.mock('../socket.js', () => ({ getIO: () => null }));
vi.mock('./notification-service.js', () => ({ sendNotification: vi.fn() }));

let db: TestDatabase;
let workspaceId: string;
let previousUrl: string | undefined;

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  workspaceId = await seedWorkspace(db, 'page-projection');
});

afterAll(async () => {
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousUrl;
});

async function page(): Promise<string> {
  const [row] = await db
    .insert(pages)
    .values({ workspaceId, ownerId: 'owner', title: 'Projected' })
    .returning({ id: pages.id });
  return row?.id as string;
}

/** An update that adds a paragraph to the page, as an editor would send it. */
async function paragraph(pageId: string, text: string): Promise<Uint8Array> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, (await loadPageState(getDb(), pageId)).state);
  const before = Y.encodeStateVector(doc);
  const block = new Y.Map<unknown>();
  doc.getMap<Y.Map<unknown>>('blocks').set(uuidv7(), block);
  block.set('type', 'paragraph');
  block.set('parent', null);
  block.set('index', `a${text.replace(/[^0-9A-Za-z]/g, 'x')}`);
  block.set('props', new Y.Map());
  const ytext = new Y.Text();
  block.set('text', ytext);
  ytext.insert(0, text);
  return Y.encodeStateAsUpdate(doc, before);
}

const docRow = async (pageId: string) =>
  (await db.select().from(pageDocs).where(eq(pageDocs.pageId, pageId)))[0];

const rowTexts = async (pageId: string) =>
  (await db.select().from(blocks).where(eq(blocks.pageId, pageId)))
    .map((row) => (row.content as { text?: string }).text)
    .sort();

/** Sweep as a task would once the marks are old enough, until this page is clean. */
async function sweepUntilClean(pageId: string): Promise<void> {
  const later = new Date(Date.now() + SWEEP_AFTER_MS + 1_000);
  // The test database is shared: other pages may be marked too.
  for (let i = 0; i < 100 && (await docRow(pageId))?.dirtySince; i += 1) {
    await sweepProjections(getDb(), later);
  }
}

describe('a page’s projection, kept in the database', () => {
  it('is marked by an update and cleared by projecting, which reads who edited from the updates', async () => {
    const pageId = await page();
    await appendUpdate(getDb(), {
      pageId,
      update: await paragraph(pageId, 'de Ana'),
      actorId: 'ana',
    });
    await appendUpdate(getDb(), {
      pageId,
      update: await paragraph(pageId, 'de Bea'),
      actorId: 'bea',
    });
    const marked = await docRow(pageId);
    expect(marked?.dirtySince).toBeInstanceOf(Date);

    await projectPage(getDb(), pageId);
    const projected = await docRow(pageId);
    expect(projected?.dirtySince).toBeNull();
    expect(projected?.projectedThroughId).toBeGreaterThan(0);
    expect(await rowTexts(pageId)).toEqual(['de Ana', 'de Bea']);
    const [row] = await db.select().from(pages).where(eq(pages.id, pageId));
    expect(row?.lastEditedBy).toBe('bea');
  });

  it('is projected by the sweep when no process had it waiting', async () => {
    const pageId = await page();
    // Appended, and the task that took it stopped before projecting it.
    await appendUpdate(getDb(), {
      pageId,
      update: await paragraph(pageId, 'huérfano'),
      actorId: 'ana',
    });
    // Too recent: the task the change reached projects it first.
    await sweepProjections(getDb());
    expect((await docRow(pageId))?.dirtySince).toBeInstanceOf(Date);

    await sweepUntilClean(pageId);
    expect((await docRow(pageId))?.dirtySince).toBeNull();
    expect(await rowTexts(pageId)).toEqual(['huérfano']);
  });

  it('marks a page an update reached unmarked, so the sweep projects it', async () => {
    const pageId = await page();
    await appendUpdate(getDb(), {
      pageId,
      update: await paragraph(pageId, 'sin marca'),
      actorId: 'ana',
    });
    // As an image from before the mark leaves it.
    await db.update(pageDocs).set({ dirtySince: null }).where(eq(pageDocs.pageId, pageId));

    expect(await reconcileProjections(getDb())).toBeGreaterThanOrEqual(1);
    expect((await docRow(pageId))?.dirtySince).toBeInstanceOf(Date);
    await sweepUntilClean(pageId);
    expect(await rowTexts(pageId)).toEqual(['sin marca']);
  });
});
