/**
 * Where a new top-level page or a database in no page goes (`docs/access.md`),
 * and whether the caller may put it there.
 *
 * - `undefined`: the workspace's default teamspace;
 * - `null`: private, to the caller — any member of the workspace;
 * - a teamspace id: one of the workspace's, not archived; the caller needs to
 *   be a workspace editor and a member of it (or it is open, or they are a
 *   workspace owner or admin).
 */
import type { Response } from 'express';
import type { PgHandle } from '../db/client.js';
import { hasRole, type WorkspaceRole } from '../db/schema/workspaces.js';
import {
  ensureDefaultTeamspace,
  findTeamspaceById,
  findTeamspaceMember,
} from '../repositories/teamspaces.js';
import { findLiveWorkspaceById, findMembership } from '../repositories/workspaces.js';

export type Placement =
  | { teamspaceId: string | null }
  | { status: number; error: string; code: string };

export async function placeTopLevel(
  db: PgHandle,
  workspaceId: string,
  userId: string,
  requested: string | null | undefined,
): Promise<Placement> {
  const membership = await findMembership(db, workspaceId, userId);
  const memberRole = (membership?.role as WorkspaceRole | undefined) ?? null;
  if (!memberRole) {
    return {
      status: 403,
      error: 'Only members of the workspace add pages at its top level',
      code: 'NO_WORKSPACE_ACCESS',
    };
  }
  if (requested === null) return { teamspaceId: null };

  let teamspaceId = requested;
  if (teamspaceId === undefined) {
    const workspace = await findLiveWorkspaceById(db, workspaceId);
    if (!workspace) return { status: 404, error: 'Workspace not found', code: 'NOT_FOUND' };
    teamspaceId = (await ensureDefaultTeamspace(db, workspaceId, workspace.ownerId)).id;
  }
  const teamspace = await findTeamspaceById(db, teamspaceId);
  if (!teamspace || teamspace.workspaceId !== workspaceId || teamspace.archivedAt) {
    return {
      status: 400,
      error: 'That is not a teamspace of this workspace',
      code: 'BAD_TEAMSPACE',
    };
  }
  if (!hasRole(memberRole, 'editor')) {
    return {
      status: 403,
      error: 'Adding pages to a teamspace needs a workspace editor',
      code: 'INSUFFICIENT_ROLE',
    };
  }
  if (!hasRole(memberRole, 'admin') && teamspace.privacy !== 'open') {
    if (!(await findTeamspaceMember(db, teamspace.id, userId))) {
      return {
        status: 403,
        error: 'Only members of the teamspace add pages to it',
        code: 'NO_TEAMSPACE_ACCESS',
      };
    }
  }
  return { teamspaceId: teamspace.id };
}

/** `placeTopLevel`, answering the request itself when the place is refused. */
export async function placeOrRefuse(
  res: Response,
  db: PgHandle,
  workspaceId: string,
  userId: string,
  requested: string | null | undefined,
): Promise<{ teamspaceId: string | null } | null> {
  const placement = await placeTopLevel(db, workspaceId, userId, requested);
  if ('status' in placement) {
    res.status(placement.status).json({ error: placement.error, code: placement.code });
    return null;
  }
  return placement;
}
