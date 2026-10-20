/**
 * Recents that follow a person from device to device, as Notion's do: the
 * app records each page it opens (`POST /pages/:id/visit`) and lists the
 * latest (`GET /pages/recent`), only those the caller can still open.
 *
 * Mounted before `routes/pages.ts`, whose `GET /pages/:id` would otherwise
 * read `recent` as a page id.
 */
import { Router, type Request, type Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { log } from '../lib/logger.js';
import { checkPageAccess, visiblePagesOf } from '../lib/page-access.js';
import { authenticateToken } from '../middleware/auth.js';
import { findPageById } from '../repositories/pages.js';
import { listRecentVisits, recordVisit } from '../repositories/pageVisits.js';
import { findLiveWorkspaceById } from '../repositories/workspaces.js';

const router = Router();

const entityId = z.string().refine(isLiveEntityId, 'Invalid id');

const recentQuerySchema = z.object({
  workspaceId: entityId,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * GET /pages/recent?workspaceId&limit — the pages of the workspace the caller
 * opened, the latest first, that they can still open. Members and guests alike.
 */
router.get('/pages/recent', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { workspaceId, limit } = recentQuerySchema.parse(req.query);
    const userId = req.user?.id ?? '';
    const db = getDb();
    // More than `limit`: some may be closed to the caller since.
    const [workspace, { viewer, grants, byId, roles }, visits] = await Promise.all([
      findLiveWorkspaceById(db, workspaceId),
      visiblePagesOf(db, workspaceId, userId, { archived: false }),
      listRecentVisits(db, userId, workspaceId, limit * 2),
    ]);
    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (!viewer.memberRole && grants.length === 0) {
      res.status(403).json({ error: 'Forbidden: nothing in this workspace is shared with you' });
      return;
    }
    const recent = [];
    for (const visit of visits) {
      const page = byId.get(visit.pageId);
      if (!page || !roles.has(page.id)) continue;
      recent.push({
        id: page.id,
        title: page.title,
        icon: page.icon,
        parentId: page.parentId,
        databaseId: page.databaseId,
        visitedAt: visit.visitedAt,
      });
      if (recent.length >= limit) break;
    }
    res.json({ pages: recent });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    log.general.error({ err: error }, 'Failed to list recent pages');
    res.status(500).json({ error: 'Failed to list recent pages' });
  }
});

/** POST /pages/:id/visit — the caller opened the page (viewer access or more). */
router.post('/pages/:id/visit', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: entityId }).parse(req.params);
    const db = getDb();
    const page = await findPageById(db, id);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    if (!(await checkPageAccess(req, res, db, page.id, 'viewer'))) return;
    const visitedAt = await recordVisit(db, req.user?.id as string, page.id);
    res.json({ visitedAt });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    log.general.error({ err: error }, 'Failed to record a page visit');
    res.status(500).json({ error: 'Failed to record the visit' });
  }
});

export default router;
