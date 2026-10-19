import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateToken, oxyClient } from '../middleware/auth.js';
import { announceReset } from '../collab/live-rooms.js';
import { ensureNoteDatabases } from '../lib/databases/system.js';
import {
  ensurePersonalWorkspace,
  ensurePersonalWorkspaceFor,
  personalWorkspaceName,
  requireRole,
  requireWorkspaceMember,
} from '../middleware/workspace.js';
import { getDb } from '../db/client.js';
import {
  INVITABLE_WORKSPACE_ROLES,
  type InvitableWorkspaceRole,
  WORKSPACE_INVITE_TTL_MS,
  WORKSPACE_LINK_ROLES,
  type WorkspaceLinkRole,
  type WorkspaceRole,
} from '../db/schema/workspaces.js';
import { deleteGrantsOfUserInWorkspace, listGuestGrants } from '../repositories/pagePermissions.js';
import {
  acceptPendingInvites,
  anyPendingInvite,
  deletePendingInvite,
  findLiveInviteLink,
  listPendingInvites,
  replaceInviteLink,
  revokeLiveInviteLink,
  setLiveInviteLinkRole,
  type WorkspaceInviteLinkRow,
  type WorkspaceInviteRow,
  upsertPendingInvite,
} from '../repositories/workspaceInvites.js';
import { generateLinkToken, publicAppUrl } from '../lib/public-links.js';
import { deleteArchivedPages } from '../repositories/pages.js';
import {
  addMember,
  archiveWorkspace,
  createWorkspace,
  findMembership,
  listLiveWorkspacesByIds,
  listMembers,
  listMembershipsForUser,
  removeMember,
  resetPersonalWorkspace,
  transferOwnership,
  updateMemberRole,
  updateWorkspace,
} from '../repositories/workspaces.js';
import { log } from '../lib/logger.js';
import { ExportTooLarge, exportPagesZip, fileName, zipExports } from '../lib/export-zip.js';
import { findUserByEmail, loadMemberProfiles } from '../lib/member-profiles.js';
import { createWorkspaceSchema, updateWorkspaceSchema } from '../lib/workspace-input.js';

const router = Router();

// Members can be invited as any role except `owner`: a workspace has one
// owner, who hands it over with `POST /:id/transfer`.
const inviteMemberSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(INVITABLE_WORKSPACE_ROLES),
});

const inviteLinkSchema = z.object({ role: z.enum(WORKSPACE_LINK_ROLES).default('editor') });
const inviteLinkRoleSchema = z.object({ role: z.enum(WORKSPACE_LINK_ROLES) });
const transferSchema = z.object({ userId: z.string().min(1) });

/** The reset is confirmed by typing the workspace's current name. */
const resetWorkspaceSchema = z.object({ confirm: z.string() });

const updateMemberSchema = z.object({ role: z.enum(INVITABLE_WORKSPACE_ROLES) });

function paramString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function serializeInvite(invite: WorkspaceInviteRow, now = Date.now()) {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role as InvitableWorkspaceRole,
    invitedBy: invite.invitedBy,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    expired: invite.expiresAt.getTime() <= now,
  };
}

function serializeInviteLink(link: WorkspaceInviteLinkRow) {
  return {
    id: link.id,
    token: link.token,
    url: publicAppUrl(`/join/${link.token}`),
    role: link.role as WorkspaceLinkRole,
    createdBy: link.createdBy,
    createdAt: link.createdAt,
  };
}

/**
 * The caller's Oxy email: on the request when the session carried it, else
 * from their profile. Null when Oxy cannot say.
 */
async function callerEmail(req: Request): Promise<string | null> {
  const onRequest = req.user?.email;
  if (typeof onRequest === 'string' && onRequest) return onRequest;
  if (!req.user?.id) return null;
  try {
    const user = await oxyClient.users.get(req.user.id);
    return typeof user?.email === 'string' && user.email ? user.email : null;
  } catch (err: unknown) {
    log.general.warn({ err }, 'Could not read the caller email for pending invitations');
    return null;
  }
}

