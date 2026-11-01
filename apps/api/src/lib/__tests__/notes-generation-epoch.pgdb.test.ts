/** Real PostgreSQL verifies tokens across independently initialized configurations. */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { notesSyncGenerations, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  seedWorkspace,
  type TestDatabase,
} from '../../db/__tests__/testDatabase.js';

let db: TestDatabase;
let workspaceId: string;
beforeAll(async () => {
  db = await getTestDb();
  workspaceId = await seedWorkspace(db, 'notes-epoch');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.delete(notesSyncGenerations).where(eq(notesSyncGenerations.workspaceId, workspaceId));
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await closeTestDb();
});
describe('deployment epoch rotation', () => {
  it('rejects old tokens after reinitializing with a different epoch', async () => {
    vi.stubEnv('NILO_NOTES_GENERATION_ENABLED', '1');
    vi.stubEnv('NILO_NOTES_GENERATION_EPOCH', 'deployment_epoch_A_2026');
    vi.resetModules();
    const first = await import('../notes-generation.js');
    const oldToken = await db.transaction((tx) =>
      first.lockNotesGeneration(tx, workspaceId, 'share'),
    );
    await expect(
      db.transaction((tx) => first.lockNotesGeneration(tx, workspaceId, 'share', oldToken)),
    ).resolves.toBe(oldToken);
    vi.stubEnv('NILO_NOTES_GENERATION_EPOCH', 'deployment_epoch_B_2026');
    // The first process remains pinned even if its environment is mutated.
    expect(first.notesGenerationConfig).toEqual({
      enabled: true,
      epoch: 'deployment_epoch_A_2026',
    });
    vi.resetModules();
    const second = await import('../notes-generation.js');
    await expect(
      db.transaction((tx) => second.lockNotesGeneration(tx, workspaceId, 'share', oldToken)),
    ).rejects.toBeInstanceOf(second.NotesGenerationChanged);
    const next = await db.transaction((tx) => second.lockNotesGeneration(tx, workspaceId, 'share'));
    expect(next).not.toBe(oldToken);
  });
});
