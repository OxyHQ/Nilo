import { Router } from 'express';
import type { Request, Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import {
  type BlockContent,
  type BlockType,
  blockTypeSchema,
  normalizeContent,
  placeAfter,
} from '@nilo/contracts';
import type { BlockRow } from '../repositories/blocks.js';
import {
  createBlock,
  deleteBlockTree,
  findBlockById,
  findBlocksByIds,
  listBlocksForPage,
  nextBlockOrder,
  reorderBlocks,
  updateBlock,
} from '../repositories/blocks.js';
import { bumpBlocksVersion, findPageById } from '../repositories/pages.js';
import { broadcastPageTransaction } from '../collab/page-rooms.js';
import { getIO } from '../socket.js';
import { authenticateToken } from '../middleware/auth.js';
import { log } from '../lib/logger.js';
import { checkWorkspaceAccess } from '../lib/workspace-access.js';

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

// Block content schemas and normalizeContent live in @nilo/contracts.

const createBlockSchema = z.object({
  type: blockTypeSchema,
  content: z.unknown().optional(),
  order: z.number().finite().optional(),
  parentBlockId: entityIdSchema.nullable().optional(),
});

const updateBlockSchema = z
  .object({
    type: blockTypeSchema.optional(),
    content: z.unknown().optional(),
    order: z.number().finite().optional(),
    parentBlockId: entityIdSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });

const reorderSchema = z.object({
  /**
   * The page's new block sequence; each block takes its index as its `order`.
   *
   * Distinctness is enforced rather than left unspecified. The payload means
   * "this is the sequence", and a sequence cannot hold the same block twice —
   * but both storage engines answered a duplicate ARBITRARILY, so neither
   * behaviour is one to port. Mongo issued two `updateOne`s under
   * `ordered: false`; Postgres joins against `(values ...)` and, where two rows
   * match one block, applies an unspecified one of them. A 400 replaces an
   * unspecified outcome with a stated one, and rejects nothing the editor
   * sends — a repeated id there would mean an already-corrupted block list.
   */
  blockIds: z
    .array(entityIdSchema)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'blockIds must not contain duplicates',
    }),
});

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

    const ok = await checkWorkspaceAccess(req, res, page.workspaceId, 'viewer');
    if (!ok) return;

    const blocks = await listBlocksForPage(db, page.id);

    res.json({ blocks: blocks.map((b) => serializeBlock(b)), version: page.blocksVersion });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to list blocks');
    res.status(500).json({ error: 'Failed to list blocks' });
  }
});

/**
 * POST /api/pages/:pageId/blocks
 */