/**
 * Accept the invitations waiting for the caller's email (`docs/access.md`).
 * Asks Oxy for the email only while some invitation is waiting somewhere,
 * and never fails the request it runs in: an invitation not accepted now is
 * accepted on the next list.
 */
async function acceptInvitesForCaller(req: Request): Promise<void> {
  const userId = req.user?.id;
  if (!userId) return;
  try {
    const db = getDb();
    const now = new Date();
    if (!(await anyPendingInvite(db, now))) return;
    const email = await callerEmail(req);
    if (!email) return;
    await acceptPendingInvites(db, userId, email, now);
  } catch (err: unknown) {
    log.general.warn({ err }, 'Accepting pending workspace invitations failed');
  }
}

function serializeWorkspace(
  ws: {
    id: string;
    name: string;
    avatar: string | null;
    ownerId: string;
    isPersonal: boolean;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  role: WorkspaceRole | null,
) {
  return {
    id: ws.id,
    name: ws.name,
    avatar: ws.avatar,
    ownerId: ws.ownerId,
    isPersonal: ws.isPersonal,
    archivedAt: ws.archivedAt,
    createdAt: ws.createdAt,
    updatedAt: ws.updatedAt,
    role,
  };
}

/**
 * GET /api/workspaces
 *
 * Lists every workspace the caller is a member of: the personal one first,
 * then the newest workspace first (by when it was created, not when the
 * caller joined it). Personal workspace is created lazily on first access via
 * the `ensurePersonalWorkspace` middleware.
 */
router.get('/', authenticateToken, ensurePersonalWorkspace, async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await acceptInvitesForCaller(req);
    const db = getDb();
    const memberships = await listMembershipsForUser(db, req.user.id);

    if (memberships.length === 0) {
      res.json({ workspaces: [] });
      return;
    }

    const workspaces = await listLiveWorkspacesByIds(
      db,
      memberships.map((m) => m.workspaceId),
    );

    const roleByWorkspace = new Map<string, WorkspaceRole>();
    for (const m of memberships) {
      roleByWorkspace.set(m.workspaceId, m.role);
    }

    const serialized = workspaces
      .map((ws) => {
        const role = roleByWorkspace.get(ws.id) ?? null;
        return serializeWorkspace(
          {
            id: ws.id,
            name: ws.name,
            avatar: ws.avatar,
            ownerId: ws.ownerId,
            isPersonal: ws.isPersonal,
            archivedAt: ws.archivedAt,
            createdAt: ws.createdAt,
            updatedAt: ws.updatedAt,
          },
          role,
        );
      })
      // Stable ordering: personal first, then the newest workspace.
      .sort((a, b) => {
        if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

    res.json({ workspaces: serialized });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to list workspaces');
    res.status(500).json({ error: 'Failed to list workspaces' });
  }
});

/**
 * GET /api/workspaces/personal
 *
 * The caller's personal workspace, provisioned on the spot when it is missing.
 * The direct way in for a client that works in it alone, without listing
 * every workspace first.
 */
router.get('/personal', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const ws = await ensurePersonalWorkspaceFor(req.user.id);
    res.json({ workspace: serializeWorkspace(ws, 'owner') });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to load personal workspace');
    res.status(500).json({ error: 'Failed to load personal workspace' });
  }
});

