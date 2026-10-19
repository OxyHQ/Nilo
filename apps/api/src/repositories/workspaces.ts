/**
 * Workspaces and their membership.
 *
 * This is the domain every other one sits on: `middleware/workspace.ts`
 * resolves a workspace and a membership on behalf of `routes/pages.ts`,
 * `routes/blocks.ts`, `routes/databases.ts`, `routes/comments.ts` and
 * `routes/share-links.ts`. If that middleware read a different store from any
 * of them, it would look up an id it cannot find and return 403 on every
 * request — no throw, no log line.
 */

import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { isUniqueViolation } from '@oxy.so/db';
import { comments, notifications } from '../db/schema/collab.js';
import { databases } from '../db/schema/databases.js';
import { pageFiles, pages } from '../db/schema/pages.js';
import { teamspaceMembers, teamspaces } from '../db/schema/teamspaces.js';
import { workspaceMembers, workspaces, type WorkspaceRole } from '../db/schema/workspaces.js';
import type { PgHandle } from '../db/client.js';
import {
  addTeamspaceMember,
  ensureDefaultTeamspace,
  removeFromWorkspaceTeamspaces,
} from './teamspaces.js';

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;

export async function findWorkspaceById(db: PgHandle, id: string): Promise<WorkspaceRow | null> {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  return row ?? null;
}

/**
 * The live workspace, or null when it is missing OR archived.
 *
 * The two are one answer on purpose: every caller turns both into the same
 * 404, and splitting them invites a caller to check existence and forget the
 * archive, which reads as a working workspace nobody can see in the sidebar.
 */
export async function findLiveWorkspaceById(
  db: PgHandle,
  id: string,
): Promise<WorkspaceRow | null> {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, id), isNull(workspaces.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function findMembership(
  db: PgHandle,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMemberRow | null> {
  const [row] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Every membership a user holds, newest first — the "list my workspaces" query. */
export async function listMembershipsForUser(
  db: PgHandle,
  userId: string,
): Promise<WorkspaceMemberRow[]> {
  return db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(desc(workspaceMembers.joinedAt));
}

/**
 * Live workspaces by id.
 *
 * Guarded rather than relying on `inArray` with an empty list: drizzle renders
 * that as the literal `false`, which is correct but still costs a round trip.
 */
export async function listLiveWorkspacesByIds(
  db: PgHandle,
  ids: readonly string[],
): Promise<WorkspaceRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(workspaces)
    .where(and(inArray(workspaces.id, [...ids]), isNull(workspaces.archivedAt)));
}

export async function listMembers(
  db: PgHandle,
  workspaceId: string,
): Promise<WorkspaceMemberRow[]> {
  return db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(desc(workspaceMembers.joinedAt));
}

/** Memberships for a specific set of users — the mention validator in comments. */
export async function listMembershipsForUsers(
  db: PgHandle,
  workspaceId: string,
  userIds: readonly string[],
): Promise<WorkspaceMemberRow[]> {
  if (userIds.length === 0) return [];
  return db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(workspaceMembers.userId, [...userIds]),
      ),
    );
}

export async function findPersonalWorkspace(
  db: PgHandle,
  ownerId: string,
): Promise<WorkspaceRow | null> {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.ownerId, ownerId), eq(workspaces.isPersonal, true)))
    .limit(1);
  return row ?? null;
}

export async function createWorkspace(
  db: PgHandle,
  values: { name: string; avatar?: string | null; ownerId: string; isPersonal?: boolean },
): Promise<WorkspaceRow> {
  const [row] = await db.insert(workspaces).values(values).returning();
  await ensureDefaultTeamspace(db, row.id, row.ownerId);
  return row;
}

/**
 * Create the caller's personal workspace, tolerating a concurrent creator.
 *
 * `ON CONFLICT ... DO NOTHING RETURNING` rather than catching a duplicate-key
 * error, and the difference is not stylistic. On Postgres one failed statement
 * aborts the whole transaction, and an exception cannot distinguish a duplicate
 * from a dropped connection — so the ported `code === 11000` catch would answer
 * "already done" to an infrastructure failure and hand back someone else's
 * absence as success. Here the EMPTY RESULT is the answer, and a real failure
 * still propagates.
 *
 * `where` is required because the target is a PARTIAL unique index
 * (`unique_personal_workspace_per_owner`, predicated on `is_personal`);
 * without it Postgres cannot match the arbiter and raises 42P10.
 *
 * Returns null when another request won the race — the caller re-reads.
 */
export async function createPersonalWorkspaceIfAbsent(
  db: PgHandle,
  values: { name: string; ownerId: string },
): Promise<WorkspaceRow | null> {
  const [row] = await db
    .insert(workspaces)
    .values({ ...values, avatar: null, isPersonal: true })
    .onConflictDoNothing({
      target: workspaces.ownerId,
      // drizzle's `where` on a conflict clause IS the arbiter's index
      // predicate, which is what a PARTIAL unique target needs.
      where: eq(workspaces.isPersonal, true),
    })
    .returning();
  if (row) await ensureDefaultTeamspace(db, row.id, row.ownerId);
  return row ?? null;
}

