/**
 * Invitations into a workspace that are not a membership yet: by email, for
 * someone without an Oxy account (`workspace_invites`), and the workspace's
 * join link (`workspace_invite_links`).
 */

import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';
import {
  type InvitableWorkspaceRole,
  type WorkspaceLinkRole,
  workspaceInviteLinks,
  workspaceInvites,
  workspaces,
} from '../db/schema/workspaces.js';
import { addMemberIfAbsent } from './workspaces.js';

export type WorkspaceInviteRow = typeof workspaceInvites.$inferSelect;
export type WorkspaceInviteLinkRow = typeof workspaceInviteLinks.$inferSelect;

/** Emails are compared lower-cased everywhere (the table's CHECK holds it). */
export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Invite `email` to the workspace, or renew the invitation already waiting
 * for them there (its role, inviter and expiry are the new ones).
 *
 * The conflict target is the PARTIAL unique index, so its predicate is the
 * arbiter's `where` (an accepted invitation never conflicts).
 */
export async function upsertPendingInvite(
  db: PgHandle,
  values: {
    workspaceId: string;
    email: string;
    role: InvitableWorkspaceRole;
    invitedBy: string;
    expiresAt: Date;
  },
): Promise<WorkspaceInviteRow> {
  const email = normalizeInviteEmail(values.email);
  const [row] = await db
    .insert(workspaceInvites)
    .values({ ...values, email })
    .onConflictDoUpdate({
      target: [workspaceInvites.workspaceId, workspaceInvites.email],
      targetWhere: isNull(workspaceInvites.acceptedAt),
      set: {
        role: values.role,
        invitedBy: values.invitedBy,
        expiresAt: values.expiresAt,
        createdAt: sql`date_trunc('milliseconds', now())`,
      },
    })
    .returning();
  return row as WorkspaceInviteRow;
}

/** The invitations of a workspace still waiting for someone, the oldest first. */
export async function listPendingInvites(
  db: PgHandle,
  workspaceId: string,
): Promise<WorkspaceInviteRow[]> {
  return db
    .select()
    .from(workspaceInvites)
    .where(and(eq(workspaceInvites.workspaceId, workspaceId), isNull(workspaceInvites.acceptedAt)))
    .orderBy(asc(workspaceInvites.createdAt), asc(workspaceInvites.id));
}

/** Revoke a waiting invitation. False when there was none by that id there. */
export async function deletePendingInvite(
  db: PgHandle,
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.id, id),
        eq(workspaceInvites.workspaceId, workspaceId),
        isNull(workspaceInvites.acceptedAt),
      ),
    )
    .returning({ id: workspaceInvites.id });
  return rows.length > 0;
}

/** Whether any invitation anywhere is still waiting: when none is, nobody's email is needed. */
export async function anyPendingInvite(db: PgHandle, now: Date): Promise<boolean> {
  const rows = await db
    .select({ id: workspaceInvites.id })
    .from(workspaceInvites)
    .where(and(isNull(workspaceInvites.acceptedAt), gt(workspaceInvites.expiresAt, now)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Turn the invitations waiting for `email` into memberships of `userId`, in
 * live workspaces, before they expire. Someone already a member keeps their
 * role; the invitation is accepted all the same. Returns the workspaces joined.
 *
 * One transaction per call, and `acceptedAt` is stamped only where it is
 * still null, so two lists racing accept each invitation once.
 */
export async function acceptPendingInvites(
  db: PgHandle,
  userId: string,
  email: string,
  now: Date,
): Promise<string[]> {
  const address = normalizeInviteEmail(email);
  return db.transaction(async (tx) => {
    const waiting = await tx
      .select({ invite: workspaceInvites })
      .from(workspaceInvites)
      .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
      .where(
        and(
          eq(workspaceInvites.email, address),
          isNull(workspaceInvites.acceptedAt),
          gt(workspaceInvites.expiresAt, now),
          isNull(workspaces.archivedAt),
          eq(workspaces.isPersonal, false),
        ),
      )
      .for('update', { of: workspaceInvites, skipLocked: true });
    const joined: string[] = [];
    for (const { invite } of waiting) {
      const stamped = await tx
        .update(workspaceInvites)
        .set({ acceptedAt: now })
        .where(and(eq(workspaceInvites.id, invite.id), isNull(workspaceInvites.acceptedAt)))
        .returning({ id: workspaceInvites.id });
      if (stamped.length === 0) continue;
      await addMemberIfAbsent(tx, {
        workspaceId: invite.workspaceId,
        userId,
        role: invite.role,
        invitedBy: invite.invitedBy,
      });
      joined.push(invite.workspaceId);
    }
    return joined;
  });
}

/** The workspace's live join link, if it has one. */
export async function findLiveInviteLink(
  db: PgHandle,
  workspaceId: string,
): Promise<WorkspaceInviteLinkRow | null> {
  const [row] = await db
    .select()
    .from(workspaceInviteLinks)
    .where(
      and(
        eq(workspaceInviteLinks.workspaceId, workspaceId),
        isNull(workspaceInviteLinks.revokedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findInviteLinkByToken(
  db: PgHandle,
  token: string,
): Promise<WorkspaceInviteLinkRow | null> {
  const [row] = await db
    .select()
    .from(workspaceInviteLinks)
    .where(eq(workspaceInviteLinks.token, token))
    .limit(1);
  return row ?? null;
}

/** Disable the workspace's live link. Null when it had none. */
export async function revokeLiveInviteLink(
  db: PgHandle,
  workspaceId: string,
  now: Date,
): Promise<WorkspaceInviteLinkRow | null> {
  const [row] = await db
    .update(workspaceInviteLinks)
    .set({ revokedAt: now })
    .where(
      and(
        eq(workspaceInviteLinks.workspaceId, workspaceId),
        isNull(workspaceInviteLinks.revokedAt),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * A new live link for the workspace, the old one (if any) revoked in the
 * same transaction: the partial unique index allows one live link, so a
 * concurrent regeneration fails loudly instead of leaving two.
 */
export async function replaceInviteLink(
  db: PgHandle,
  values: { workspaceId: string; token: string; role: WorkspaceLinkRole; createdBy: string },
  now: Date,
): Promise<WorkspaceInviteLinkRow> {
  return db.transaction(async (tx) => {
    await revokeLiveInviteLink(tx, values.workspaceId, now);
    const [row] = await tx.insert(workspaceInviteLinks).values(values).returning();
    return row as WorkspaceInviteLinkRow;
  });
}

/** Change what the live link gives. Null when the workspace has none. */
export async function setLiveInviteLinkRole(
  db: PgHandle,
  workspaceId: string,
  role: WorkspaceLinkRole,
): Promise<WorkspaceInviteLinkRow | null> {
  const [row] = await db
    .update(workspaceInviteLinks)
    .set({ role })
    .where(
      and(
        eq(workspaceInviteLinks.workspaceId, workspaceId),
        isNull(workspaceInviteLinks.revokedAt),
      ),
    )
    .returning();
  return row ?? null;
}
