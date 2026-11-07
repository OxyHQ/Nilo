/**
 * The memory tools against PostgreSQL: one atomic fact per row, the same fact
 * stored once, recall ranked and filtered, forgetting reversible unless asked,
 * writes retry-safe, and one account never seeing another's memories.
 */
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';
import { closeDb, getDb } from '../../db/client.js';
import { databases } from '../../db/schema/databases.js';
import { pages } from '../../db/schema/pages.js';
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
const scope = testScope('memories');
const USER = `${scope}-user`;
const OTHER = `${scope}-other`;
let keys = 0;
const key = () => `${scope}-key-${++keys}`;

type MemoryOut = {
  id: string;
  title: string;
  detail: string;
  kind: string | null;
  tags: string[];
  source: string;
  importance: number;
  pinned: boolean;
  archived: boolean;
};

const save = async (user: string, input: Record<string, unknown>) =>
  (await executeNiloTool('remember', { idempotencyKey: key(), ...input }, user)) as {
    memory: MemoryOut;
    existed: boolean;
  };
const recall = async (user: string, input: Record<string, unknown> = {}) =>
  ((await executeNiloTool('recallMemories', input, user)).memories as MemoryOut[]).map(
    (m) => m.title,
  );

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  await ensurePersonalNotesHome(USER);
  await ensurePersonalNotesHome(OTHER);
});

afterAll(async () => {
  await db.delete(workspaces).where(like(workspaces.ownerId, `${scope}%`));
  await closeDb();
  await closeTestDb();
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
});

