/**
 * Applying a block transaction: the one way blocks are written.
 *
 * The editor's saves (`POST /pages/:pageId/blocks/transactions`) and every
 * server-side change to a page's blocks (restoring a version) go through
 * `applyBlockTransaction`, so they are serialized per page, versioned and
 * told to the page's room the same way.
 */
import {
  type BlockContent,
  type BlockType,
  blockTypeSchema,
  normalizeContent,
  placeAfter,
  type segmentSchema,
} from '@nilo/contracts';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import { broadcastPageTransaction } from '../collab/page-rooms.js';
import type { PgHandle } from '../db/client.js';
import {
  type BlockRow,
  createBlock,
  deleteBlockTree,
  findBlockById,
  listBlocksForPage,
  updateBlock,
} from '../repositories/blocks.js';
import {
  bumpBlocksVersion,
  findPageTransaction,
  lockPage,
  recordPageTransaction,
} from '../repositories/pages.js';
import { follow } from '../repositories/pageFollows.js';
import { getIO } from '../socket.js';

const entityIdSchema = z.string().refine(isLiveEntityId, 'Invalid id');

/** Whether `id` is `ancestor` or sits under it, following `parentOf`. */
export function isDescendantOrSelf(
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
export const blockOperationSchema = z.discriminatedUnion('kind', [
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
    /**
     * The page version of the content this change was made on. When the
     * block's content was written later (someone else's edit the editor has
     * not received), the transaction is refused as `STALE_BLOCK`.
     */
    baseVersion: z.number().int().min(0).optional(),
  }),
  z.object({
    kind: z.literal('move'),
    id: entityIdSchema,
    parentBlockId: entityIdSchema.nullable(),
    afterId: entityIdSchema.nullable(),
  }),
  z.object({ kind: z.literal('remove'), id: entityIdSchema }),
]);

export const blockTransactionSchema = z.object({
  ops: z.array(blockOperationSchema).min(1).max(500),
  /** The sender's socket, which is left out of the broadcast (it has the change). */
  socketId: z.string().max(64).optional(),
  /**
   * The editor's key for this transaction, the same on every retry of it. A
   * transaction already applied under this key is answered from the record
   * instead of being applied again.
   */
  key: z.string().min(1).max(64).optional(),
});

export class TransactionRejected extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** For the client to act on: `STALE_BLOCK` — rebase and send again. */
    readonly code?: string,
  ) {
    super(message);
  }
}

export type BlockOperation = z.infer<typeof blockOperationSchema>;

export interface ApplyBlockTransactionInput {
  pageId: string;
  /**
   * The operations, or a function giving them once `beforeChange` has run
   * (for changes computed from the locked page's blocks, like a restore).
   */
  ops: readonly BlockOperation[] | (() => readonly BlockOperation[]);
  /** The editor's key, stable across retries; see `blockTransactionSchema`. */
  key?: string;
  /** Who made the change, for the room's broadcast. */
  actorId: string;
  /** A socket to leave out of the broadcast (the sender, which has the change). */
  socketId?: string;
  /** Runs inside the transaction, once the page is locked, on the blocks before the change. */
  beforeChange?: (tx: PgHandle, rows: BlockRow[]) => Promise<void>;
}

/** Someone mentioned in a page's text who was not mentioned anywhere in it before. */
export interface NewMention {
  userId: string;
  blockId: string;
  /** The block's text, for the notification. */
  text: string;
}

export interface AppliedTransaction {
  version: number;
  /** The operations as applied: content normalized, every order the server wrote. */
  ops: unknown[];
  /**
   * People the page's text mentions now and did not before (a block split or
   * moved keeps its mentions: compared over the whole page). Empty for a replay.
   */
  mentioned: NewMention[];
  /** Answered from the record of an earlier attempt under the same key. */
  replayed: boolean;
}

/**
 * Apply `ops` to a page atomically: every operation is validated against the
 * page's blocks as the earlier ones left them, and any failure
 * (`TransactionRejected`) rolls the whole list back. On success the page's
 * room hears the applied operations.
 */
