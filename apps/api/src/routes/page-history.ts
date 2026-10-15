/**
 * Page history: the versions kept of a page's blocks, one version's blocks,
 * and restoring a version (`lib/page-history.ts`). Restoring goes through the
 * same transaction path as editing, so open editors receive it live, and it
 * keeps the state it replaces as a version first.
 */
import { Router, type Request, type Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { applyBlockTransaction, TransactionRejected } from '../lib/block-transactions.js';
import { log } from '../lib/logger.js';
import { restoreOperations } from '../lib/page-history.js';
import { checkPageAccess } from '../lib/page-access.js';
import { authenticateToken } from '../middleware/auth.js';
import { findPageVersion, listPageVersions, snapshotPage } from '../repositories/pageVersions.js';

const router = Router();
const entityIdSchema = z.string().refine(isLiveEntityId, 'Invalid id');

function badInput(error: unknown, res: Response): boolean {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: error.errors });
    return true;
  }
  return false;
}

/** GET /pages/:id/versions — newest first. */
router.get('/pages/:id/versions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: entityIdSchema }).parse(req.params);
    const db = getDb();
    if (!(await checkPageAccess(req, res, db, id, 'viewer'))) return;
    res.json({ versions: await listPageVersions(db, id) });
  } catch (error: unknown) {
    if (badInput(error, res)) return;
    log.general.error({ err: error }, 'Failed to list page versions');
    res.status(500).json({ error: 'Failed to list page versions' });
  }
});

/** GET /pages/:id/versions/:versionId — the version's blocks, to look at. */
router.get(
  '/pages/:id/versions/:versionId',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { id, versionId } = z
        .object({ id: entityIdSchema, versionId: entityIdSchema })
        .parse(req.params);
      const db = getDb();
      if (!(await checkPageAccess(req, res, db, id, 'viewer'))) return;
      const version = await findPageVersion(db, id, versionId);
      if (!version) {
        res.status(404).json({ error: 'Version not found' });
        return;
      }
      res.json({
        version: { id: version.id, createdAt: version.createdAt, createdBy: version.createdBy },
        blocks: version.blocks,
      });
    } catch (error: unknown) {
      if (badInput(error, res)) return;
      log.general.error({ err: error }, 'Failed to read a page version');
      res.status(500).json({ error: 'Failed to read a page version' });
    }
  },
);

/** POST /pages/:id/versions/:versionId/restore — make the page's blocks the version's again. */
router.post(
  '/pages/:id/versions/:versionId/restore',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { id, versionId } = z
        .object({ id: entityIdSchema, versionId: entityIdSchema })
        .parse(req.params);
      const db = getDb();
      if (!(await checkPageAccess(req, res, db, id, 'editor'))) return;
      const version = await findPageVersion(db, id, versionId);
      if (!version) {
        res.status(404).json({ error: 'Version not found' });
        return;
      }
      const actorId = req.user?.id ?? '';
      // The operations are computed from the blocks as they are once the page
      // is locked, inside the transaction that applies them.
      let ops: ReturnType<typeof restoreOperations> = [];
      const result = await applyBlockTransaction(db, {
        pageId: id,
        ops: () => ops,
        actorId,
        beforeChange: async (tx, rows) => {
          await snapshotPage(tx, { pageId: id, rows, actorId, force: true });
          ops = restoreOperations(rows, version.blocks);
        },
      });
      res.json({ ok: true, version: result.version, ops: result.ops });
    } catch (error: unknown) {
      if (error instanceof TransactionRejected) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (badInput(error, res)) return;
      log.general.error({ err: error }, 'Failed to restore a page version');
      res.status(500).json({ error: 'Failed to restore a page version' });
    }
  },
);

export default router;
