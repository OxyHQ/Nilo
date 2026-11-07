/**
 * Telling people their verification expired. A sweep claims the verifications
 * whose expiry has passed (stamping `notifiedAt`, `FOR UPDATE SKIP LOCKED`, so
 * API instances never take the same one) and notifies whoever verified each
 * page, when they can still open it; a notification that fails goes back to
 * the next sweep.
 */
import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import { getDb, type PgHandle } from '../db/client.js';
import { pageVerifications } from '../db/schema/collab.js';
import { findPagesByIds } from '../repositories/pages.js';
import { log } from './logger.js';
import { sendNotification } from './notification-service.js';
import { resolvePageAccess } from './page-access.js';

/** How many verifications one sweep handles at most. */
const SWEEP_BATCH = 100;
/** How often the API looks for expired verifications: an hour is soon enough for days. */
export const VERIFICATION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Notify the verifiers of what expired by `now`; returns how many were told. */
export async function notifyExpiredVerifications(
  db: PgHandle,
  now: Date = new Date(),
): Promise<number> {
  const claimed = await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(pageVerifications)
      .where(and(isNull(pageVerifications.notifiedAt), lte(pageVerifications.expiresAt, now)))
      .orderBy(asc(pageVerifications.expiresAt))
      .limit(SWEEP_BATCH)
      .for('update', { skipLocked: true });
    if (due.length > 0) {
      await tx
        .update(pageVerifications)
        .set({ notifiedAt: now })
        .where(
          or(
            ...due.map((v) =>
              and(
                eq(pageVerifications.pageId, v.pageId),
                eq(pageVerifications.propertyId, v.propertyId),
              ),
            ),
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
        claimed.map((v) => v.pageId),
      )
    ).map((p) => [p.id, p]),
  );
  let told = 0;
  for (const verification of claimed) {
    const page = pages.get(verification.pageId);
    // Gone, or no longer theirs to open: nothing to tell, silently.
    if (
      !page ||
      page.archived ||
      !(await resolvePageAccess(db, verification.verifiedBy, page.id))
    ) {
      continue;
    }
    try {
      await sendNotification({
        userId: verification.verifiedBy,
        type: 'verification_expired',
        title: `Verification expired: ${page.title || 'Untitled'}`,
        body: 'This page needs to be verified again.',
        priority: 'normal',
        data: {
          pageId: page.id,
          propertyId: verification.propertyId,
          workspaceId: page.workspaceId,
        },
      });
      told += 1;
    } catch (err: unknown) {
      log.general.warn(
        { err, pageId: page.id },
        'Verification expiry notification failed; retrying next sweep',
      );
      await db
        .update(pageVerifications)
        .set({ notifiedAt: null })
        .where(
          and(
            eq(pageVerifications.pageId, verification.pageId),
            eq(pageVerifications.propertyId, verification.propertyId),
          ),
        );
    }
  }
  return told;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start sweeping in this process; idempotent. */
export function startVerificationSweep(): void {
  if (timer) return;
  timer = setInterval(() => {
    notifyExpiredVerifications(getDb()).catch((err: unknown) =>
      log.general.error({ err }, 'Verification sweep failed'),
    );
  }, VERIFICATION_SWEEP_INTERVAL_MS);
  timer.unref?.();
}

export function stopVerificationSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
