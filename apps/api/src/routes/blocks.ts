import { Router } from 'express';
import type { Request, Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import type { BlockRow } from '../repositories/blocks.js';
import { listBlocksForPage } from '../repositories/blocks.js';
import { findPageById } from '../repositories/pages.js';
import { authenticateToken } from '../middleware/auth.js';
import { log } from '../lib/logger.js';
import { checkPageAccess } from '../lib/page-access.js';
import {
  applyBlockTransaction,
  blockTransactionSchema,
  TransactionRejected,
} from '../lib/block-transactions.js';
import { loadPageState, PageDocRejected } from '../lib/page-docs.js';
import * as Y from 'yjs';

const router = Router();

// All block routes require an authenticated Oxy user.
router.use(authenticateToken);

/**
 * An id this schema could have stored — uuid v7, or a 24-char ObjectId hex for
 * a row a backfill copied over. See the identical helper in `routes/pages.ts`
 * for why a 24-hex-only regex is not it, and why this is a 400 guard rather
 * than a precondition on a lookup.
 */
const entityIdSchema = z.string().refine(isLiveEntityId, 'Invalid id');

// Block content schemas and normalizeContent live in @oxy.so/nilo-contracts.

function handleZodError(err: unknown, res: Response): boolean {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.errors });
    return true;
  }
  return false;
}

/**
 * The wire shape of a block. Unchanged by the port: this serializer has always
 * emitted `id` and never `_id`, so unlike `serializePage` there is nothing to
 * remove here.
 */
function serializeBlock(block: BlockRow) {
  return {
    id: block.id,
    pageId: block.pageId,
    parentBlockId: block.parentBlockId,
    type: block.type,
    content: block.content,
    order: block.order,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
  };
}

/**
 * GET /api/pages/:pageId/blocks
 *
 * A page's blocks as rows, flat (nest them by `parentBlockId`), read from its
 * document (`lib/page-projection.ts`): a second or so behind the latest edit
 * while someone types. The editor reads the document itself.
 */
router.get('/pages/:pageId/blocks', async (req: Request, res: Response) => {
  try {
    const params = z.object({ pageId: entityIdSchema }).parse(req.params);
    const db = getDb();
    const page = await findPageById(db, params.pageId);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    if (!(await checkPageAccess(req, res, db, page.id, 'viewer'))) return;
    const blocks = await listBlocksForPage(db, page.id);
    res.json({ blocks: blocks.map(serializeBlock) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to list blocks');
    res.status(500).json({ error: 'Failed to list blocks' });
  }
});

/**
 * POST /pages/:pageId/doc { stateVector? } → { update, stateVector }
 *
 * The page's document over HTTP, for a device bringing a page it keeps up to
 * date without opening it (the room's `doc:sync` does the same live): what
 * the server has beyond `stateVector`, and the server's own state vector, all
 * base64.
 */
router.post('/pages/:pageId/doc', async (req: Request, res: Response) => {
  try {
    const params = z.object({ pageId: entityIdSchema }).parse(req.params);
    const body = z
      .object({ stateVector: z.string().max(100_000).optional() })
      .parse(req.body ?? {});
    const db = getDb();
    const page = await findPageById(db, params.pageId);
    // A page in the trash can still be read.
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    if (!(await checkPageAccess(req, res, db, page.id, 'viewer'))) return;
    const { state } = await loadPageState(db, page.id);
    const vector = body.stateVector ? Buffer.from(body.stateVector, 'base64') : null;
    const update = vector ? Y.diffUpdate(state, vector) : state;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      update: Buffer.from(update).toString('base64'),
      stateVector: Buffer.from(Y.encodeStateVectorFromUpdate(state)).toString('base64'),
    });
  } catch (error: unknown) {
    if (error instanceof PageDocRejected) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to read a page document');
    res.status(500).json({ error: 'Failed to read the page' });
  }
});

/**
 * POST /pages/:pageId/blocks/transactions { ops }
 *
 * Change a page's blocks without an editor (integrations, scripts): an
 * ordered list of insert / update / move / remove operations, validated one
 * after another, all or none, written into the page's document as one change
 * (`lib/block-transactions.ts`). Anyone with the page open sees it at once,
 * and the rows are up to date when this answers.
 */
router.post('/pages/:pageId/blocks/transactions', async (req: Request, res: Response) => {
  try {
    const params = z.object({ pageId: entityIdSchema }).parse(req.params);
    const body = blockTransactionSchema.parse(req.body);
    const db = getDb();
    const page = await findPageById(db, params.pageId);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    if (!(await checkPageAccess(req, res, db, page.id, 'editor'))) return;
    if (page.archived) {
      res.status(409).json({ error: 'The page is in the trash', code: 'PAGE_ARCHIVED' });
      return;
    }
    await applyBlockTransaction(db, {
      pageId: page.id,
      ops: body.ops,
      actorId: req.user?.id ?? '',
    });
    res.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof TransactionRejected || error instanceof PageDocRejected) {
      res
        .status(error.status)
        .json({ error: error.message, ...(error.code && { code: error.code }) });
      return;
    }
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to apply block transaction');
    res.status(500).json({ error: 'Failed to apply block transaction' });
  }
});

export default router;