/**
 * POST /api/workspaces
 *
 * Create a new shared workspace. Caller becomes the owner. Personal
 * workspaces cannot be created via this endpoint (they are auto-created).
 */
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const parsed = createWorkspaceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
      return;
    }

    const userId = req.user.id;
    const { name, avatar } = parsed.data;

    // ONE transaction: if the process died between the two writes, the
    // workspace would exist with no owner and nobody could reach it or delete
    // it. The transaction closes that window.
    const db = getDb();
    const workspace = await db.transaction(async (tx) => {
      const created = await createWorkspace(tx, {
        name,
        avatar: avatar ?? null,
        ownerId: userId,
        isPersonal: false,
      });
      const owner = await addMember(tx, {
        workspaceId: created.id,
        userId,
        role: 'owner',
        invitedBy: null,
      });
      if ('duplicate' in owner) {
        // Unreachable in practice — the workspace id was generated inside this
        // transaction, so no membership can already reference it. Throwing
        // rolls the whole thing back rather than returning a workspace whose
        // owner row silently did not land.
        throw new Error('owner membership collided on a freshly created workspace');
      }
      return created;
    });

    res.status(201).json({
      workspace: serializeWorkspace(
        {
          id: workspace.id,
          name: workspace.name,
          avatar: workspace.avatar,
          ownerId: workspace.ownerId,
          isPersonal: workspace.isPersonal,
          archivedAt: workspace.archivedAt,
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt,
        },
        'owner',
      ),
    });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to create workspace');
    res.status(500).json({ error: 'Failed to create workspace' });
  }
});

/**
 * GET /api/workspaces/:workspaceId
 *
 * Fetch a single workspace. Caller must be a member.
 */
router.get(
  '/:workspaceId',
  authenticateToken,
  requireWorkspaceMember,
  async (req: Request, res: Response) => {
    if (!req.workspaceDoc || !req.member) {
      res.status(500).json({ error: 'Workspace context not loaded' });
      return;
    }

    const ws = req.workspaceDoc;
    res.json({
      workspace: serializeWorkspace(
        {
          id: ws.id,
          name: ws.name,
          avatar: ws.avatar,
          ownerId: ws.ownerId,
          isPersonal: ws.isPersonal,
          archivedAt: ws.archivedAt,
          createdAt: ws.createdAt,
          updatedAt: ws.updatedAt,
        },
        req.member.role,
      ),
    });
  },
);

/**
 * PATCH /api/workspaces/:workspaceId
 *
 * Update workspace metadata (name, avatar). Admin role or higher.
 */
router.patch(
  '/:workspaceId',
  authenticateToken,
  requireWorkspaceMember,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      if (!req.workspaceDoc || !req.member) {
        res.status(500).json({ error: 'Workspace context not loaded' });
        return;
      }

      const parsed = updateWorkspaceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
        return;
      }

      const ws = req.workspaceDoc;
      const updated = await updateWorkspace(getDb(), ws.id, {
        name: parsed.data.name,
        avatar: parsed.data.avatar,
      });
      if (!updated) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      res.json({ workspace: serializeWorkspace(updated, req.member.role) });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to update workspace');
      res.status(500).json({ error: 'Failed to update workspace' });
    }
  },
);

/**
 * DELETE /api/workspaces/:workspaceId
 *
 * Soft-delete (archive) the workspace. Owner only. Personal workspaces
 * cannot be archived — the user always has their personal space.
 *
 * Cascade behavior for pages/blocks is intentionally out of scope here;
 * that lives in the Phase 1/Phase 4 cleanup work.
 */
router.delete(
  '/:workspaceId',
  authenticateToken,
  requireWorkspaceMember,
  requireRole('owner'),
  async (req: Request, res: Response) => {
    try {
      if (!req.workspaceDoc) {
        res.status(500).json({ error: 'Workspace context not loaded' });
        return;
      }

      const ws = req.workspaceDoc;
      if (ws.isPersonal) {
        res.status(400).json({ error: 'Personal workspaces cannot be archived' });
        return;
      }

      if (ws.archivedAt) {
        res.json({ success: true, alreadyArchived: true });
        return;
      }

      const archived = await archiveWorkspace(getDb(), ws.id);
      if (!archived) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }
      res.json({ success: true, archivedAt: archived.archivedAt });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to archive workspace');
      res.status(500).json({ error: 'Failed to archive workspace' });
    }
  },
);

