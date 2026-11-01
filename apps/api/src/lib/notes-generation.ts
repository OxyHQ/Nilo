import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';
import { notesSyncGenerations, workspaces } from '../db/schema/workspaces.js';

/** A process-wide configuration. Restarting the feature requires a fresh epoch. */
export function parseNotesGenerationConfig(
  env: NodeJS.ProcessEnv,
): { readonly enabled: false } | { readonly enabled: true; readonly epoch: string } {
  if (env.NILO_NOTES_GENERATION_ENABLED !== '1') return Object.freeze({ enabled: false });
  const epoch = env.NILO_NOTES_GENERATION_EPOCH;
  if (!epoch || !/^[A-Za-z0-9_-]{16,96}$/.test(epoch)) {
    throw new Error('NILO_NOTES_GENERATION_EPOCH is required when notes generation is enabled');
  }
  return Object.freeze({ enabled: true, epoch });
}

/** Read once: a process cannot switch protocols while requests are in flight. */
export const notesGenerationConfig = parseNotesGenerationConfig(process.env);

export class NotesGenerationUnavailable extends Error {
  constructor() {
    super('Notes generation is unavailable');
  }
}
export class NotesGenerationChanged extends Error {
  constructor() {
    super('The notes generation changed');
  }
}

/** Lock the owner through the caller's transaction before comparing the epoch. */
export async function lockNotesGeneration(
  tx: PgHandle,
  workspaceId: string,
  mode: 'share' | 'update',
  expected?: string,
): Promise<string> {
  if (!notesGenerationConfig.enabled) throw new NotesGenerationUnavailable();
  const [workspace] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for(mode);
  if (!workspace) throw new NotesGenerationChanged();
  const [row] = await tx
    .select({ generation: notesSyncGenerations.generation })
    .from(notesSyncGenerations)
    .where(eq(notesSyncGenerations.workspaceId, workspaceId));
  const current = `${notesGenerationConfig.epoch}.${row?.generation ?? workspaceId}`;
  if (expected !== undefined && expected !== current) throw new NotesGenerationChanged();
  return current;
}

/** Advance under the same lock that guarded writes hold. */
export async function advanceNotesGeneration(tx: PgHandle, workspaceId: string): Promise<void> {
  await lockNotesGeneration(tx, workspaceId, 'update');
  const generation = randomUUID();
  await tx
    .insert(notesSyncGenerations)
    .values({ workspaceId, generation })
    .onConflictDoUpdate({ target: notesSyncGenerations.workspaceId, set: { generation } });
}
