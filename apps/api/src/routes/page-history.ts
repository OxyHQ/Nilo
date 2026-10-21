/**
 * Page history: the versions kept of a page's blocks, one version's blocks,
 * and restoring a version. Restoring is one change to the page's document
 * (`lib/page-docs.ts`), so open editors receive it live, and it keeps the
 * state it replaces as a version first.
 */
import { Router, type Request, type Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { log } from '../lib/logger.js';
import { checkPageAccess } from '../lib/page-access.js';
import { replacePageBlocks, TransactionRejected } from '../lib/block-transactions.js';
import { PageDocRejected } from '../lib/page-docs.js';
import { projectNow } from '../lib/page-projection.js';
import { authenticateToken } from '../middleware/auth.js';
import { listBlocksForPage } from '../repositories/blocks.js';
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

/** GET /pages/:id/versions — editors only, newest first. */
router.get('/pages/:id/versions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: entityIdSchema }).parse(req.params);
    const db = getDb();
    if (!(await checkPageAccess(req, res, db, id, 'editor'))) return;
    res.json({ versions: await listPageVersions(db, id) });
  } catch (error: unknown) {
    if (badInput(error, res)) return;
    log.general.error({ err: error }, 'Failed to list page versions');
    res.status(500).json({ error: 'Failed to list page versions' });
  }
});

/** GET /pages/:id/versions/:versionId — editors only, the version's blocks. */
router.get(
  '/pages/:id/versions/:versionId',
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
      // The page as it is now, kept as a version, so the restore can be undone.
      await projectNow(id);
      await snapshotPage(db, {
        pageId: id,
        rows: await listBlocksForPage(db, id),
        actorId,
        force: true,
      });
      // One change from the document as it is to the version: blocks both have
      // keep their ids (comments anchored to them stay anchored).
      await replacePageBlocks(db, { pageId: id, target: version.blocks, actorId });
      res.json({ ok: true });
    } catch (error: unknown) {
      if (error instanceof PageDocRejected || error instanceof TransactionRejected) {
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
