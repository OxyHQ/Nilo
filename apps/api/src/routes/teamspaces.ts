/**
 * Teamspaces (`docs/access.md`): groups of a workspace's members, each with
 * its own pages.
 *
 * - `GET  /workspaces/:workspaceId/teamspaces` — those the caller can see:
 *   open and closed ones, private ones they belong to (all, for workspace
 *   owners and admins), with their own role in each.
 * - `POST /workspaces/:workspaceId/teamspaces` — a workspace editor creates
 *   one and owns it.
 * - `PATCH /teamspaces/:id` — name, icon, description, privacy, archived:
 *   its owners and workspace owners/admins. The default teamspace stays open
 *   and is never archived.
 * - `GET /teamspaces/:id/members`, `PUT /teamspaces/:id/members/:userId`
 *   `{ role }` (adds a workspace member or changes their role),
 *   `DELETE /teamspaces/:id/members/:userId` (removes; anyone may leave) —
 *   managing members is for its owners and workspace owners/admins. A
 *   teamspace keeps at least one owner, and everyone stays in the default one.
 * - `POST /teamspaces/:id/join` — join an open teamspace.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import {
  TEAMSPACE_NAME_MAX,
  TEAMSPACE_PRIVACIES,
  TEAMSPACE_ROLES,
} from '../db/schema/teamspaces.js';
import { hasRole, type WorkspaceRole } from '../db/schema/workspaces.js';
import { log } from '../lib/logger.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  addTeamspaceMember,
  createTeamspace,
  findTeamspaceById,
  findTeamspaceMember,
  listTeamspaceMembers,
  listTeamspaces,
  removeTeamspaceMember,
  setTeamspaceMemberRole,
  type TeamspaceRow,
  updateTeamspace,
} from '../repositories/teamspaces.js';
import { findLiveWorkspaceById, findMembership } from '../repositories/workspaces.js';

const router = Router();
router.use(['/workspaces/:workspaceId/teamspaces', '/teamspaces'], authenticateToken);

const entityIdSchema = z.string().refine(isLiveEntityId, 'Invalid id');
const nameSchema = z.string().trim().min(1).max(TEAMSPACE_NAME_MAX);

const createSchema = z.object({
  name: nameSchema,
  icon: z.string().max(200).nullable().optional(),
  description: z.string().max(2000).optional(),
  privacy: z.enum(TEAMSPACE_PRIVACIES).default('open'),
});

const updateSchema = z
  .object({
    name: nameSchema.optional(),
    icon: z.string().max(200).nullable().optional(),
    description: z.string().max(2000).optional(),
    privacy: z.enum(TEAMSPACE_PRIVACIES).optional(),
    archived: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'At least one field is required' });

function serializeTeamspace(t: TeamspaceRow, role: string | null) {
  return {
    id: t.id,
    workspaceId: t.workspaceId,
    name: t.name,
    icon: t.icon,
    description: t.description,
    privacy: t.privacy,
    isDefault: t.isDefault,
    archived: t.archivedAt !== null,
    /** The caller's membership: `owner`, `member`, or null. */
    role,
    createdAt: t.createdAt,
  };
}

/** The caller's place in a teamspace's workspace, or an answer already sent. */
async function standing(
  req: Request,
  res: Response,
  teamspaceId: string,
): Promise<{
  teamspace: TeamspaceRow;
  memberRole: WorkspaceRole;
  role: string | null;
  manages: boolean;
} | null> {
  const db = getDb();
  const userId = req.user?.id ?? '';
  const teamspace = await findTeamspaceById(db, teamspaceId);
  const membership = teamspace ? await findMembership(db, teamspace.workspaceId, userId) : null;
  const own = teamspace && membership ? await findTeamspaceMember(db, teamspace.id, userId) : null;
  // A private teamspace does not exist for those outside it.
  if (
    !teamspace ||
    !membership ||
    (teamspace.privacy === 'private' && !own && !hasRole(membership.role as WorkspaceRole, 'admin'))
  ) {
    res.status(404).json({ error: 'Teamspace not found' });
    return null;
  }
  const memberRole = membership.role as WorkspaceRole;
  return {
    teamspace,
    memberRole,
    role: own?.role ?? null,
    manages: own?.role === 'owner' || hasRole(memberRole, 'admin'),
  };
}

function refuse(res: Response, error: string): void {
  res.status(403).json({ error, code: 'TEAMSPACE_FORBIDDEN' });
}

function fail(res: Response, error: unknown, what: string): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: error.errors });
    return;
  }
  log.general.error({ err: error }, `Failed to ${what}`);
  res.status(500).json({ error: `Failed to ${what}` });
}

router.get('/workspaces/:workspaceId/teamspaces', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = z.object({ workspaceId: entityIdSchema }).parse(req.params);
    const db = getDb();
    const userId = req.user?.id ?? '';
    const membership = await findMembership(db, workspaceId, userId);
    if (!membership) {
      res.status(403).json({ error: 'Forbidden: not a workspace member' });
      return;
    }
    const admin = hasRole(membership.role as WorkspaceRole, 'admin');
    const all = await listTeamspaces(db, workspaceId);
    const roles = new Map(
      await Promise.all(
        all.map(
          async (t) => [t.id, (await findTeamspaceMember(db, t.id, userId))?.role ?? null] as const,
        ),
      ),
    );
    const visible = all.filter((t) => t.privacy !== 'private' || roles.get(t.id) || admin);
    res.json({ teamspaces: visible.map((t) => serializeTeamspace(t, roles.get(t.id) ?? null)) });
  } catch (error: unknown) {
    fail(res, error, 'list teamspaces');
  }
});

