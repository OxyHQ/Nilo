/**
 * Teamspaces and their members (`docs/access.md`). The invariants every
 * workspace keeps are held here, where members and workspaces are written:
 * a workspace has one default, open teamspace, and every member of the
 * workspace belongs to it.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';
import {
  type TeamspacePrivacy,
  type TeamspaceRole,
  teamspaceMembers,
  teamspaces,
} from '../db/schema/teamspaces.js';
import { workspaceMembers } from '../db/schema/workspaces.js';

export type TeamspaceRow = typeof teamspaces.$inferSelect;
export type TeamspaceMemberRow = typeof teamspaceMembers.$inferSelect;

export async function findTeamspaceById(db: PgHandle, id: string): Promise<TeamspaceRow | null> {
  const [row] = await db.select().from(teamspaces).where(eq(teamspaces.id, id)).limit(1);
  return row ?? null;
}

export async function findDefaultTeamspace(
  db: PgHandle,
  workspaceId: string,
): Promise<TeamspaceRow | null> {
  const [row] = await db
    .select()
    .from(teamspaces)
    .where(and(eq(teamspaces.workspaceId, workspaceId), eq(teamspaces.isDefault, true)))
    .limit(1);
  return row ?? null;
}

/**
 * The workspace's default teamspace, created when missing — with every member
 * the workspace has, its owners as owners.
 */
export async function ensureDefaultTeamspace(
  db: PgHandle,
  workspaceId: string,
  ownerId: string,
): Promise<TeamspaceRow> {
  const [created] = await db
    .insert(teamspaces)
    .values({ workspaceId, name: 'General', privacy: 'open', isDefault: true, createdBy: ownerId })
    .onConflictDoNothing({ target: teamspaces.workspaceId, where: eq(teamspaces.isDefault, true) })
    .returning();
  const teamspace = created ?? (await findDefaultTeamspace(db, workspaceId));
  if (!teamspace) throw new Error(`workspace ${workspaceId} has no default teamspace`);
  if (created) {
    const members = await db
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId));
    if (members.length > 0) {
      await db
        .insert(teamspaceMembers)
        .values(
          members.map((m) => ({
            teamspaceId: teamspace.id,
            userId: m.userId,
            role: m.role === 'owner' ? ('owner' as const) : ('member' as const),
          })),
        )
        .onConflictDoNothing();
    }
  }
  await addTeamspaceMember(db, teamspace.id, ownerId, 'owner');
  return teamspace;
}

export async function createTeamspace(
  db: PgHandle,
  values: {
    workspaceId: string;
    name: string;
    icon?: string | null;
    description?: string;
    privacy: TeamspacePrivacy;
    createdBy: string;
  },
): Promise<TeamspaceRow> {
  const [row] = await db.insert(teamspaces).values(values).returning();
  if (!row) throw new Error('createTeamspace inserted no row');
  await addTeamspaceMember(db, row.id, values.createdBy, 'owner');
  return row;
}

export async function updateTeamspace(
  db: PgHandle,
  id: string,
  patch: {
    name?: string;
    icon?: string | null;
    description?: string;
    privacy?: TeamspacePrivacy;
    archivedAt?: Date | null;
  },
): Promise<TeamspaceRow | null> {
  const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (Object.keys(values).length === 0) return findTeamspaceById(db, id);
  const [row] = await db
    .update(teamspaces)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(teamspaces.id, id))
    .returning();
  return row ?? null;
}

/** The workspace's teamspaces, the default first, then by name. */
export async function listTeamspaces(db: PgHandle, workspaceId: string): Promise<TeamspaceRow[]> {
  const rows = await db
    .select()
    .from(teamspaces)
    .where(eq(teamspaces.workspaceId, workspaceId))
    .orderBy(asc(teamspaces.name));
  return rows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/** Add a member, or make an existing one an owner (never demote here). */
export async function addTeamspaceMember(
  db: PgHandle,
  teamspaceId: string,
  userId: string,
  role: TeamspaceRole = 'member',
): Promise<void> {
  await db
    .insert(teamspaceMembers)
    .values({ teamspaceId, userId, role })
    .onConflictDoUpdate({
      target: [teamspaceMembers.teamspaceId, teamspaceMembers.userId],
      set: role === 'owner' ? { role: 'owner' } : { role: teamspaceMembers.role },
    });
}

export async function setTeamspaceMemberRole(
  db: PgHandle,
  teamspaceId: string,
  userId: string,
  role: TeamspaceRole,
): Promise<boolean> {
  const rows = await db
    .update(teamspaceMembers)
    .set({ role })
    .where(and(eq(teamspaceMembers.teamspaceId, teamspaceId), eq(teamspaceMembers.userId, userId)))
    .returning({ userId: teamspaceMembers.userId });
  return rows.length > 0;
}

export async function removeTeamspaceMember(
  db: PgHandle,
  teamspaceId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .delete(teamspaceMembers)
    .where(and(eq(teamspaceMembers.teamspaceId, teamspaceId), eq(teamspaceMembers.userId, userId)))
    .returning({ userId: teamspaceMembers.userId });
  return rows.length > 0;
}

export async function listTeamspaceMembers(
  db: PgHandle,
  teamspaceId: string,
): Promise<TeamspaceMemberRow[]> {
  return db
    .select()
    .from(teamspaceMembers)
    .where(eq(teamspaceMembers.teamspaceId, teamspaceId))
    .orderBy(asc(teamspaceMembers.joinedAt));
}

export async function findTeamspaceMember(
  db: PgHandle,
  teamspaceId: string,
  userId: string,
): Promise<TeamspaceMemberRow | null> {
  const [row] = await db
    .select()
    .from(teamspaceMembers)
    .where(and(eq(teamspaceMembers.teamspaceId, teamspaceId), eq(teamspaceMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Someone leaving a workspace leaves its teamspaces too. */
export async function removeFromWorkspaceTeamspaces(
  db: PgHandle,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const ids = db
    .select({ id: teamspaces.id })
    .from(teamspaces)
    .where(eq(teamspaces.workspaceId, workspaceId));
  await db
    .delete(teamspaceMembers)
    .where(and(eq(teamspaceMembers.userId, userId), inArray(teamspaceMembers.teamspaceId, ids)));
}
