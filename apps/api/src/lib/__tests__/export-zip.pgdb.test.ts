/**
 * The ZIP export of a tree of pages against PostgreSQL: which pages go in
 * (what the reader may open, no rows or templates) and how they are laid out.
 */
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeTestDb,
  getTestDb,
  seedWorkspace,
  type TestDatabase,
} from '../../db/__tests__/testDatabase.js';
import { workspaceMembers } from '../../db/schema/workspaces.js';
import { createPage } from '../../repositories/pages.js';
import { exportPagesZip, fileName } from '../export-zip.js';

let db: TestDatabase;
let workspaceId: string;
const me = 'export-zip-me';

beforeAll(async () => {
  db = await getTestDb();
  workspaceId = await seedWorkspace(db, 'export-zip');
  await db.insert(workspaceMembers).values({ workspaceId, userId: me, role: 'owner' });
});

afterAll(async () => {
  await closeTestDb();
});

const page = (title: string, extra: Partial<Parameters<typeof createPage>[1]> = {}) =>
  createPage(db, { workspaceId, title, ownerId: me, order: 0, teamspaceId: null, ...extra });

describe('exporting pages as a ZIP', () => {
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
  });
});