export async function applyBlockTransaction(
  db: PgHandle,
  input: ApplyBlockTransactionInput,
): Promise<AppliedTransaction> {
  // The operations as applied, content normalized, for collaborators.
  let applied: unknown[] = [];
  let mentioned: NewMention[] = [];
  const { version, replayed } = await db.transaction(async (tx) => {
    // First, before anything is read: lock the page row, so transactions on
    // one page run one after another and each validates against the blocks
    // the previous one committed. Reading first let two concurrent
    // transactions both validate against the same old state (a renumbering
    // applied to a block another member had just moved away). A rejected
    // transaction rolls everything back, the version bump included.
    const locked = await lockPage(tx, input.pageId);
    if (locked?.locked) {
      throw new TransactionRejected(423, 'The page is locked', 'PAGE_LOCKED');
    }
    if (input.key) {
      const done = await findPageTransaction(tx, input.pageId, input.key);
      if (done) {
        applied = done.ops;
        return { version: done.version, replayed: true };
      }
    }
    const version = await bumpBlocksVersion(tx, input.pageId, input.actorId || undefined);
    // Whoever edits a page follows it (a no-op when they already do).
    if (input.actorId) await follow(tx, input.pageId, input.actorId);
    const rows = await listBlocksForPage(tx, input.pageId);
    await input.beforeChange?.(tx, rows);
    const types = new Map<string, BlockType>(rows.map((b) => [b.id, b.type]));
    const contents = new Map<string, BlockContent>(rows.map((b) => [b.id, b.content]));
    const parentOf = new Map<string, string | null>(rows.map((b) => [b.id, b.parentBlockId]));
    const orderOf = new Map<string, number>(rows.map((b) => [b.id, b.order]));
    const contentVersionOf = new Map<string, number>(rows.map((b) => [b.id, b.contentVersion]));

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

    const ops = typeof input.ops === 'function' ? input.ops() : input.ops;
    for (const op of ops) {
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
            pageId: input.pageId,
            parentBlockId: op.parentBlockId,
            type: op.type,
            content,
            order,
            contentVersion: version,
          });
          contentVersionOf.set(op.id, version);
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
          if (op.baseVersion !== undefined && (contentVersionOf.get(op.id) ?? 0) > op.baseVersion) {
            throw new TransactionRejected(
              409,
              `Block ${op.id} changed since version ${op.baseVersion}`,
              'STALE_BLOCK',
            );
          }
          const type = op.type ?? (types.get(op.id) as BlockType);
          const content = normalizeContent(type, op.content ?? contents.get(op.id));
          await updateBlock(tx, op.id, { type: op.type, content, contentVersion: version });
          contentVersionOf.set(op.id, version);
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
    const before = peopleMentioned(rows.map((b) => [b.id, b.content]));
    mentioned = [...peopleMentioned(contents)]
      .filter(([userId]) => !before.has(userId))
      .map(([userId, at]) => ({ userId, ...at }));
    if (input.key)
      await recordPageTransaction(tx, {
        pageId: input.pageId,
        key: input.key,
        version,
        ops: applied,
      });
    return { version, replayed: false };
  });

  // A replay was broadcast when it was first applied.
  if (!replayed) {
    broadcastPageTransaction(
      getIO(),
      { pageId: input.pageId, version, actorId: input.actorId, ops: applied },
      input.socketId,
    );
  }
  return { version, ops: applied, replayed, mentioned };
}

/** The people a page's blocks mention (`mention.attributes.kind === 'user'`), each with a block. */
function peopleMentioned(
  contents: Iterable<readonly [string, BlockContent]>,
): Map<string, { blockId: string; text: string }> {
  const people = new Map<string, { blockId: string; text: string }>();
  for (const [blockId, content] of contents) {
    // Stored content is normalized: `segments`, when present, are valid segments.
    const segments = (content.segments ?? []) as z.infer<typeof segmentSchema>[];
    for (const segment of segments) {
      const attributes = segment.mention?.attributes;
      if (attributes?.kind !== 'user' || !attributes.id || people.has(attributes.id)) continue;
      people.set(attributes.id, {
        blockId,
        text: typeof content.text === 'string' ? content.text : '',
      });
    }
  }
  return people;
}
