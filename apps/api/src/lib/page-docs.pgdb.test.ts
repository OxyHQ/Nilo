/**
 * A page's document against PostgreSQL: a page that predates it is stored
 * from its rows exactly once, compaction loses nothing, and what may not be
 * appended is refused.
 */
import { materialize } from '@oxy.so/bloom-editor/yjs';
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
import { blocks, pageDocs, pages, pageUpdates } from '../db/schema/pages.js';
import {
  appendUpdate,
  compactPage,
  loadPageDoc,
  loadPageState,
  PageDocRejected,
} from './page-docs.js';
import { projectPage } from './page-projection.js';

vi.mock('../socket.js', () => ({ getIO: () => null }));
vi.mock('./notification-service.js', () => ({ sendNotification: vi.fn() }));

let db: TestDatabase;
let workspaceId: string;
let previousUrl: string | undefined;

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  workspaceId = await seedWorkspace(db, 'page-docs');
});

afterAll(async () => {
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousUrl;
});

async function page(locked = false): Promise<string> {
  const [row] = await db
    .insert(pages)
    .values({ workspaceId, ownerId: 'owner', title: 'Doc', locked })
    .returning({ id: pages.id });
  return row?.id as string;
}

const texts = (doc: Y.Doc) => {
  const document = materialize(doc);
  const out: string[] = [];
  const visit = (ids: readonly string[]) => {
    for (const id of ids) {
      out.push((document.blocks[id]?.text ?? []).map((s) => s.text).join(''));
      visit(document.blocks[id]?.children ?? []);
    }
  };
  visit(document.root);
  return out;
};

/** An update that adds a paragraph to `state`, as an editor would send it. */
function paragraphAfter(state: Uint8Array, text: string): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const before = Y.encodeStateVector(doc);
  const block = new Y.Map<unknown>();
  doc.getMap<Y.Map<unknown>>('blocks').set(uuidv7(), block);
  block.set('type', 'paragraph');
  block.set('parent', null);
  block.set('index', `a${text.length}${text}`.replace(/[^0-9A-Za-z]/g, 'x'));
  block.set('props', new Y.Map());
  const ytext = new Y.Text();
  block.set('text', ytext);
  ytext.insert(0, text);
  return Y.encodeStateAsUpdate(doc, before);
}

describe('a page that predates its document', () => {
  it('is stored from its rows once, however many readers arrive first at once', async () => {
    const pageId = await page();
    const parent = uuidv7();
    await db.insert(blocks).values([
      {
        id: parent,
        pageId,
        type: 'toggle',
        content: { text: 'Uno', segments: [{ text: 'Uno' }] },
        order: 1,
      },
      {
        id: uuidv7(),
        pageId,
        parentBlockId: parent,
        type: 'paragraph',
        content: { text: 'Dos', segments: [{ text: 'Dos', bold: true }] },
        order: 1,
      },
    ]);
    const states = await Promise.all(
      Array.from({ length: 5 }, () => loadPageState(getDb(), pageId)),
    );
    const doc = new Y.Doc();
    for (const { state } of states) Y.applyUpdate(doc, state);
    expect(texts(doc)).toEqual(['Uno', 'Dos']);
    expect(await db.select().from(pageDocs).where(eq(pageDocs.pageId, pageId))).toHaveLength(1);
  });
});

describe('appending and compacting', () => {
  it('keeps every update through a compaction, and folds only what the rows show', async () => {
    const pageId = await page();
    let state = (await loadPageState(getDb(), pageId)).state;
    for (const word of ['alfa', 'beta', 'gamma']) {
      const update = paragraphAfter(state, word);
      await appendUpdate(getDb(), { pageId, update, actorId: 'owner' });
      state = Y.mergeUpdates([state, update]);
    }
    const waiting = () => db.select().from(pageUpdates).where(eq(pageUpdates.pageId, pageId));
    // Not projected yet: who made them is still needed.
    await compactPage(getDb(), pageId, true);
    expect(await waiting()).toHaveLength(3);
    await projectPage(getDb(), pageId);
    await compactPage(getDb(), pageId, true);
    expect(await waiting()).toHaveLength(0);
    await appendUpdate(getDb(), {
      pageId,
      update: paragraphAfter(state, 'delta'),
      actorId: 'owner',
    });
    expect(texts(await loadPageDoc(getDb(), pageId)).sort()).toEqual([
      'alfa',
      'beta',
      'delta',
      'gamma',
    ]);
  });

  it('refuses a malformed update, an empty one, and any update to a locked page', async () => {
    const pageId = await page();
    await expect(
      appendUpdate(getDb(), {
        pageId,
        update: new Uint8Array([1, 2, 3, 250, 250]),
        actorId: 'owner',
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      appendUpdate(getDb(), { pageId, update: new Uint8Array(), actorId: 'owner' }),
    ).rejects.toBeInstanceOf(PageDocRejected);
    const lockedId = await page(true);
    const { state } = await loadPageState(getDb(), lockedId);
    await expect(
      appendUpdate(getDb(), {
        pageId: lockedId,
        update: paragraphAfter(state, 'x'),
        actorId: 'owner',
      }),
    ).rejects.toMatchObject({ status: 423, code: 'PAGE_LOCKED' });
  });
});
