/**
 * Running scheduled automations. A sweep claims the ones that are due
 * (`FOR UPDATE SKIP LOCKED`, so API instances never take the same one) and, in
 * the same transaction, moves each to its next occurrence counted from now: a
 * sweep that was down does not replay the runs it missed, it runs once.
 */
import { nextScheduledRun } from '@oxy.so/nilo-contracts';
import { and, asc, eq, isNotNull, lte } from 'drizzle-orm';
import { getDb, type PgHandle } from '../db/client.js';
import { databaseAutomations } from '../db/schema/automations.js';
import { runScheduledAutomation } from './databases/automations.js';
import { log } from './logger.js';

const SWEEP_BATCH = 50;
/** A schedule's finest grain is an hour; a minute keeps a run close to its hour. */
export const SCHEDULE_SWEEP_INTERVAL_MS = 60 * 1000;

/** Run what is due by `now`; returns how many automations ran. */
export async function runDueAutomations(db: PgHandle, now: Date = new Date()): Promise<number> {
  const claimed = await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(databaseAutomations)
      .where(
        and(
          eq(databaseAutomations.enabled, true),
          isNotNull(databaseAutomations.nextRunAt),
          lte(databaseAutomations.nextRunAt, now),
        ),
      )
      .orderBy(asc(databaseAutomations.nextRunAt))
      .limit(SWEEP_BATCH)
      .for('update', { skipLocked: true });
    for (const automation of due) {
      const trigger = automation.trigger;
      await tx
        .update(databaseAutomations)
        .set({ nextRunAt: trigger.kind === 'schedule' ? nextScheduledRun(trigger, now) : null })
        .where(eq(databaseAutomations.id, automation.id));
    }
    return due;
  });
  for (const automation of claimed) await runScheduledAutomation(automation);
  return claimed.length;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start sweeping in this process; idempotent. */
export function startAutomationSchedule(): void {
  if (timer) return;
  timer = setInterval(() => {
    runDueAutomations(getDb()).catch((err: unknown) =>
      log.general.error({ err }, 'Automation schedule sweep failed'),
    );
  }, SCHEDULE_SWEEP_INTERVAL_MS);
  timer.unref?.();
}

export function stopAutomationSchedule(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