describe('memory tools', () => {
  it('saves a memory with its kind, tags and source, and recalls it', async () => {
    const { memory, existed } = await save(USER, {
      title: 'Prefers Postgres over Mongo',
      detail: 'Decided in Oct 2026 for all new services.',
      kind: 'preference',
      tags: ['databases', 'Postgres'],
      importance: 4,
      source: 'alia',
    });
    expect(existed).toBe(false);
    expect(memory).toMatchObject({
      title: 'Prefers Postgres over Mongo',
      kind: 'Preference',
      tags: ['databases', 'Postgres'],
      importance: 4,
      source: 'alia',
      pinned: false,
      archived: false,
    });
    expect(await recall(USER, { query: 'postgres' })).toEqual(['Prefers Postgres over Mongo']);
  });

  it('stores the same fact once, however it is written, and keeps the higher importance', async () => {
    const first = await save(USER, { title: 'Lives in Madrid', importance: 2, tags: ['home'] });
    const again = await save(USER, { title: '  lives in MADRID ', importance: 5, tags: ['city'] });
    expect(again.existed).toBe(true);
    expect(again.memory.id).toBe(first.memory.id);
    expect(again.memory.importance).toBe(5);
    expect(again.memory.tags.sort()).toEqual(['city', 'home']);
    expect((await recall(USER, { query: 'madrid' })).length).toBe(1);
  });

  it('replays a retried write instead of repeating it', async () => {
    const input = { idempotencyKey: key(), title: 'Drinks coffee black' };
    const a = (await executeNiloTool('remember', input, USER)) as { existed: boolean };
    const b = (await executeNiloTool('remember', input, USER)) as { existed: boolean };
    expect(a.existed).toBe(false);
    expect(b.existed).toBe(false);
    expect((await recall(USER, { query: 'coffee' })).length).toBe(1);
  });

  it('rejects a reused key with different input', async () => {
    const idempotencyKey = key();
    await executeNiloTool('remember', { idempotencyKey, title: 'First' }, USER);
    await expect(
      executeNiloTool('remember', { idempotencyKey, title: 'Second' }, USER),
    ).rejects.toThrow();
  });

  it('ranks by relevance and filters by kind, tag and importance', async () => {
    await save(USER, { title: 'Alia runs agents', kind: 'fact', tags: ['alia'], importance: 5 });
    await save(USER, {
      title: 'Kaana routes inference',
      kind: 'fact',
      tags: ['kaana'],
      importance: 2,
    });
    await save(USER, { title: 'Likes tea', kind: 'preference', importance: 1 });
    expect((await recall(USER, { query: 'alia agents' }))[0]).toBe('Alia runs agents');
    expect(await recall(USER, { kind: 'fact', tags: ['kaana'] })).toEqual([
      'Kaana routes inference',
    ]);
    const important = await recall(USER, { minImportance: 5 });
    expect(important).toContain('Alia runs agents');
    expect(important).not.toContain('Likes tea');
  });

  it('lists the most important memories first when there is no query', async () => {
    const all = await recall(USER, { limit: 50 });
    expect(all.indexOf('Alia runs agents')).toBeLessThan(all.indexOf('Likes tea'));
  });

  it('updates a memory and refuses to make two say the same thing', async () => {
    const { memory } = await save(USER, { title: 'Works at Oxy', importance: 3 });
    const updated = (await executeNiloTool(
      'updateMemory',
      { idempotencyKey: key(), memoryId: memory.id, importance: 5, pinned: true, kind: 'fact' },
      USER,
    )) as { memory: MemoryOut };
    expect(updated.memory).toMatchObject({ importance: 5, pinned: true, kind: 'Fact' });
    await expect(
      executeNiloTool(
        'updateMemory',
        { idempotencyKey: key(), memoryId: memory.id, title: 'Lives in Madrid' },
        USER,
      ),
    ).rejects.toMatchObject({ code: 'memory_exists', status: 409 });
  });

  it('rejects an unknown kind and a bad importance', async () => {
    await expect(save(USER, { title: 'x', kind: 'nonsense' })).rejects.toMatchObject({
      code: 'unknown_kind',
    });
    await expect(save(USER, { title: 'y', importance: 9 })).rejects.toBeInstanceOf(
      NiloCapabilityError,
    );
  });

  it('archives a forgotten memory, which saying it again restores, and deletes on request', async () => {
    const { memory } = await save(USER, { title: 'Owns a red bike' });
    const archived = await executeNiloTool(
      'forgetMemory',
      { idempotencyKey: key(), memoryId: memory.id },
      USER,
    );
    expect(archived).toEqual({ id: memory.id, deleted: false });
    expect(await recall(USER, { query: 'bike' })).toEqual([]);
    expect(await recall(USER, { query: 'bike', includeArchived: true })).toEqual([
      'Owns a red bike',
    ]);

    const restored = await save(USER, { title: 'Owns a red bike' });
    expect(restored.existed).toBe(true);
    expect(restored.memory.archived).toBe(false);
    expect(await recall(USER, { query: 'bike' })).toEqual(['Owns a red bike']);

    const gone = await executeNiloTool(
      'forgetMemory',
      { idempotencyKey: key(), memoryId: memory.id, hard: true },
      USER,
    );
    expect(gone).toEqual({ id: memory.id, deleted: true });
    expect(await recall(USER, { query: 'bike', includeArchived: true })).toEqual([]);
  });

  it("never shows or touches another account's memories", async () => {
    const mine = await save(USER, { title: 'My private fact' });
    await save(OTHER, { title: 'Their private fact' });
    expect(await recall(USER, { query: 'private' })).toEqual(['My private fact']);
    expect(await recall(OTHER, { query: 'private' })).toEqual(['Their private fact']);
    await expect(
      executeNiloTool(
        'updateMemory',
        { idempotencyKey: key(), memoryId: mine.memory.id, title: 'Hijacked' },
        OTHER,
      ),
    ).rejects.toMatchObject({ code: 'memory_not_found', status: 404 });
    await expect(
      executeNiloTool(
        'forgetMemory',
        { idempotencyKey: key(), memoryId: mine.memory.id, hard: true },
        OTHER,
      ),
    ).rejects.toMatchObject({ code: 'memory_not_found' });
  });

  it('keeps memories out of the page tools', async () => {
    const home = await ensurePersonalNotesHome(USER);
    await createPage(getDb(), {
      workspaceId: home.workspaceId,
      ownerId: USER,
      title: 'A regular page',
      order: 0,
    });
    const listed = (await executeNiloTool('listPages', {}, USER)).pages as Array<{ title: string }>;
    expect(listed.map((p) => p.title)).toContain('A regular page');
    expect(listed.map((p) => p.title)).not.toContain('Alia runs agents');
    const found = (await executeNiloTool('searchPages', { query: 'alia' }, USER))
      .pages as unknown[];
    expect(found).toEqual([]);
  });

  it('keeps memories in one private system database of the personal workspace', async () => {
    const home = await ensurePersonalNotesHome(USER);
    const system = await db
      .select({ id: databases.id, ownerId: databases.ownerId, teamspaceId: databases.teamspaceId })
      .from(databases)
      .where(and(eq(databases.workspaceId, home.workspaceId), eq(databases.systemKey, 'memories')));
    expect(system).toHaveLength(1);
    expect(system[0]).toMatchObject({ ownerId: USER, teamspaceId: null });
    const rows = await db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.databaseId, system[0]?.id as string));
    expect(rows.length).toBeGreaterThan(0);
  });
});