/**
 * POST /api/workspaces/:workspaceId/reset
 *
 * Permanently empty the caller's personal workspace: every page, database,
 * comment and extra teamspace, with the name back to its default and no picture.
 * The id stays, so the workspace is the same one, empty. Owner only, personal
 * only (any other workspace is deleted instead), and confirmed by sending the
 * workspace's current name.
 */
router.post(
  '/:workspaceId/reset',
  authenticateToken,
  requireWorkspaceMember,
  requireRole('owner'),
  async (req: Request, res: Response) => {
    try {
      if (!req.workspaceDoc) {
        res.status(500).json({ error: 'Workspace context not loaded' });
        return;
      }
      const ws = req.workspaceDoc;
      if (!ws.isPersonal) {
        res.status(400).json({ error: 'Only a personal workspace can be reset' });
        return;
      }
      const parsed = resetWorkspaceSchema.safeParse(req.body);
      if (!parsed.success || parsed.data.confirm !== ws.name) {
        res.status(400).json({ error: 'Type the workspace name to confirm the reset' });
        return;
      }

      const name = await personalWorkspaceName(ws.ownerId);
      const db = getDb();
      const removed = await resetPersonalWorkspace(db, ws, name);
      // Empty, not missing: the apps built on it find their databases again.
      await ensureNoteDatabases(db, ws);
      announceReset(ws.id);
      res.json({ success: true, removed });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to reset workspace');
      res.status(500).json({ error: 'Failed to reset workspace' });
    }
  },
);

/**
 * GET /api/workspaces/:workspaceId/members
 *
 * List all members of a workspace with their roles. Any member can view.
 */
router.get(
  '/:workspaceId/members',
  authenticateToken,
  requireWorkspaceMember,
  async (req: Request, res: Response) => {
    try {
      if (!req.workspaceDoc) {
        res.status(500).json({ error: 'Workspace context not loaded' });
        return;
      }

      const members = await listMembers(getDb(), req.workspaceDoc.id);
      const profiles = await loadMemberProfiles(members.map((m) => m.userId));

      res.json({
        members: members.map((m) => ({
          userId: m.userId,
          role: m.role,
          invitedBy: m.invitedBy,
          joinedAt: m.joinedAt,
          user: profiles.get(m.userId) ?? null,
        })),
      });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to list workspace members');
      res.status(500).json({ error: 'Failed to list members' });
    }
  },
);

/**
 * POST /api/workspaces/:workspaceId/members
 *
 * Invite someone by email. Admin role or higher. An Oxy account with that
 * email becomes a member now (201 `{ member }`); any other email gets an
 * invitation that waits for an account with it (201 `{ pending, invite }`).
 * Nilo creates no Oxy account on anyone's behalf.
 */
router.post(
  '/:workspaceId/members',
  authenticateToken,
  requireWorkspaceMember,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      if (!req.workspaceDoc || !req.user?.id) {
        res.status(500).json({ error: 'Workspace context not loaded' });
        return;
      }

      const parsed = inviteMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
        return;
      }

      const { email, role } = parsed.data;

      const ws = req.workspaceDoc;
      if (ws.isPersonal) {
        res.status(400).json({ error: 'Personal workspaces cannot have additional members' });
        return;
      }

      const invitee = await findUserByEmail(email);
      if (!invitee) {
        // Someone without an Oxy account yet: the invitation waits for them,
        // and their first workspace list accepts it. Nilo has no outbound
        // mail, so whoever invited them tells them.
        const invite = await upsertPendingInvite(getDb(), {
          workspaceId: ws.id,
          email,
          role,
          invitedBy: req.user.id,
          expiresAt: new Date(Date.now() + WORKSPACE_INVITE_TTL_MS),
        });
        res.status(201).json({ pending: true, invite: serializeInvite(invite) });
        return;
      }

      // The LOUD counterpart to the idempotent provisioning path: "already a
      // member" is an answer this caller must show the user as a 409, not
      // swallow. `addMember` uses ON CONFLICT DO NOTHING RETURNING so a real
      // infrastructure failure still propagates to the outer error handler.
      const result = await addMember(getDb(), {
        workspaceId: ws.id,
        userId: invitee.id,
        role,
        invitedBy: req.user.id,
      });

      if ('duplicate' in result) {
        res.status(409).json({ error: 'That user is already a member' });
        return;
      }

      res.status(201).json({
        member: {
          userId: result.member.userId,
          role: result.member.role,
          invitedBy: result.member.invitedBy,
          joinedAt: result.member.joinedAt,
        },
      });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to invite member');
      res.status(500).json({ error: 'Failed to invite member' });
    }
  },
);