router.post('/pages/:pageId/blocks', async (req: Request, res: Response) => {
  try {
    const params = z.object({ pageId: entityIdSchema }).parse(req.params);
    const body = createBlockSchema.parse(req.body);

    const db = getDb();
    const page = await findPageById(db, params.pageId);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const ok = await checkWorkspaceAccess(req, res, page.workspaceId, 'editor');
    if (!ok) return;

    if (body.parentBlockId) {
      const parent = await findBlockById(db, body.parentBlockId);
      if (!parent) {
        res.status(404).json({ error: 'Parent block not found' });
        return;
      }
      if (parent.pageId !== page.id) {
        res.status(400).json({ error: 'Parent block belongs to a different page' });
        return;
      }
    }

    const content = normalizeContent(body.type, body.content);

    // Default order = max(order) + 1 among siblings if not provided. Same race
    // as `POST /api/pages` and the same reasoning: a transaction would take no
    // lock here, so it would not close it.
    const order =
      body.order ??
      (await nextBlockOrder(db, {
        pageId: page.id,
        parentBlockId: body.parentBlockId ?? null,
      }));

    const block = await createBlock(db, {
      pageId: page.id,
      parentBlockId: body.parentBlockId ?? null,
      type: body.type,
      content,
      order,
    });

    res.status(201).json({ block: serializeBlock(block) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to create block');
    res.status(500).json({ error: 'Failed to create block' });
  }
});

/**
 * PATCH /api/blocks/:id
 */
router.patch('/blocks/:id', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const body = updateBlockSchema.parse(req.body);

    const db = getDb();
    const block = await findBlockById(db, params.id);
    if (!block) {
      res.status(404).json({ error: 'Block not found' });
      return;
    }

    const page = await findPageById(db, block.pageId);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const ok = await checkWorkspaceAccess(req, res, page.workspaceId, 'editor');
    if (!ok) return;

    if (body.parentBlockId !== undefined && body.parentBlockId !== null) {
      if (body.parentBlockId === block.id) {
        res.status(400).json({ error: 'A block cannot be its own parent' });
        return;
      }
      const parent = await findBlockById(db, body.parentBlockId);
      if (!parent) {
        res.status(404).json({ error: 'Parent block not found' });
        return;
      }
      if (parent.pageId !== block.pageId) {
        res.status(400).json({ error: 'Parent block belongs to a different page' });
        return;
      }
      const pageBlocks = await listBlocksForPage(db, block.pageId);
      const parentOf = new Map(pageBlocks.map((b) => [b.id, b.parentBlockId]));
      if (isDescendantOrSelf(parentOf, body.parentBlockId, block.id)) {
        res.status(400).json({ error: 'A block cannot be nested inside itself' });
        return;
      }
    }

    let content: BlockContent | undefined;
    if (body.content !== undefined || body.type !== undefined) {
      // Re-normalize content against the (possibly new) type. If only the
      // type changed, fall back to defaults so we never persist mismatched shapes.
      // `block.type` is a `BlockType` rather than a bare `string` because the
      // column carries `$type<BlockType>()`, matching its CHECK.
      const effectiveType = body.type ?? block.type;
      const incoming = body.content !== undefined ? body.content : block.content;
      content = normalizeContent(effectiveType, incoming);
    }

    const updated = await updateBlock(db, block.id, {
      parentBlockId: body.parentBlockId,
      type: body.type,
      content,
      order: body.order,
    });
    if (!updated) {
      res.status(404).json({ error: 'Block not found' });
      return;
    }

    res.json({ block: serializeBlock(updated) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to update block');
    res.status(500).json({ error: 'Failed to update block' });
  }
});

/**
 * DELETE /api/blocks/:id
 * Hard-delete. Cascades to child blocks (parentBlockId chain).
 */
router.delete('/blocks/:id', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);

    const db = getDb();
    const block = await findBlockById(db, params.id);
    if (!block) {
      res.status(404).json({ error: 'Block not found' });
      return;
    }

    const page = await findPageById(db, block.pageId);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const ok = await checkWorkspaceAccess(req, res, page.workspaceId, 'editor');
    if (!ok) return;

    // One recursive statement in place of the BFS. The descendants are named
    // explicitly rather than left to `blocks.parentBlockId`'s CASCADE because
    // this route answers with the COUNT and a cascade reports none.
    const deleted = await deleteBlockTree(db, block.id);

    res.json({ success: true, deleted });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to delete block');
    res.status(500).json({ error: 'Failed to delete block' });
  }
});

/**
 * POST /api/pages/:pageId/blocks/reorder
 * Bulk reorder. All items must already belong to `pageId` — we verify
 * before issuing writes.
 *
 * The up-front validation used to carry a second job: "without MongoDB
 * transactions (which require a replica set and aren't assumed available), the
 * inputs are fully validated up-front to minimize the chance of a partial-write
 * outcome". That is no longer why it is here. `blocksRepository.reorderBlocks`
 * counts and writes inside one transaction, so the partial write this could
 * only make unlikely is now impossible; the validation survives to produce the
 * 404 and 400, not to narrow a window.
 */
