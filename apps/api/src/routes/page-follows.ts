/**
 * Following a page: `GET /pages/:id/follow` (am I following it),
 * `PUT` to follow, `DELETE` to stop. Followers hear of new comments.
 */
import { Router, type Request, type Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { log } from '../lib/logger.js';
import { checkPageAccess } from '../lib/page-access.js';
import { authenticateToken } from '../middleware/auth.js';
import { follow, isFollowing, unfollow } from '../repositories/pageFollows.js';

const router = Router();
const params = z.object({ id: z.string().refine(isLiveEntityId, 'Invalid id') });

for (const method of ['get', 'put', 'delete'] as const) {
  router[method]('/pages/:id/follow', authenticateToken, async (req: Request, res: Response) => {
    try {
      const { id } = params.parse(req.params);
      const db = getDb();
      if (!(await checkPageAccess(req, res, db, id, 'viewer'))) return;
      const userId = req.user?.id as string;
      if (method === 'put') await follow(db, id, userId);
      if (method === 'delete') await unfollow(db, id, userId);
      res.json({ following: await isFollowing(db, id, userId) });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid input', details: error.errors });
        return;
      }
      log.general.error({ err: error }, 'Failed to change following');
      res.status(500).json({ error: 'Failed to change following' });
    }
  });
}

export default router;
