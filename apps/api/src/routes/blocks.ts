import { Router } from 'express';
import type { Request, Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import type { BlockRow } from '../repositories/blocks.js';
import { listBlocksForPage } from '../repositories/blocks.js';
import { findAppliedTransactionKeys, findPageById } from '../repositories/pages.js';
import { snapshotPage } from '../repositories/pageVersions.js';
import { authenticateToken } from '../middleware/auth.js';
import { log } from '../lib/logger.js';
import { announceChange } from '../collab/live-rooms.js';
import { isSystemDatabase } from '../lib/databases/system.js';
import { sendNotification } from '../lib/notification-service.js';
import { recentlyNotified } from '../repositories/notifications.js';
import { listFollowers } from '../repositories/pageFollows.js';
import { checkPageAccess, resolvePageAccess } from '../lib/page-access.js';
import {
  applyBlockTransaction,
  blockTransactionSchema,
  type NewMention,
  TransactionRejected,
} from '../lib/block-transactions.js';

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
 * remove here. Every field already arrives from drizzle as the right type, so
 * the `String(...)` coercions that undid `ObjectId` are gone.
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
 * A page's blocks and the version they are at, read in one snapshot: a
 * transaction committing between two separate reads would hand out blocks one
 * version ahead of the version they are labelled with. With `keys`, also which
 * of those transaction keys the blocks already include.
 */
async function readBlocks(pageId: string, keys: readonly string[] = []) {
  return getDb().transaction(
    async (tx) => {
      const current = await findPageById(tx, pageId);
      return {
        blocks: (await listBlocksForPage(tx, pageId)).map((b) => serializeBlock(b)),
        version: current?.blocksVersion ?? 0,
        applied: await findAppliedTransactionKeys(tx, pageId, keys),
      };
    },
    { isolationLevel: 'repeatable read' },
  );
}

/**
 * GET /api/pages/:pageId/blocks
 * Returns a flat list of blocks for the page. Frontend nests by parentBlockId.
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

    const ok = await checkPageAccess(req, res, db, page.id, 'viewer');
    if (!ok) return;

    const { blocks, version } = await readBlocks(page.id);
    res.json({ blocks, version });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to list blocks');
    res.status(500).json({ error: 'Failed to list blocks' });
  }
});

/**
 * POST /api/pages/:pageId/blocks/resume { keys }
 *
 * Opening a page with changes that were never confirmed (a reload, or work
 * kept offline): the blocks, their version and which of the changes' keys the
 * blocks already include — applied by the server though the answer was lost —
 * so the editor drops those instead of applying them a second time. One
 * snapshot, so "applied" means exactly "in these blocks".
 */
router.post('/pages/:pageId/blocks/resume', async (req: Request, res: Response) => {
  try {
    const params = z.object({ pageId: entityIdSchema }).parse(req.params);
    const body = z.object({ keys: z.array(z.string().min(1).max(64)).max(2000) }).parse(req.body);

    const db = getDb();
    const page = await findPageById(db, params.pageId);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    const ok = await checkPageAccess(req, res, db, page.id, 'editor');
    if (!ok) return;

    res.json(await readBlocks(page.id, body.keys));
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to resume blocks');
    res.status(500).json({ error: 'Failed to resume blocks' });
  }
});

/**
 * Tell the people newly mentioned in a page's text, as Notion does — those
 * who can open the page, never the writer. Best effort: the edit is saved.
 */
async function notifyMentioned(
  mentioned: readonly NewMention[],
  page: { id: string; title: string },
  authorId: string,
): Promise<void> {
  for (const { userId, blockId, text } of mentioned) {
    if (userId === authorId) continue;
    try {
      if (!(await resolvePageAccess(getDb(), userId, page.id))) continue;
      await sendNotification({
        userId,
        type: 'mention',
        title: `You were mentioned in ${page.title || 'Untitled'}`,
        body: text.slice(0, 280),
        priority: 'normal',
        data: { pageId: page.id, blockId, authorId },
      });
    } catch (err: unknown) {
      log.general.warn({ err, userId, pageId: page.id }, 'Failed to send mention notification');
    }
  }
}

/** How often one process looks at a page's followers while it is being edited. */
const EDIT_CHECK_MS = 60_000;
/** One unread "edited" notification per follower and page in this window. */
const EDIT_NOTICE_WINDOW = '1 hour';
const lastEditCheck = new Map<string, number>();

/**
 * Tell the people following a page that someone edited it, as Notion's
 * updates do — never the editor, only those who can still open it, in the app
 * only, and grouped: nothing more while an earlier one is unread and recent.
 * The editor saves as you type, so a page is looked at once a minute at most.
 */
async function notifyFollowersOfEdit(page: { id: string; title: string }, authorId: string) {
  const now = Date.now();
  if (now - (lastEditCheck.get(page.id) ?? 0) < EDIT_CHECK_MS) return;
  lastEditCheck.set(page.id, now);
  if (lastEditCheck.size > 10_000) lastEditCheck.clear();
  try {
    const db = getDb();
    const followers = (await listFollowers(db, page.id)).filter((id) => id !== authorId);
    if (followers.length === 0) return;
    const told = new Set(
      await recentlyNotified(db, {
        type: 'page_edited',
        pageId: page.id,
        userIds: followers,
        within: EDIT_NOTICE_WINDOW,
      }),
    );
    for (const userId of followers) {
      if (told.has(userId) || !(await resolvePageAccess(db, userId, page.id))) continue;
      await sendNotification({
        userId,
        type: 'page_edited',
        title: `${page.title || 'Untitled'} was edited`,
        body: '',
        priority: 'low',
        channels: ['in_app'],
        data: { pageId: page.id, authorId },
      });
    }
  } catch (err: unknown) {
    log.general.warn({ err, pageId: page.id }, 'Failed to tell followers of an edit');
  }
}

/**
 * POST /pages/:pageId/blocks/transactions
 *
 * Applies one editor transaction — an ordered list of insert / update / move
 * / remove operations — atomically: every operation is validated against the
 * page's blocks as the earlier operations left them, and any failure rolls
 * the whole list back. This is how the editor saves: one request per user
 * action, in order, with the ids it minted.
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
    const ok = await checkPageAccess(req, res, db, page.id, 'editor');
    if (!ok) return;

    const result = await applyBlockTransaction(db, {
      pageId: page.id,
      ops: body.ops,
      key: body.key,
      actorId: req.user?.id ?? '',
      socketId: body.socketId,
      // Page history: the state before the first change after a quiet spell.
      beforeChange: async (tx, rows) => {
        await snapshotPage(tx, { pageId: page.id, rows, actorId: req.user?.id ?? '' });
      },
    });
    // The sender gets the operations as applied too: the orders the server chose.
    res.json({ ok: true, version: result.version, ops: result.ops });
    // An app syncing a system database (Noted's notes) hears a body edit as a
    // row change. After the answer, so a failure here cannot answer twice.
    if (!result.replayed && page.databaseId) {
      void isSystemDatabase(db, page.databaseId)
        .then((system) => {
          if (system)
            announceChange({ workspaceId: page.workspaceId, databaseId: page.databaseId });
        })
        .catch((err: unknown) => log.general.warn({ err }, 'Failed to announce a row edit'));
    }
    void notifyMentioned(result.mentioned, { id: page.id, title: page.title }, req.user?.id ?? '');
    if (!result.replayed)
      void notifyFollowersOfEdit({ id: page.id, title: page.title }, req.user?.id ?? '');
  } catch (error: unknown) {
    if (error instanceof TransactionRejected) {
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
