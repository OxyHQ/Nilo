import { isLiveEntityId } from '@oxy.so/db';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { log } from '../lib/logger.js';
import { navigationNeighbors, NavigationRejected } from '../lib/navigation-neighbors.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
const paramsSchema = z.object({ id: z.string().refine(isLiveEntityId, 'Invalid id') });
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).default(6),
  cursor: z.string().min(1).max(2048).optional(),
});
for (const kind of ['page', 'database'] as const) {
  router.get(`/${kind}s/:id/neighbors`, authenticateToken, async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { id } = paramsSchema.parse(req.params);
      const { limit, cursor } = querySchema.parse(req.query);
      // Access and candidates share a snapshot: a request cannot mix locations or grants.
      const result = await getDb().transaction(
        (tx) => navigationNeighbors(tx, userId, kind, id, limit, cursor),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      res.json(result);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid input' });
        return;
      }
      if (error instanceof NavigationRejected) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      log.general.error({ err: error }, 'Failed to list navigation neighbors');
      res.status(500).json({ error: 'Failed to list navigation neighbors' });
    }
  });
}
export default router;
