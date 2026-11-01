import { sql } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';

/** Serialize notes erasure and workspace reset without locking unrelated writes. */
export async function lockNotesMaintenance(tx: PgHandle, workspaceId: string): Promise<void> {
  // Two-key advisory locks use a namespace distinct from the single-key locks
  // used for note creation and capability idempotency.
  await tx.execute(sql`select pg_advisory_xact_lock(1163022659, hashtext(${workspaceId}))`);
}