/**
 * PATCH /api/workspaces/:workspaceId/members/:userId
 *
 * Change a member's role. Admin or higher. The owner's role cannot be
 * changed here: the owner hands the workspace over with `POST /:id/transfer`.
 */
router.patch(
  '/:workspaceId/members/:userId',
  authenticateToken,
  requireWorkspaceMember,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      if (!req.workspaceDoc) {
        res.status(500).json({ error: 'Workspace context not loaded' });
        return;
      }

      const parsed = updateMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
        return;
      }

      const targetUserId = typeof req.params.userId === 'string' ? req.params.userId : null;
      if (!targetUserId) {
        res.status(400).json({ error: 'Target user id required' });
        return;
      }

      const target = await findMembership(getDb(), req.workspaceDoc.id, targetUserId);
      if (!target) {
        res.status(404).json({ error: 'Member not found' });
        return;
      }
      if (target.role === 'owner') {
        res.status(400).json({ error: "Cannot change the owner's role" });
        return;
      }

      const updated = await updateMemberRole(
        getDb(),
        req.workspaceDoc.id,
        targetUserId,
        parsed.data.role,
      );
      if (!updated) {
        res.status(404).json({ error: 'Member not found' });
        return;
      }

      res.json({
        member: {
          userId: updated.userId,
          role: updated.role,
          invitedBy: updated.invitedBy,
          joinedAt: updated.joinedAt,
        },
      });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to update member role');
      res.status(500).json({ error: 'Failed to update member' });
    }
  },
);

/**
 * DELETE /api/workspaces/:workspaceId/members/:userId
 *
 * Remove a member. The owner cannot be removed. Admins can remove anyone
 * except the owner. Any member can remove themselves (self-leave).
 */
router.delete(
  '/:workspaceId/members/:userId',
  authenticateToken,
  requireWorkspaceMember,
  async (req: Request, res: Response) => {
    try {
      if (!req.workspaceDoc || !req.user?.id || !req.member) {
        res.status(500).json({ error: 'Workspace context not loaded' });
        return;
      }

      const targetUserId = typeof req.params.userId === 'string' ? req.params.userId : null;
      if (!targetUserId) {
        res.status(400).json({ error: 'Target user id required' });
        return;
      }

      const isSelfRemoval = targetUserId === req.user.id;
      const callerIsAdminOrHigher = req.member.role === 'admin' || req.member.role === 'owner';

      if (!isSelfRemoval && !callerIsAdminOrHigher) {
        res.status(403).json({ error: 'Forbidden: only admins can remove other members' });
        return;
      }

      const target = await findMembership(getDb(), req.workspaceDoc.id, targetUserId);
      if (!target) {
        res.status(404).json({ error: 'Member not found' });
        return;
      }
      if (target.role === 'owner') {
        res.status(400).json({
          error: 'The owner cannot be removed; transfer the workspace to another member first',
          code: 'OWNER_CANNOT_LEAVE',
        });
        return;
      }

      // `removeMember` reports off RETURNING: `rows.length` on a bare DELETE
      // is 0 whether or not anything went.
      const removed = await removeMember(getDb(), req.workspaceDoc.id, targetUserId);
      if (!removed) {
        res.status(404).json({ error: 'Member not found' });
        return;
      }
      res.json({ success: true });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to remove member');
      res.status(500).json({ error: 'Failed to remove member' });
    }
  },
);

