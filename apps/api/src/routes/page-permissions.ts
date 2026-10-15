/**
 * Who a page is shared with: list, grant and take away access.
 *
 * The rule for what a grant gives is in `lib/page-access.ts`. Managing access
 * needs edit access to the page, and nobody hands out more than they hold:
 * `admin` (full access) is granted only by someone with full access.
 */
import { Router, type Request, type Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { PAGE_GRANT_ROLES, type PageGrantRole } from '../db/schema/collab.js';
import { compareRoles, hasRole } from '../db/schema/workspaces.js';
import { log } from '../lib/logger.js';
import { sendNotification } from '../lib/notification-service.js';
import { checkPageAccess, grantReach } from '../lib/page-access.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  deleteGrant,
  findGrant,
  listGrantsOnPages,
  upsertGrant,
} from '../repositories/pagePermissions.js';
import { findPageById } from '../repositories/pages.js';

const router = Router();

const entityIdSchema = z.string().refine(isLiveEntityId, 'Invalid id');
/** Oxy user ids are opaque; bounded and trimmed, never interpreted. */
const userIdSchema = z.string().trim().min(1).max(128);
const grantSchema = z.object({
  role: z.enum(PAGE_GRANT_ROLES as unknown as [PageGrantRole, ...PageGrantRole[]]),
});

function handleZodError(err: unknown, res: Response): boolean {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.errors });
    return true;
  }
  return false;
}

/**
 * GET /pages/:pageId/permissions
 *
 * Who can open the page: whether it is restricted (itself or from above),
 * and the grants that reach it — its own and those inherited from the pages
 * above it up to the nearest restricted one. Anyone who can open the page
 * can see this, as in Notion's share menu.
 */
router.get('/pages/:pageId/permissions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { pageId } = z.object({ pageId: entityIdSchema }).parse(req.params);
    const db = getDb();
    const access = await checkPageAccess(req, res, db, pageId, 'viewer');
    if (!access) return;

    const reach = grantReach(access.chain);
    const grants = await listGrantsOnPages(db, reach.ids);
    // The nearest grant per person is the one that applies to show; a
    // stronger one further up still counts (effective role is the maximum).
    const byUser = new Map<string, (typeof grants)[number]>();
    const depth = new Map(reach.ids.map((id, i) => [id, i]));
    for (const grant of grants) {
      const current = byUser.get(grant.userId);
      if (!current || compareRoles(grant.role, current.role) > 0) byUser.set(grant.userId, grant);
    }

    res.json({
      pageId,
      restricted: access.chain[0]?.restricted ?? false,
      // Restricted by a page above: open only to the people below it.
      restrictedFrom:
        reach.restricted && !(access.chain[0]?.restricted ?? false)
          ? (reach.ids.at(-1) ?? null)
          : null,
      // Every member reaches it through their workspace role.
      openToWorkspace: !reach.restricted,
      role: access.role,
      grants: [...byUser.values()]
        .sort(
          (a, b) =>
            (depth.get(a.pageId) ?? 0) - (depth.get(b.pageId) ?? 0) || compareRoles(b.role, a.role),
        )
        .map((grant) => ({
          userId: grant.userId,
          role: grant.role,
          grantedBy: grant.grantedBy,
          // Inherited from this page above (null when granted here).
          inheritedFrom: grant.pageId === pageId ? null : grant.pageId,
          viaShareLink: grant.shareLinkId !== null,
          createdAt: grant.createdAt,
        })),
    });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to list page permissions');
    res.status(500).json({ error: 'Failed to list page permissions' });
  }
});

/**
 * PUT /pages/:pageId/permissions/:userId { role }
 *
 * Share the page (and its subtree) with a person, or change their role on it.
 * They are told by notification the first time.
 */
router.put(
  '/pages/:pageId/permissions/:userId',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { pageId, userId } = z
        .object({ pageId: entityIdSchema, userId: userIdSchema })
        .parse(req.params);
      const { role } = grantSchema.parse(req.body);
      const db = getDb();
      const access = await checkPageAccess(req, res, db, pageId, 'editor');
      if (!access) return;
      const callerId = req.user?.id as string;
      if (compareRoles(role, access.role) > 0) {
        res.status(403).json({
          error: 'You cannot give more access than you have',
          code: 'INSUFFICIENT_ROLE',
          required: role,
          actual: access.role,
        });
        return;
      }
      const page = await findPageById(db, pageId);
      if (!page) {
        res.status(404).json({ error: 'Page not found' });
        return;
      }
      const existing = await findGrant(db, pageId, userId);
      // Someone else's stronger grant is only changed by someone at least as strong.
      if (existing && compareRoles(existing.role, access.role) > 0) {
        res
          .status(403)
          .json({ error: 'That person has more access than you', code: 'INSUFFICIENT_ROLE' });
        return;
      }
      const grant = await upsertGrant(db, { pageId, userId, role, grantedBy: callerId });

      if (!existing && userId !== callerId) {
        try {
          await sendNotification({
            userId,
            type: 'page_shared',
            title: `A page was shared with you: ${page.title || 'Untitled'}`,
            body: '',
            priority: 'normal',
            data: { pageId, workspaceId: page.workspaceId, role, sharedBy: callerId },
          });
        } catch (err: unknown) {
          log.general.warn({ err, pageId, userId }, 'Failed to notify about a shared page');
        }
      }

      res.json({ grant: { userId: grant.userId, role: grant.role, grantedBy: grant.grantedBy } });
    } catch (error: unknown) {
      if (handleZodError(error, res)) return;
      log.general.error({ err: error }, 'Failed to share page');
      res.status(500).json({ error: 'Failed to share page' });
    }
  },
);

/**
 * DELETE /pages/:pageId/permissions/:userId
 *
 * Take a person's grant on this page away (inherited grants are removed on
 * the page that holds them). Anyone may remove their own.
 */
router.delete(
  '/pages/:pageId/permissions/:userId',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { pageId, userId } = z
        .object({ pageId: entityIdSchema, userId: userIdSchema })
        .parse(req.params);
      const db = getDb();
      const callerId = req.user?.id as string;
      const existing = await findGrant(db, pageId, userId);
      if (!existing) {
        res.status(404).json({ error: 'No grant for that person on this page' });
        return;
      }
      if (userId !== callerId) {
        const access = await checkPageAccess(req, res, db, pageId, 'editor');
        if (!access) return;
        if (
          compareRoles(existing.role, access.role) > 0 ||
          (existing.role === 'admin' && !hasRole(access.role, 'admin'))
        ) {
          res
            .status(403)
            .json({ error: 'That person has more access than you', code: 'INSUFFICIENT_ROLE' });
          return;
        }
      }
      await deleteGrant(db, pageId, userId);
      res.json({ success: true });
    } catch (error: unknown) {
      if (handleZodError(error, res)) return;
      log.general.error({ err: error }, 'Failed to remove page access');
      res.status(500).json({ error: 'Failed to remove page access' });
    }
  },
);

export default router;