router.post('/pages/:pageId/blocks/reorder', async (req: Request, res: Response) => {
  try {
    const params = z.object({ pageId: entityIdSchema }).parse(req.params);
    const body = reorderSchema.parse(req.body);

    const db = getDb();
    const page = await findPageById(db, params.pageId);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const ok = await checkWorkspaceAccess(req, res, page.workspaceId, 'editor');
    if (!ok) return;

    const existing = await findBlocksByIds(db, body.blockIds);
    if (existing.length !== body.blockIds.length) {
      res.status(404).json({ error: 'One or more blocks not found' });
      return;
    }
    for (const b of existing) {
      if (b.pageId !== page.id) {
        res.status(400).json({ error: 'All blocks must belong to the same page' });
        return;
      }
    }

    // Order from frontend = index in blockIds array.
    //
    // `modified` is NARROWER than the number the Mongo route reported, and the
    // difference is deliberate — Mongoose stamped `updatedAt` onto every
    // operation of the `bulkWrite`, so its `modifiedCount` equalled
    // `matchedCount` whether or not a block had actually moved. `matched` keeps
    // Mongo's `matchedCount` meaning, which is what Postgres's row count is.
    // Neither field is read: the only caller discards the response body.
    const result = await reorderBlocks(db, page.id, body.blockIds);

    res.json({
      success: true,
      matched: result.matched,
      modified: result.modified,
    });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to reorder blocks');
    res.status(500).json({ error: 'Failed to reorder blocks' });
  }
});

/** Whether `id` is `ancestor` or sits under it, following `parentOf`. */
function isDescendantOrSelf(
  parentOf: ReadonlyMap<string, string | null>,
  id: string | null,
  ancestor: string,
): boolean {
  const seen = new Set<string>();
  let current = id;
  while (current !== null && !seen.has(current)) {
    if (current === ancestor) return true;
    seen.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Positions are anchors, not numbers: a block goes right after `afterId`
 * among `parentBlockId`'s children (first when null). The server turns an
 * anchor into an `order` against the blocks as they are when the operation
 * runs, renumbering siblings when two orders leave no room between them, and
 * reports every order it wrote. Clients never invent orders, so every client
 * and the database agree on sibling order however edits interleave.
 */
const blockOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('insert'),
    /** Client-minted, so an operation can name a block created earlier in the batch. */
    id: z.string().regex(UUID_V7, 'New block ids must be UUIDv7'),
    parentBlockId: entityIdSchema.nullable(),
    afterId: entityIdSchema.nullable(),
    type: blockTypeSchema,
    content: z.unknown().optional(),
  }),
  z.object({
    kind: z.literal('update'),
    id: entityIdSchema,
    type: blockTypeSchema.optional(),
    content: z.unknown().optional(),
  }),
  z.object({
    kind: z.literal('move'),
    id: entityIdSchema,
    parentBlockId: entityIdSchema.nullable(),
    afterId: entityIdSchema.nullable(),
  }),
  z.object({ kind: z.literal('remove'), id: entityIdSchema }),
]);

const blockTransactionSchema = z.object({
  ops: z.array(blockOperationSchema).min(1).max(500),
  /** The sender's socket, which is left out of the broadcast (it has the change). */
  socketId: z.string().max(64).optional(),
});