/**
 * POST /api/workspaces/:workspaceId/trash/empty
 *
 * Hard-deletes every archived page in the workspace and their blocks.
 * Owner only — irreversible. Returns the count of removed pages.
 */
router.post(
  '/:workspaceId/trash/empty',
  authenticateToken,
  requireWorkspaceMember,
  requireRole('owner'),
  async (req: Request, res: Response) => {
    try {
      if (!req.workspaceDoc) {
        res.status(500).json({ error: 'Workspace context not loaded' });
        return;
      }

      // Blocks are removed by the `blocks.page_id -> pages.id` cascade, so the
      // explicit Block.deleteMany is gone rather than reimplemented — an
      // application-level cascade racing the database one is worse than either
      // alone. The count comes from RETURNING; the old code fell back to
      // `ids.length` when deletedCount was absent, which reports a full delete
      // for a partial one.
      // The old early return for "nothing archived" is gone with the query it
      // guarded: one statement that deletes zero rows returns 0, which is the
      // same answer for one fewer round trip.
      const deleted = await deleteArchivedPages(getDb(), req.workspaceDoc.id);

      res.json({ success: true, deleted });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to empty workspace trash');
      res.status(500).json({ error: 'Failed to empty trash' });
    }
  },
);

/**
 * GET /api/workspaces/:workspaceId/export?format=md|html
 *
 * Every page the caller can open, as a ZIP of Markdown or HTML files in
 * folders by subpage (`lib/export-zip.ts`). A member's export: what is
 * someone else's and private stays out.
 */
router.get(
  '/:workspaceId/export',
  authenticateToken,
  requireWorkspaceMember,
  zipExports,
  async (req: Request, res: Response) => {
    try {
      const { format } = z
        .object({ format: z.enum(['md', 'markdown', 'html']).default('md') })
        .parse(req.query);
      if (!req.workspaceDoc) {
        res.status(500).json({ error: 'Workspace context not loaded' });
        return;
      }
      const zip = await exportPagesZip(getDb(), {
        viewerId: req.user?.id ?? '',
        workspaceId: req.workspaceDoc.id,
        rootIds: null,
        format: format === 'html' ? 'html' : 'md',
      });
      const name = req.workspaceDoc.name?.trim() || 'Workspace';
      const ascii =
        fileName(name)
          .replace(/[^a-zA-Z0-9-_]+/gu, '-')
          .replace(/^-+|-+$/g, '') || 'workspace';
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${ascii}.zip"; filename*=UTF-8''${encodeURIComponent(`${name}.zip`)}`,
      );
      res.send(Buffer.from(zip.bytes));
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid input', details: error.errors });
        return;
      }
      if (error instanceof ExportTooLarge) {
        res
          .status(413)
          .json({ error: 'Too many pages to export at once', code: 'EXPORT_TOO_LARGE' });
        return;
      }
      log.general.error({ err: error }, 'Failed to export workspace');
      res.status(500).json({ error: 'Failed to export workspace' });
    }
  },
);

/**
 * GET /api/workspaces/:workspaceId/invites
 *
 * The invitations by email still waiting for an Oxy account (expired ones
 * flagged). Admin role or higher.
 */
router.get(
  '/:workspaceId/invites',
  authenticateToken,
  requireWorkspaceMember,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      if (!req.workspaceDoc) {
        res.status(500).json({ error: 'Workspace context not loaded' });
        return;
      }
      const invites = await listPendingInvites(getDb(), req.workspaceDoc.id);
      const now = Date.now();
      res.json({ invites: invites.map((invite) => serializeInvite(invite, now)) });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to list workspace invitations');
      res.status(500).json({ error: 'Failed to list invitations' });
    }
  },
);

