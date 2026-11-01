import { sql } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';

/** Another reset or notes erasure is already changing this workspace. */
export class NotesMaintenanceBusy extends Error {
  constructor() {
    super('Another workspace reset or notes erase is in progress; retry the request');
  }
}

/** Reject overlapping notes erasure and workspace reset without waiting on the advisory lock. */
export async function lockNotesMaintenance(tx: PgHandle, workspaceId: string): Promise<void> {
  // Two-key advisory locks use a namespace distinct from the single-key locks
  // used for note creation and capability idempotency.
  const rows = await tx.execute<{ acquired: boolean }>(
    sql`select pg_try_advisory_xact_lock(1163022659, hashtext(${workspaceId})) as acquired`,
  );
  if (rows[0]?.acquired !== true) throw new NotesMaintenanceBusy();
}
