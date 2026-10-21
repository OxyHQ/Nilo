/**
 * The ZIP export of a tree of pages against PostgreSQL: which pages go in
 * (including database row bodies, excluding templates) and how they are laid out.
 */
import { strFromU8, unzipSync } from 'fflate';
import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxy.so/db';
import * as Y from 'yjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeTestDb,
  getTestDb,
  seedWorkspace,
  type TestDatabase,
  testDatabaseUrl,
} from '../../db/__tests__/testDatabase.js';
import { closeDb } from '../../db/client.js';
import { workspaceMembers } from '../../db/schema/workspaces.js';
import { databases } from '../../db/schema/databases.js';
import { blocks, pageDocs, pages } from '../../db/schema/pages.js';
import { createBlock } from '../../repositories/blocks.js';
import { upsertGrant } from '../../repositories/pagePermissions.js';
import { createPage } from '../../repositories/pages.js';
import { parseCsv } from '../databases/csv.js';
import { appendUpdate, loadPageState } from '../page-docs.js';
import { ExportTooLarge, exportPagesZip, fileName, MAX_EXPORTED_PAGES } from '../export-zip.js';

let db: TestDatabase;
let workspaceId: string;
const me = 'export-zip-me';
let previousUrl: string | undefined;

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  workspaceId = await seedWorkspace(db, 'export-zip');
  await db.insert(workspaceMembers).values({ workspaceId, userId: me, role: 'owner' });
});

afterAll(async () => {
  await closeDb();
  await closeTestDb();
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
});

const page = (title: string, extra: Partial<Parameters<typeof createPage>[1]> = {}) =>
  createPage(db, { workspaceId, title, ownerId: me, order: 0, teamspaceId: null, ...extra });