/**
 * The owner's personal workspace, whole: the workspace, the owner's
 * membership and the default teamspace commit together or not at all.
 *
 * It is also the repair path. The list of a user's workspaces starts from
 * their memberships, so a personal workspace without its owner row is
 * invisible, and provisioning that stopped at "the workspace exists" left it
 * that way for good. Re-adding the owner is an idempotent insert, so every
 * call heals that state instead of trusting it.
 *
 * A concurrent first provisioning is settled by the partial unique index: the
 * losing insert waits for the winner to commit and returns nothing, and the
 * read that follows (a new statement, so a new snapshot) sees the winner.
 */
export async function provisionPersonalWorkspace(
  db: PgHandle,
  values: { ownerId: string; name: string },
): Promise<WorkspaceRow> {
  return db.transaction(async (tx) => {
    const workspace =
      (await createPersonalWorkspaceIfAbsent(tx, values)) ??
      (await findPersonalWorkspace(tx, values.ownerId));
    if (!workspace) {
      throw new Error(`personal workspace of ${values.ownerId} missing after provisioning`);
    }
    await addMemberIfAbsent(tx, {
      workspaceId: workspace.id,
      userId: values.ownerId,
      role: 'owner',
      invitedBy: null,
    });
    return workspace;
  });
}

/** Whether the owner's personal workspace exists AND they are its owner member. */
export async function findProvisionedPersonalWorkspace(
  db: PgHandle,
  ownerId: string,
): Promise<WorkspaceRow | null> {
  const [row] = await db
    .select({ workspace: workspaces })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, workspaces.ownerId),
      ),
    )
    .where(and(eq(workspaces.ownerId, ownerId), eq(workspaces.isPersonal, true)))
    .limit(1);
  return row?.workspace ?? null;
}

/**
 * Empty a personal workspace back to the state provisioning leaves it in,
 * keeping its id. Permanent: nothing goes to the trash.
 *
 * Pages first, in one statement, so the self-reference finds no surviving
 * child to detach; every table hanging off a page (blocks, comments,
 * reminders, versions, grants, share links, follows, transactions) goes by
 * cascade. Then the databases, whose rows are already gone, taking their views
 * and forms. A notification about one of the deleted pages would open onto a
 * 404, so those go too; not every sender records the workspace, but each one
 * records the page.
 *
 * Teamspaces other than the default, and anyone but the owner, are removed:
 * a personal workspace takes no invitations, so in practice there is no one
 * else, but the reset restores the invariant rather than assuming it.
 */
export async function resetPersonalWorkspace(
  db: PgHandle,
  workspace: Pick<WorkspaceRow, 'id' | 'ownerId'>,
  name: string,
): Promise<{ pages: number; databases: number }> {
  const { id, ownerId } = workspace;
  return db.transaction(async (tx) => {
    const removedPages = await tx
      .delete(pages)
      .where(eq(pages.workspaceId, id))
      .returning({ id: pages.id });
    const removedDatabases = await tx
      .delete(databases)
      .where(eq(databases.workspaceId, id))
      .returning({ id: databases.id });
    await tx.delete(comments).where(eq(comments.workspaceId, id));
    // The files its pages had: the workspace no longer serves them. They stay
    // in the user's Oxy storage, which is theirs, not the workspace's.
    await tx.delete(pageFiles).where(eq(pageFiles.workspaceId, id));

    const pageIds = removedPages.map((p) => p.id);
    const aboutWorkspace = sql`${notifications.data} ->> 'workspaceId' = ${id}`;
    await tx
      .delete(notifications)
      .where(
        pageIds.length > 0
          ? or(aboutWorkspace, inArray(sql`${notifications.data} ->> 'pageId'`, pageIds))
          : aboutWorkspace,
      );

    await tx
      .delete(teamspaces)
      .where(and(eq(teamspaces.workspaceId, id), eq(teamspaces.isDefault, false)));
    await tx
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, id), ne(workspaceMembers.userId, ownerId)));
    const general = await ensureDefaultTeamspace(tx, id, ownerId);
    await tx
      .delete(teamspaceMembers)
      .where(
        and(eq(teamspaceMembers.teamspaceId, general.id), ne(teamspaceMembers.userId, ownerId)),
      );
    await tx
      .update(teamspaces)
      .set({ name: 'General', icon: null, description: '', privacy: 'open' })
      .where(eq(teamspaces.id, general.id));

    await tx.update(workspaces).set({ name, avatar: null }).where(eq(workspaces.id, id));
    await addMemberIfAbsent(tx, {
      workspaceId: id,
      userId: ownerId,
      role: 'owner',
      invitedBy: null,
    });

    return { pages: removedPages.length, databases: removedDatabases.length };
  });
}

/** Every member of a workspace belongs to its default teamspace. */
async function joinDefaultTeamspace(db: PgHandle, member: WorkspaceMemberRow): Promise<void> {
  const workspace = await db
    .select({ ownerId: workspaces.ownerId })
    .from(workspaces)
    .where(eq(workspaces.id, member.workspaceId))
    .limit(1);
  const ownerId = workspace[0]?.ownerId ?? member.userId;
  const teamspace = await ensureDefaultTeamspace(db, member.workspaceId, ownerId);
  await addTeamspaceMember(
    db,
    teamspace.id,
    member.userId,
    member.role === 'owner' ? 'owner' : 'member',
  );
}