class TransactionRejected extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
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
    const ok = await checkWorkspaceAccess(req, res, page.workspaceId, 'editor');
    if (!ok) return;

    // The operations as applied, content normalized, for collaborators.
    const applied: unknown[] = [];
    const version = await db.transaction(async (tx) => {
      // First, before anything is read: the version bump locks the page row,
      // so transactions on one page run one after another and each validates
      // against the blocks the previous one committed. Reading first let two
      // concurrent transactions both validate against the same old state (a
      // renumbering applied to a block another member had just moved away).
      // A rejected transaction rolls the bump back with everything else.
      const version = await bumpBlocksVersion(tx, page.id);
      const rows = await listBlocksForPage(tx, page.id);
      const types = new Map<string, BlockType>(rows.map((b) => [b.id, b.type]));
      const contents = new Map<string, BlockContent>(rows.map((b) => [b.id, b.content]));
      const parentOf = new Map<string, string | null>(rows.map((b) => [b.id, b.parentBlockId]));
      const orderOf = new Map<string, number>(rows.map((b) => [b.id, b.order]));

      /** The order for a block going after `afterId` under `parent`; renumbers when there is no room. */
      const orderAfter = async (
        parent: string | null,
        afterId: string | null,
        self: string,
      ): Promise<number> => {
        const siblings = [...parentOf]
          .filter(([id, p]) => p === parent && id !== self)
          .map(([id]) => ({ id, order: orderOf.get(id) as number }));
        const { order, renumbered } = placeAfter(siblings, afterId);
        for (const sibling of renumbered) {
          await updateBlock(tx, sibling.id, { order: sibling.order });
          orderOf.set(sibling.id, sibling.order);
          applied.push({
            kind: 'reorder',
            id: sibling.id,
            parentBlockId: parent,
            order: sibling.order,
          });
        }
        return order;
      };

      const requireBlock = (id: string) => {
        if (!types.has(id)) throw new TransactionRejected(404, `Block ${id} is not on this page`);
      };
      const requireParent = (id: string | null) => {
        if (id !== null && !types.has(id)) {
          throw new TransactionRejected(400, `Parent block ${id} is not on this page`);
        }
      };

      for (const op of body.ops) {
        switch (op.kind) {
          case 'insert': {
            if (types.has(op.id) || (await findBlockById(tx, op.id))) {
              throw new TransactionRejected(409, `Block ${op.id} already exists`);
            }
            requireParent(op.parentBlockId);
            const content = normalizeContent(op.type, op.content);
            const order = await orderAfter(op.parentBlockId, op.afterId, op.id);
            await createBlock(tx, {
              id: op.id,
              pageId: page.id,
              parentBlockId: op.parentBlockId,
              type: op.type,
              content,
              order,
            });
            types.set(op.id, op.type);
            contents.set(op.id, content);
            parentOf.set(op.id, op.parentBlockId);
            orderOf.set(op.id, order);
            applied.push({
              kind: 'insert',
              id: op.id,
              parentBlockId: op.parentBlockId,
              type: op.type,
              content,
              order,
            });
            break;
          }
          case 'update': {
            requireBlock(op.id);
            if (op.type === undefined && op.content === undefined) break;
            const type = op.type ?? (types.get(op.id) as BlockType);
            const content = normalizeContent(type, op.content ?? contents.get(op.id));
            await updateBlock(tx, op.id, { type: op.type, content });
            types.set(op.id, type);
            contents.set(op.id, content);
            applied.push({ kind: 'update', id: op.id, type, content });
            break;
          }
          case 'move': {
            requireBlock(op.id);
            requireParent(op.parentBlockId);
            if (isDescendantOrSelf(parentOf, op.parentBlockId, op.id)) {
              throw new TransactionRejected(400, 'A block cannot be nested inside itself');
            }
            const order = await orderAfter(op.parentBlockId, op.afterId, op.id);
            await updateBlock(tx, op.id, { parentBlockId: op.parentBlockId, order });
            parentOf.set(op.id, op.parentBlockId);
            orderOf.set(op.id, order);
            applied.push({ kind: 'move', id: op.id, parentBlockId: op.parentBlockId, order });
            break;
          }
          case 'remove': {
            requireBlock(op.id);
            await deleteBlockTree(tx, op.id);
            for (const [id] of parentOf) {
              if (isDescendantOrSelf(parentOf, id, op.id)) {
                types.delete(id);
                contents.delete(id);
              }
            }
            for (const id of [...parentOf.keys()]) {
              if (!types.has(id)) {
                parentOf.delete(id);
                orderOf.delete(id);
              }
            }
            applied.push(op);
            break;
          }
        }
      }
      return version;
    });

    broadcastPageTransaction(
      getIO(),
      { pageId: page.id, version, actorId: req.user?.id ?? '', ops: applied },
      body.socketId,
    );
    // The sender gets the operations as applied too: the orders the server chose.
    res.json({ ok: true, version, ops: applied });
  } catch (error: unknown) {
    if (error instanceof TransactionRejected) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to apply block transaction');
    res.status(500).json({ error: 'Failed to apply block transaction' });
  }
});

export default router;
