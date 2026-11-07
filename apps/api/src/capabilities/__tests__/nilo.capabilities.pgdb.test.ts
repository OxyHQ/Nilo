/**
 * Nilo's workspace catalog against PostgreSQL: a person's tools see their own
 * personal workspace and nothing else. Another person's page, and a page that is
 * not in this workspace, are reported as not found, never read.
 */
import { like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '../../db/client.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';
import { workspaces } from '../../db/schema/workspaces.js';
import { ensurePersonalNotesHome } from '../../middleware/workspace.js';
import { createPage } from '../../repositories/pages.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticateToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../oxy.js', () => ({
  oxy: {
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
    users: { get: async () => ({ username: 'ada' }) },
  },
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { executeNiloTool, NiloCapabilityError } = await import('../nilo.handlers.js');

let db: TestDatabase;
let previousUrl: string | undefined;
const scope = testScope('nilo-capabilities');
const USER = `${scope}-user`;
const OTHER = `${scope}-other`;
let ownPageId = '';
let otherPageId = '';

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const own = await ensurePersonalNotesHome(USER);
  const other = await ensurePersonalNotesHome(OTHER);
  ownPageId = (
    await createPage(getDb(), {
      workspaceId: own.workspaceId,
      ownerId: USER,
      title: 'Quarterly plan',
      order: 0,
    })
  ).id;
  otherPageId = (
    await createPage(getDb(), {
      workspaceId: other.workspaceId,
      ownerId: OTHER,
      title: 'Their secret plan',
      order: 0,
    })
  ).id;
});

afterAll(async () => {
  await db.delete(workspaces).where(like(workspaces.ownerId, `${scope}%`));
  await closeDb();
  await closeTestDb();
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
});

const titles = (result: Record<string, unknown>) =>
  (result.pages as Array<{ title: string }>).map((page) => page.title);

describe('Nilo workspace tools', () => {
  it('lists only the personal workspace of the caller', async () => {
    const result = await executeNiloTool('listPages', {}, USER);
    expect(titles(result)).toContain('Quarterly plan');
    expect(titles(result)).not.toContain('Their secret plan');
  });

  it('searches only the personal workspace of the caller', async () => {
    const own = await executeNiloTool('searchPages', { query: 'plan' }, USER);
    expect(titles(own)).toEqual(['Quarterly plan']);
    const none = await executeNiloTool('searchPages', { query: 'secret' }, USER);
    expect(titles(none)).toEqual([]);
  });

  it("reads the caller's own page with its content as Markdown", async () => {
    const result = await executeNiloTool('readPage', { pageId: ownPageId }, USER);
    const page = result.page as { id: string; title: string; body: string };
    expect(page.id).toBe(ownPageId);
    expect(page.title).toBe('Quarterly plan');
    expect(typeof page.body).toBe('string');
  });

  it("reports another person's page as not found, never reads it", async () => {
    const attempt = executeNiloTool('readPage', { pageId: otherPageId }, USER);
    await expect(attempt).rejects.toBeInstanceOf(NiloCapabilityError);
    await expect(attempt).rejects.toMatchObject({ code: 'page_not_found', status: 404 });
  });
});
