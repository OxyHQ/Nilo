/**
 * A workspace's join link from the side of whoever opens it
 * (`/join/<token>` in the app). Made and managed under
 * `/workspaces/:id/invite-link` (`routes/workspaces.ts`).
 */
import { Router, type Request, type Response } from 'express';
import { getDb } from '../db/client.js';
import type { WorkspaceRole } from '../db/schema/workspaces.js';
import { log } from '../lib/logger.js';
import { plausibleLinkToken } from '../lib/public-links.js';
import { rateLimit } from '../lib/rate-limit.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  findInviteLinkByToken,
  type WorkspaceInviteLinkRow,
} from '../repositories/workspaceInvites.js';
import {
  addMemberIfAbsent,
  findLiveWorkspaceById,
  findMembership,
  type WorkspaceRow,
} from '../repositories/workspaces.js';

const router = Router();

function paramString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The workspace a join link opens, or why it opens nothing: 404 for a link
 * that never was, 410 for one disabled or regenerated (so the reader asks
 * for the new one instead of doubting the URL).
 */
async function findLinkedWorkspace(
  token: string | null,
): Promise<
  { link: WorkspaceInviteLinkRow; workspace: WorkspaceRow } | { status: 404 | 410; error: string }
> {
  if (!plausibleLinkToken(token)) return { status: 404, error: 'Invite link not found' };
  const db = getDb();
  const link = await findInviteLinkByToken(db, token);
  if (!link) return { status: 404, error: 'Invite link not found' };
  if (link.revokedAt) return { status: 410, error: 'Invite link has been disabled' };
  const workspace = await findLiveWorkspaceById(db, link.workspaceId);
  if (!workspace || workspace.isPersonal) {
    return { status: 404, error: 'The workspace is no longer available' };
  }
  return { link, workspace };
}

/**
 * GET /api/invite-links/:token
 *
 * What a join link leads to, before joining: the workspace's name and
 * picture and the role it gives. Public (the token is the secret).
 */
router.get(
  '/invite-links/:token',
  rateLimit('invite-link-read', { max: 120, windowMs: 60_000 }),
  async (req: Request, res: Response) => {
    try {
      const found = await findLinkedWorkspace(paramString(req.params.token));
      if ('error' in found) {
        res.status(found.status).json({ error: found.error });
        return;
      }
      const { link, workspace } = found;
      res.json({
        workspace: { id: workspace.id, name: workspace.name, avatar: workspace.avatar },
        role: link.role,
      });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to resolve invite link');
      res.status(500).json({ error: 'Failed to load the invite link' });
    }
  },
);

/**
 * POST /api/invite-links/:token/join
 *
 * The signed-in caller joins the workspace with the link's role. Someone
 * already a member keeps their role (`joined: false`). Answers with the
 * workspace id and the caller's role in it.
 */
router.post(
  '/invite-links/:token/join',
  rateLimit('invite-link-join', { max: 30, windowMs: 60_000 }),
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const found = await findLinkedWorkspace(paramString(req.params.token));
      if ('error' in found) {
        res.status(found.status).json({ error: found.error });
        return;
      }
      const { link, workspace } = found;
      const db = getDb();
      const added = await db.transaction((tx) =>
        addMemberIfAbsent(tx, {
          workspaceId: workspace.id,
          userId,
          role: link.role,
          invitedBy: link.createdBy,
        }),
      );
      const role: WorkspaceRole | null =
        added?.role ?? (await findMembership(db, workspace.id, userId))?.role ?? null;
      res
        .status(added ? 201 : 200)
        .json({ workspaceId: workspace.id, role, joined: Boolean(added) });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to join through invite link');
      res.status(500).json({ error: 'Failed to join the workspace' });
    }
  },
);

export default router;