describe('exporting pages as a ZIP', () => {
  it('exports Windows-compatible paths without changing the titles inside documents', async () => {
    const scope = await seedWorkspace(db, 'export-portable-names');
    await db.insert(workspaceMembers).values({ workspaceId: scope, userId: me, role: 'owner' });
    const reserved = await page('CON', { workspaceId: scope, order: 0 });
    await page('_CON', { workspaceId: scope, order: 1 });
    await page('AUX.txt', { workspaceId: scope, parentId: reserved.id });
    const dotted = await page('Plan. ', { workspaceId: scope, order: 2 });
    await page('Details', { workspaceId: scope, parentId: dotted.id });
    const files = unzipSync(
      (await exportPagesZip(db, { viewerId: me, workspaceId: scope, rootIds: null, format: 'md' }))
        .bytes,
    );
    expect(Object.keys(files).sort()).toEqual(
      ['_CON.md', '_CON (2).md', '_CON/_AUX.txt.md', 'Plan.md', 'Plan/Details.md'].sort(),
    );
    expect(strFromU8(files['_CON.md'] as Uint8Array)).toContain('# CON');
    expect(strFromU8(files['_CON/_AUX.txt.md'] as Uint8Array)).toContain('# AUX.txt');
  });

  it('projects acknowledged row edits before exporting their bodies', async () => {
    const scope = await seedWorkspace(db, 'export-pending-row');
    await db.insert(workspaceMembers).values({ workspaceId: scope, userId: me, role: 'owner' });
    const [database] = await db
      .insert(databases)
      .values({ workspaceId: scope, name: 'Pending edits', ownerId: me })
      .returning();
    const row = await page('Just edited', { workspaceId: scope, databaseId: database.id });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, (await loadPageState(db, row.id)).state);
    const before = Y.encodeStateVector(doc);
    const block = new Y.Map<unknown>();
    doc.getMap<Y.Map<unknown>>('blocks').set(uuidv7(), block);
    block.set('type', 'paragraph');
    block.set('parent', null);
    block.set('index', 'a0');
    block.set('props', new Y.Map());
    const text = new Y.Text();
    block.set('text', text);
    text.insert(0, 'Acknowledged edit still waiting for projection');
    await appendUpdate(db, {
      pageId: row.id,
      update: Y.encodeStateAsUpdate(doc, before),
      actorId: me,
    });
    doc.destroy();
    expect(await db.select().from(blocks).where(eq(blocks.pageId, row.id))).toEqual([]);
    const result = await exportPagesZip(db, {
      viewerId: me,
      workspaceId: scope,
      rootIds: null,
      format: 'md',
    });
    expect(
      strFromU8(unzipSync(result.bytes)['Pending edits/Just edited.md'] as Uint8Array),
    ).toContain('Acknowledged edit still waiting for projection');
    const [projected] = await db.select().from(pageDocs).where(eq(pageDocs.pageId, row.id));
    expect(projected.dirtySince).toBeNull();
  });

  it('does not promote archived database rows, their children, or nested databases to workspace roots', async () => {
    const scope = await seedWorkspace(db, 'export-archived-database');
    await db.insert(workspaceMembers).values({ workspaceId: scope, userId: me, role: 'owner' });
    const [database] = await db
      .insert(databases)
      .values({ workspaceId: scope, name: 'Archived database', ownerId: me, archived: true })
      .returning();
    const row = await page('Unarchived row flag', { workspaceId: scope, databaseId: database.id });
    await page('Child of archived database row', { workspaceId: scope, parentId: row.id });
    await db
      .insert(databases)
      .values({ workspaceId: scope, name: 'Nested database', ownerId: me, parentPageId: row.id });
    await page('Live page', { workspaceId: scope });
    const result = await exportPagesZip(db, {
      viewerId: me,
      workspaceId: scope,
      rootIds: null,
      format: 'md',
    });
    expect(Object.keys(unzipSync(result.bytes))).toEqual(['Live page.md']);
    // Excluded documents are not projected as a side effect of export.
    expect(await db.select().from(pageDocs).where(eq(pageDocs.pageId, row.id))).toEqual([]);
  });

  it('includes database row bodies and their subpages in page and workspace exports', async () => {
    const scope = await seedWorkspace(db, 'export-row-bodies');
    await db.insert(workspaceMembers).values({ workspaceId: scope, userId: me, role: 'owner' });
    const parent = await page('Project', { workspaceId: scope });
    const [database] = await db
      .insert(databases)
      .values({
        workspaceId: scope,
        name: 'Tasks',
        ownerId: me,
        parentPageId: parent.id,
        propertiesSchema: { properties: [{ id: 'name', name: 'Name', type: 'text' }] },
      })
      .returning();
    const row = await page('First task', { workspaceId: scope, databaseId: database.id });
    await createBlock(db, {
      pageId: row.id,
      type: 'paragraph',
      content: { text: 'Body absent from the CSV' },
      order: 0,
    });
    await page('Details', { workspaceId: scope, parentId: row.id });
    await page('Row template', { workspaceId: scope, databaseId: database.id, template: true });
    await page('Archived row', { workspaceId: scope, databaseId: database.id, archived: true });

    for (const rootIds of [null, [parent.id]]) {
      for (const format of ['md', 'html'] as const) {
        const result = await exportPagesZip(db, {
          viewerId: me,
          workspaceId: scope,
          rootIds,
          format,
        });
        const files = unzipSync(result.bytes);
        expect(Object.keys(files).sort()).toEqual(
          [
            `Project.${format}`,
            'Project/Tasks.csv',
            `Project/Tasks/First task.${format}`,
            `Project/Tasks/First task/Details.${format}`,
          ].sort(),
        );
        expect(strFromU8(files[`Project/Tasks/First task.${format}`] as Uint8Array)).toContain(
          'Body absent from the CSV',
        );
        expect(strFromU8(files['Project/Tasks.csv'] as Uint8Array)).toBe('Name\r\nFirst task\r\n');
        expect([...(files['Project/Tasks.csv']?.slice(0, 3) ?? [])]).toEqual([239, 187, 191]);
        expect(result.pages).toBe(3);
      }
    }
    const rowOnly = await exportPagesZip(db, {
      viewerId: me,
      workspaceId: scope,
      rootIds: [row.id],
      format: 'md',
    });
    expect(Object.keys(unzipSync(rowOnly.bytes)).sort()).toEqual([
      'First task.md',
      'First task/Details.md',
    ]);
  });

  it('keeps row-only grants private and applies row restrictions to both documents and CSV', async () => {
    const scope = await seedWorkspace(db, 'export-row-grants');
    const guest = 'export-row-guest';
    const parent = await page('Shared project', { workspaceId: scope });
    const [database] = await db
      .insert(databases)
      .values({
        workspaceId: scope,
        name: 'Shared tasks',
        ownerId: me,
        parentPageId: parent.id,
        propertiesSchema: { properties: [{ id: 'name', name: 'Name', type: 'text' }] },
      })
      .returning();
    const allowed = await page('Allowed row', { workspaceId: scope, databaseId: database.id });
    const denied = await page('Restricted secret', { workspaceId: scope, databaseId: database.id });
    await db.update(pages).set({ restricted: true }).where(eq(pages.id, denied.id));
    await createBlock(db, {
      pageId: denied.id,
      type: 'paragraph',
      content: { text: 'Hidden body' },
      order: 0,
    });
    await upsertGrant(db, { pageId: parent.id, userId: guest, role: 'viewer', grantedBy: me });
    const [privateDb] = await db
      .insert(databases)
      .values({
        workspaceId: scope,
        name: 'Private database name',
        ownerId: me,
        propertiesSchema: {
          properties: [{ id: 'name', name: 'Confidential schema', type: 'text' }],
        },
      })
      .returning();
    const sharedRow = await page('Only this row', { workspaceId: scope, databaseId: privateDb.id });
    await page('Unshared sibling', { workspaceId: scope, databaseId: privateDb.id });
    await upsertGrant(db, { pageId: sharedRow.id, userId: guest, role: 'viewer', grantedBy: me });
    await createBlock(db, {
      pageId: sharedRow.id,
      type: 'paragraph',
      content: { text: 'Shared row body' },
      order: 0,
    });
    await createBlock(db, {
      pageId: allowed.id,
      type: 'link_to_page',
      content: { pageId: denied.id },
      order: 0,
    });

    const result = await exportPagesZip(db, {
      viewerId: guest,
      workspaceId: scope,
      rootIds: null,
      format: 'md',
    });
    const files = unzipSync(result.bytes);
    expect(Object.keys(files).sort()).toEqual([
      'Only this row.md',
      'Shared project.md',
      'Shared project/Shared tasks.csv',
      'Shared project/Shared tasks/Allowed row.md',
    ]);
    expect(strFromU8(files['Only this row.md'] as Uint8Array)).toContain('Shared row body');
    expect(parseCsv(strFromU8(files['Shared project/Shared tasks.csv'] as Uint8Array))).toEqual([
      ['Name'],
      ['Allowed row'],
    ]);
    const all = Object.entries(files)
      .map(([path, content]) => `${path}\n${strFromU8(content)}`)
      .join('\n');
    for (const secret of [
      'Restricted secret',
      'Hidden body',
      'Private database name',
      'Confidential schema',
      'Unshared sibling',
    ])
      expect(all).not.toContain(secret);
  });

  it('reserves collision-safe folders across pages and databases without changing CSV values', async () => {
    const scope = await seedWorkspace(db, 'export-collisions');
    await db.insert(workspaceMembers).values({ workspaceId: scope, userId: me, role: 'owner' });
    const root = await page('Tasks', { workspaceId: scope });
    await page('Note', { workspaceId: scope, parentId: root.id });
    const [database] = await db
      .insert(databases)
      .values({
        workspaceId: scope,
        name: 'Tasks',
        ownerId: me,
        propertiesSchema: { properties: [{ id: 'name', name: 'Name', type: 'text' }] },
      })
      .returning();
    await page('A/B', { workspaceId: scope, databaseId: database.id });
    await page('A:B', { workspaceId: scope, databaseId: database.id });
    await page('=SUM(1,2)', { workspaceId: scope, databaseId: database.id });
    const result = await exportPagesZip(db, {
      viewerId: me,
      workspaceId: scope,
      rootIds: null,
      format: 'md',
    });
    const files = unzipSync(result.bytes);
    expect(Object.keys(files).sort()).toEqual(
      [
        'Tasks.md',
        'Tasks/Note.md',
        'Tasks (2).csv',
        'Tasks (2)/A B.md',
        'Tasks (2)/A B (2).md',
        'Tasks (2)/=SUM(1,2).md',
      ].sort(),
    );
    expect(parseCsv(strFromU8(files['Tasks (2).csv'] as Uint8Array))).toEqual([
      ['Name'],
      ['A/B'],
      ['A:B'],
      ["'=SUM(1,2)"],
    ]);
  });

  it('exports all rows beyond view page sizes and rejects an oversized mixed inventory instead of truncating', async () => {
    const scope = await seedWorkspace(db, 'export-row-bound');
    await db.insert(workspaceMembers).values({ workspaceId: scope, userId: me, role: 'owner' });
    const [database] = await db
      .insert(databases)
      .values({
        workspaceId: scope,
        name: 'All rows',
        ownerId: me,
        propertiesSchema: { properties: [{ id: 'name', name: 'Name', type: 'text' }] },
      })
      .returning();
    await db.insert(pages).values(
      Array.from({ length: MAX_EXPORTED_PAGES - 1 }, (_, index) => ({
        workspaceId: scope,
        databaseId: database.id,
        ownerId: me,
        title: `Row ${index}`,
        order: index,
      })),
    );
    const input = { viewerId: me, workspaceId: scope, rootIds: null, format: 'md' } as const;
    const result = await exportPagesZip(db, input);
    const files = unzipSync(result.bytes);
    expect(result.pages).toBe(MAX_EXPORTED_PAGES - 1);
    expect(Object.keys(files)).toHaveLength(MAX_EXPORTED_PAGES);
    expect(files[`All rows/Row ${MAX_EXPORTED_PAGES - 2}.md`]).toBeDefined();
    expect(parseCsv(strFromU8(files['All rows.csv'] as Uint8Array))).toHaveLength(
      MAX_EXPORTED_PAGES,
    );
    await page('One too many', { workspaceId: scope, databaseId: database.id });
    await expect(exportPagesZip(db, input)).rejects.toBeInstanceOf(ExportTooLarge);
  });

  it('lays a page out with its subpages in a folder, and keeps out what is not the reader’s', async () => {
    const plan = await page('Plan: 2026');
    const step = await page('Step', { parentId: plan.id });
    await page('Step', { parentId: plan.id });
    await page('Detail', { parentId: step.id });
    await page('A template', { parentId: plan.id, template: true });
    await page('Their secret', { ownerId: 'someone-else' });

    const whole = await exportPagesZip(db, {
      viewerId: me,
      workspaceId,
      rootIds: null,
      format: 'md',
    });
    const files = unzipSync(whole.bytes);
    expect(Object.keys(files).sort()).toEqual([
      'Plan 2026.md',
      'Plan 2026/Step (2).md',
      'Plan 2026/Step.md',
      'Plan 2026/Step/Detail.md',
    ]);
    expect(strFromU8(files['Plan 2026/Step/Detail.md'] as Uint8Array)).toContain('# Detail');
    expect(whole.pages).toBe(4);

    const one = await exportPagesZip(db, {
      viewerId: me,
      workspaceId,
      rootIds: [step.id],
      format: 'html',
    });
    expect(Object.keys(unzipSync(one.bytes)).sort()).toEqual(['Step.html', 'Step/Detail.html']);
  });
});

describe('fileName', () => {
  it('names a file every OS accepts', () => {
    expect(fileName('a/b:c*?"<>|d')).toBe('a b c d');
    expect(fileName('  ...hidden  ')).toBe('hidden');
    expect(fileName('   ')).toBe('Untitled');
    expect(fileName('  Plan...  ')).toBe('Plan');
    expect(fileName('nul.tar.gz')).toBe('_nul.tar.gz');
    expect(fileName('COM¹')).toBe('_COM¹');
    expect(fileName('LPT9')).toBe('_LPT9');
    expect(fileName('COM10')).toBe('COM10');
  });
});
