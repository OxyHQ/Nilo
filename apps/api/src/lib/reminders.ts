/**
 * Delivering reminders. A sweep claims the due reminders (stamping `sentAt`,
 * `FOR UPDATE SKIP LOCKED`, so API instances never take the same one),
 * notifies each person who can still open the page, and gives a reminder back
 * to the next sweep when its notification fails.
 */
import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { getDb, type PgHandle } from '../db/client.js';
import { reminders } from '../db/schema/collab.js';
import { findDatabaseById } from '../repositories/databases.js';
import { findPagesByIds } from '../repositories/pages.js';
import { log } from './logger.js';
import { sendNotification } from './notification-service.js';
import { resolvePageAccess } from './page-access.js';

/** How many reminders one sweep delivers at most. */
const SWEEP_BATCH = 100;
/** How often the API looks for due reminders. */
export const SWEEP_INTERVAL_MS = 30_000;

/** Deliver the reminders due at `now`; returns how many were notified. */
export async function deliverDueReminders(db: PgHandle, now: Date = new Date()): Promise<number> {
  const claimed = await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(reminders)
      .where(and(isNull(reminders.sentAt), lte(reminders.remindAt, now)))
      .orderBy(asc(reminders.remindAt))
      .limit(SWEEP_BATCH)
      .for('update', { skipLocked: true });
    if (due.length > 0) {
      await tx
        .update(reminders)
        .set({ sentAt: now })
        .where(
          inArray(
            reminders.id,
            due.map((r) => r.id),
          ),
        );
    }
    return due;
  });
  if (claimed.length === 0) return 0;

  const pages = new Map(
    (
      await findPagesByIds(
        db,
        claimed.map((r) => r.pageId),
      )
    ).map((p) => [p.id, p]),
  );
  // A note's reminder is Noted's to deliver when the user has Noted.
  const noteDatabases = new Set<string>();
  for (const page of pages.values()) {
    if (page.databaseId && !noteDatabases.has(page.databaseId)) {
      const database = await findDatabaseById(db, page.databaseId);
      if (database?.systemKey === 'notes') noteDatabases.add(page.databaseId);
    }
  }
  let delivered = 0;
  for (const reminder of claimed) {
    const page = pages.get(reminder.pageId);
    // Nothing to remind about, or no longer theirs to open: done, silently.
    if (!page || page.archived || !(await resolvePageAccess(db, reminder.userId, page.id)))
      continue;
    try {
      await sendNotification({
        userId: reminder.userId,
        type: 'reminder',
        title: `Reminder: ${page.title || 'Untitled'}`,
        body: reminder.note ?? '',
        priority: 'high',
        data: {
          reminderId: reminder.id,
          pageId: page.id,
          blockId: reminder.blockId,
          workspaceId: page.workspaceId,
          ...(page.databaseId && noteDatabases.has(page.databaseId) && { app: 'noted' }),
        },
      });
      delivered += 1;
    } catch (err: unknown) {
      log.general.warn(
        { err, reminderId: reminder.id },
        'Reminder notification failed; retrying next sweep',
      );
      await db.update(reminders).set({ sentAt: null }).where(eq(reminders.id, reminder.id));
    }
  }
  return delivered;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start sweeping in this process; idempotent. */
export function startReminderSweep(): void {
  if (timer) return;
  timer = setInterval(() => {
    deliverDueReminders(getDb()).catch((err: unknown) =>
      log.general.error({ err }, 'Reminder sweep failed'),
    );
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
}

export function stopReminderSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