router.post('/workspaces/:workspaceId/teamspaces', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = z.object({ workspaceId: entityIdSchema }).parse(req.params);
    const body = createSchema.parse(req.body);
    const db = getDb();
    const userId = req.user?.id ?? '';
    const [workspace, membership] = await Promise.all([
      findLiveWorkspaceById(db, workspaceId),
      findMembership(db, workspaceId, userId),
    ]);
    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (!membership || !hasRole(membership.role as WorkspaceRole, 'editor')) {
      refuse(res, 'Creating a teamspace needs a workspace editor');
      return;
    }
    const teamspace = await createTeamspace(db, {
      workspaceId,
      name: body.name,
      icon: body.icon ?? null,
      description: body.description ?? '',
      privacy: body.privacy,
      createdBy: userId,
    });
    res.status(201).json({ teamspace: serializeTeamspace(teamspace, 'owner') });
  } catch (error: unknown) {
    fail(res, error, 'create teamspace');
  }
});

router.patch('/teamspaces/:id', async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: entityIdSchema }).parse(req.params);
    const body = updateSchema.parse(req.body);
    const at = await standing(req, res, id);
    if (!at) return;
    if (!at.manages) {
      refuse(res, 'Only its owners manage a teamspace');
      return;
    }
    if (at.teamspace.isDefault && (body.archived || (body.privacy && body.privacy !== 'open'))) {
      res.status(400).json({ error: 'The default teamspace stays open and cannot be archived' });
      return;
    }
    const updated = await updateTeamspace(getDb(), id, {
      name: body.name,
      icon: body.icon,
      description: body.description,
      privacy: body.privacy,
      archivedAt: body.archived === undefined ? undefined : body.archived ? new Date() : null,
    });
    res.json({ teamspace: updated && serializeTeamspace(updated, at.role) });
  } catch (error: unknown) {
    fail(res, error, 'update teamspace');
  }
});

router.get('/teamspaces/:id/members', async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: entityIdSchema }).parse(req.params);
    const at = await standing(req, res, id);
    if (!at) return;
    const members = await listTeamspaceMembers(getDb(), id);
    res.json({
      members: members.map((m) => ({ userId: m.userId, role: m.role, joinedAt: m.joinedAt })),
    });
  } catch (error: unknown) {
    fail(res, error, 'list teamspace members');
  }
});

/** Whether `userId` is the teamspace's last owner. */
async function lastOwner(teamspaceId: string, userId: string): Promise<boolean> {
  const owners = (await listTeamspaceMembers(getDb(), teamspaceId)).filter(
    (m) => m.role === 'owner',
  );
  return owners.length === 1 && owners[0]?.userId === userId;
}

router.put('/teamspaces/:id/members/:userId', async (req: Request, res: Response) => {
  try {
    const params = z
      .object({ id: entityIdSchema, userId: z.string().min(1).max(200) })
      .parse(req.params);
    const { role } = z.object({ role: z.enum(TEAMSPACE_ROLES) }).parse(req.body);
    const at = await standing(req, res, params.id);
    if (!at) return;
    if (!at.manages) {
      refuse(res, 'Only its owners manage who is in a teamspace');
      return;
    }
    const db = getDb();
    if (!(await findMembership(db, at.teamspace.workspaceId, params.userId))) {
      res.status(400).json({ error: 'Only members of the workspace join its teamspaces' });
      return;
    }
    const current = await findTeamspaceMember(db, params.id, params.userId);
    if (
      current?.role === 'owner' &&
      role !== 'owner' &&
      (await lastOwner(params.id, params.userId))
    ) {
      res.status(400).json({ error: 'A teamspace keeps at least one owner' });
      return;
    }
    if (current) await setTeamspaceMemberRole(db, params.id, params.userId, role);
    else await addTeamspaceMember(db, params.id, params.userId, role);
    res.json({ member: { userId: params.userId, role } });
  } catch (error: unknown) {
    fail(res, error, 'set teamspace member');
  }
});

router.delete('/teamspaces/:id/members/:userId', async (req: Request, res: Response) => {
  try {
    const params = z
      .object({ id: entityIdSchema, userId: z.string().min(1).max(200) })
      .parse(req.params);
    const at = await standing(req, res, params.id);
    if (!at) return;
    const self = params.userId === req.user?.id;
    if (!self && !at.manages) {
      refuse(res, 'Only its owners remove people from a teamspace');
      return;
    }
    if (at.teamspace.isDefault) {
      res
        .status(400)
        .json({ error: 'Every member of the workspace belongs to its default teamspace' });
      return;
    }
    if (await lastOwner(params.id, params.userId)) {
      res.status(400).json({ error: 'A teamspace keeps at least one owner' });
      return;
    }
    const removed = await removeTeamspaceMember(getDb(), params.id, params.userId);
    res.status(removed ? 204 : 404).end();
  } catch (error: unknown) {
    fail(res, error, 'remove teamspace member');
  }
});

router.post('/teamspaces/:id/join', async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: entityIdSchema }).parse(req.params);
    const at = await standing(req, res, id);
    if (!at) return;
    if (at.teamspace.privacy !== 'open' && !at.manages) {
      refuse(res, 'Only an open teamspace can be joined; ask one of its owners');
      return;
    }
    if (!at.role) await addTeamspaceMember(getDb(), id, req.user?.id ?? '', 'member');
    res.json({ teamspace: serializeTeamspace(at.teamspace, at.role ?? 'member') });
  } catch (error: unknown) {
    fail(res, error, 'join teamspace');
  }
});

export default router;