/**
 * DELETE /api/workspaces/:workspaceId/invites/:inviteId
 *
 * Revoke a waiting invitation. Admin role or higher.
 */
router.delete(
  '/:workspaceId/invites/:inviteId',
  authenticateToken,
  requireWorkspaceMember,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      const inviteId = paramString(req.params.inviteId);
      if (!req.workspaceDoc || !inviteId) {
        res.status(400).json({ error: 'Invitation id required' });
        return;
      }
      const removed = await deletePendingInvite(getDb(), req.workspaceDoc.id, inviteId);
      if (!removed) {
        res.status(404).json({ error: 'Invitation not found' });
        return;
      }
      res.json({ success: true });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to revoke workspace invitation');
      res.status(500).json({ error: 'Failed to revoke invitation' });
    }
  },
);

/**
 * GET /api/workspaces/:workspaceId/invite-link
 *
 * The workspace's join link, or null when it has none (disabled). Admin role
 * or higher: the token lets anyone in.
 */
router.get(
  '/:workspaceId/invite-link',
  authenticateToken,
  requireWorkspaceMember,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      if (!req.workspaceDoc) {
        res.status(500).json({ error: 'Workspace context not loaded' });
        return;
      }
      const link = await findLiveInviteLink(getDb(), req.workspaceDoc.id);
      res.json({ link: link ? serializeInviteLink(link) : null });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to read the workspace invite link');
      res.status(500).json({ error: 'Failed to load the invite link' });
    }
  },
);

/**
 * POST /api/workspaces/:workspaceId/invite-link { role? }
 *
 * Enable the join link, or regenerate it: the old link stops working and a
 * new one (a new token) gives `role` (`editor` when absent). Admin role or
 * higher; never on a personal workspace.
 */
router.post(
  '/:workspaceId/invite-link',
  authenticateToken,
  requireWorkspaceMember,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      if (!req.workspaceDoc || !req.user?.id) {
        res.status(500).json({ error: 'Workspace context not loaded' });
        return;
      }
      if (req.workspaceDoc.isPersonal) {
        res.status(400).json({ error: 'Personal workspaces cannot have additional members' });
        return;
      }
      const parsed = inviteLinkSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
        return;
      }
      const link = await replaceInviteLink(
        getDb(),
        {
          workspaceId: req.workspaceDoc.id,
          token: generateLinkToken(),
          role: parsed.data.role,
          createdBy: req.user.id,
        },
        new Date(),
      );
      res.status(201).json({ link: serializeInviteLink(link) });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to create the workspace invite link');
      res.status(500).json({ error: 'Failed to create the invite link' });
    }
  },
);

/**
 * PATCH /api/workspaces/:workspaceId/invite-link { role }
 *
 * Change the role the live link gives; the link itself stays. Admin role or
 * higher. 404 when the link is disabled.
 */
router.patch(
  '/:workspaceId/invite-link',
  authenticateToken,
  requireWorkspaceMember,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      if (!req.workspaceDoc) {
        res.status(500).json({ error: 'Workspace context not loaded' });
        return;
      }
      const parsed = inviteLinkRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
        return;
      }
      const link = await setLiveInviteLinkRole(getDb(), req.workspaceDoc.id, parsed.data.role);
      if (!link) {
        res.status(404).json({ error: 'The invite link is disabled' });
        return;
      }
      res.json({ link: serializeInviteLink(link) });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to update the workspace invite link');
      res.status(500).json({ error: 'Failed to update the invite link' });
    }
  },
);

/**
 * DELETE /api/workspaces/:workspaceId/invite-link
 *
 * Disable the join link. The people it brought in stay members.
 */
router.delete(
  '/:workspaceId/invite-link',
  authenticateToken,
  requireWorkspaceMember,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      if (!req.workspaceDoc) {
        res.status(500).json({ error: 'Workspace context not loaded' });
        return;
      }
      const revoked = await revokeLiveInviteLink(getDb(), req.workspaceDoc.id, new Date());
      res.json({ success: true, alreadyDisabled: !revoked });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to disable the workspace invite link');
      res.status(500).json({ error: 'Failed to disable the invite link' });
    }
  },
);