/**
 * Add a member, tolerating a concurrent identical insert.
 *
 * Same reasoning as above: the empty result means "already a member", not
 * "something went wrong". Returns null when the row already existed.
 */
export async function addMemberIfAbsent(
  db: PgHandle,
  values: {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
    invitedBy?: string | null;
  },
): Promise<WorkspaceMemberRow | null> {
  const [row] = await db
    .insert(workspaceMembers)
    .values(values)
    .onConflictDoNothing({
      target: [workspaceMembers.workspaceId, workspaceMembers.userId],
    })
    .returning();
  if (row) await joinDefaultTeamspace(db, row);
  return row ?? null;
}

/**
 * Add a member, refusing a duplicate loudly.
 *
 * The invite route wants "this person is already a member" to reach the user
 * as a 409, which is a different answer from the idempotent provisioning path
 * above. The SQLSTATE lives on `cause`, never on `error.code` — a ported
 * `err.code === '23505'` matches nothing and the branch collapses silently.
 */
export async function addMember(
  db: PgHandle,
  values: {
    workspaceId: string;
    userId: string;
    role: WorkspaceRole;
    invitedBy?: string | null;
  },
): Promise<{ member: WorkspaceMemberRow } | { duplicate: true }> {
  try {
    const [row] = await db.insert(workspaceMembers).values(values).returning();
    await joinDefaultTeamspace(db, row);
    return { member: row };
  } catch (error) {
    if (isUniqueViolation(error, 'workspace_members_workspace_user_key')) {
      return { duplicate: true };
    }
    throw error;
  }
}

/**
 * Patch a workspace from the fields the caller actually supplied.
 *
 * Built from DEFINED keys only. Writing an `undefined` key writes NULL, so a
 * patch that touches one field and leaves a sibling `undefined` would erase the
 * sibling. drizzle's `.set()` drops undefined itself, so this guard is about
 * the EMPTY patch: with no defined keys there is nothing to write, and an empty
 * `.set()` is a syntax error rather than a no-op.
 */
export async function updateWorkspace(
  db: PgHandle,
  id: string,
  patch: { name?: string; avatar?: string | null },
): Promise<WorkspaceRow | null> {
  const values: { name?: string; avatar?: string | null } = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.avatar !== undefined) values.avatar = patch.avatar;
  if (Object.keys(values).length === 0) return findWorkspaceById(db, id);

  const [row] = await db.update(workspaces).set(values).where(eq(workspaces.id, id)).returning();
  return row ?? null;
}

/** Soft delete. Returns null when the workspace does not exist. */
export async function archiveWorkspace(db: PgHandle, id: string): Promise<WorkspaceRow | null> {
  const [row] = await db
    .update(workspaces)
    .set({ archivedAt: new Date() })
    .where(eq(workspaces.id, id))
    .returning();
  return row ?? null;
}

export async function updateMemberRole(
  db: PgHandle,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<WorkspaceMemberRow | null> {
  const [row] = await db
    .update(workspaceMembers)
    .set({ role })
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .returning();
  return row ?? null;
}

/**
 * Hand the workspace to another member: they become its owner (and an owner
 * of its default teamspace), the previous owner stays as an admin. One
 * transaction, guarded on both rows, so a workspace never has no owner or
 * two. Returns false when either is no longer what the caller saw (the
 * previous owner is not the owner, or the next one not a member).
 */
export async function transferOwnership(
  db: PgHandle,
  workspaceId: string,
  fromUserId: string,
  toUserId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    // The next owner's row first, locked: nothing is written unless they are
    // still a member when the transaction commits.
    const [next] = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, toUserId)),
      )
      .for('update');
    if (!next) return false;
    const [workspace] = await tx
      .update(workspaces)
      .set({ ownerId: toUserId })
      .where(
        and(
          eq(workspaces.id, workspaceId),
          eq(workspaces.ownerId, fromUserId),
          eq(workspaces.isPersonal, false),
        ),
      )
      .returning({ id: workspaces.id });
    if (!workspace) return false;
    await tx
      .update(workspaceMembers)
      .set({ role: 'owner' })
      .where(eq(workspaceMembers.id, next.id));
    await tx
      .update(workspaceMembers)
      .set({ role: 'admin' })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, fromUserId)),
      );
    await ensureDefaultTeamspace(tx, workspaceId, toUserId);
    return true;
  });
}

/**
 * Remove a member.
 *
 * Returns whether a row was removed, read off `RETURNING` rather than
 * `rowCount`. Callers branch on it, and reading `rows.length` on a bare DELETE
 * returns 0 whether or not anything was deleted.
 */
export async function removeMember(
  db: PgHandle,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .delete(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .returning({ id: workspaceMembers.id });
  if (rows.length > 0) await removeFromWorkspaceTeamspaces(db, workspaceId, userId);
  return rows.length > 0;
}
