/** Historical page activity, separate from content version snapshots. */
import { isLiveEntityId } from '@oxy.so/db';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { log } from '../lib/logger.js';
import { checkPageAccess, resolveDatabaseRole } from '../lib/page-access.js';
import { findDatabaseById } from '../repositories/databases.js';
import { findPageById } from '../repositories/pages.js';
import { authenticateToken } from '../middleware/auth.js';
import { type ActivityCursor, listPageActivity } from '../repositories/pageActivity.js';

const router = Router();
const idSchema = z.string().refine(isLiveEntityId, 'Invalid id');
const cursorSchema = z
  .object({ pageId: idSchema, createdAt: z.string().datetime(), id: idSchema })
  .strict();
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(1024).optional(),
});

router.get('/pages/:id/activity', authenticateToken, async (req: Request, res: Response) => {
  try {
    const id = idSchema.parse(req.params.id);
    const { limit, cursor: rawCursor } = querySchema.parse(req.query);
    // Authorize before reading any history, including when a cursor is supplied.
    const db = getDb();
    if (!(await checkPageAccess(req, res, db, id, 'editor'))) return;
    let cursor: ActivityCursor | undefined;
    if (rawCursor !== undefined) {
      try {
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8')),
        ) as ActivityCursor;
        if (cursor.pageId !== id) throw new Error('Wrong page');
      } catch {
        res.status(400).json({ error: 'Invalid activity cursor' });
        return;
      }
    }
    const result = await listPageActivity(db, id, limit, cursor);
    if (result.items.some((event) => event.changes.some((change) => change.property))) {
      const page = await findPageById(db, id);
      const database = page?.databaseId ? await findDatabaseById(db, page.databaseId) : undefined;
      const canReadSchema =
        database && req.user?.id && (await resolveDatabaseRole(db, req.user.id, database));
      if (!canReadSchema) {
        for (const event of result.items) {
          event.changes = event.changes.map(({ property: _property, ...change }) => change);
        }
      }
    }
    res.json(result);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    log.general.error({ err: error }, 'Failed to list page activity');
    res.status(500).json({ error: 'Failed to list page activity' });
  }
});

export default router;