/**
 * POST /api/workspaces/:workspaceId/transfer { userId }
 *
 * The owner makes another member the owner and stays as an admin. Owner
 * only, never a personal workspace (`docs/access.md`).
 */
router.post(
  '/:workspaceId/transfer',
  authenticateToken,
  requireWorkspaceMember,
  requireRole('owner'),
  async (req: Request, res: Response) => {
    try {
      if (!req.workspaceDoc || !req.user?.id) {
        res.status(500).json({ error: 'Workspace context not loaded' });
        return;
      }
      const ws = req.workspaceDoc;
      if (ws.isPersonal) {
        res.status(400).json({ error: 'A personal workspace cannot be transferred' });
        return;
      }
      const parsed = transferSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
        return;
      }
      const toUserId = parsed.data.userId;
      if (toUserId === req.user.id) {
        res.status(400).json({ error: 'You already own this workspace' });
        return;
      }
      const db = getDb();
      if (!(await findMembership(db, ws.id, toUserId))) {
        res.status(404).json({ error: 'Member not found' });
        return;
      }
      if (!(await transferOwnership(db, ws.id, req.user.id, toUserId))) {
        res.status(409).json({ error: 'The workspace changed meanwhile; try again' });
        return;
      }
      res.json({ success: true, ownerId: toUserId });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to transfer workspace ownership');
      res.status(500).json({ error: 'Failed to transfer the workspace' });
    }
  },
);

/**
 * GET /api/workspaces/:workspaceId/guests
 *
 * The workspace's guests: people with pages shared with them who are not its
 * members, each with those pages and their role on each. Admin role or higher.
 */
router.get(
  '/:workspaceId/guests',
  authenticateToken,
  requireWorkspaceMember,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      if (!req.workspaceDoc) {
        res.status(500).json({ error: 'Workspace context not loaded' });
        return;
      }
      const grants = await listGuestGrants(getDb(), req.workspaceDoc.id);
      const byUser = new Map<string, typeof grants>();
      for (const grant of grants) {
        const list = byUser.get(grant.userId) ?? [];
        list.push(grant);
        byUser.set(grant.userId, list);
      }
      const profiles = await loadMemberProfiles([...byUser.keys()]);
      res.json({
        guests: [...byUser.entries()].map(([userId, list]) => ({
          userId,
          user: profiles.get(userId) ?? null,
          pages: list.map((grant) => ({
            pageId: grant.pageId,
            title: grant.title,
            icon: grant.icon,
            role: grant.role,
            grantedBy: grant.grantedBy,
            sharedAt: grant.createdAt,
          })),
        })),
      });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to list workspace guests');
      res.status(500).json({ error: 'Failed to list guests' });
    }
  },
);

/**
 * DELETE /api/workspaces/:workspaceId/guests/:userId
 *
 * Remove a guest: no page of the workspace is shared with them any more.
 * Admin role or higher. A member is removed as a member instead (400).
 */
router.delete(
  '/:workspaceId/guests/:userId',
  authenticateToken,
  requireWorkspaceMember,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      const userId = paramString(req.params.userId);
      if (!req.workspaceDoc || !userId) {
        res.status(400).json({ error: 'Guest id required' });
        return;
      }
      const db = getDb();
      if (await findMembership(db, req.workspaceDoc.id, userId)) {
        res.status(400).json({ error: 'That person is a member, not a guest' });
        return;
      }
      const removed = await deleteGrantsOfUserInWorkspace(db, req.workspaceDoc.id, userId);
      if (removed === 0) {
        res.status(404).json({ error: 'Guest not found' });
        return;
      }
      res.json({ success: true, removed });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to remove workspace guest');
      res.status(500).json({ error: 'Failed to remove guest' });
    }
  },
);

export default router;
