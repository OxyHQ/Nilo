/**
 * Block transactions: how anything but a live editor writes a page's blocks
 * (`POST /pages/:pageId/blocks/transactions`, imports, restores).
 *
 * A transaction is a list of operations — insert, update, move, remove —
 * validated one after another against the page as the earlier ones left it,
 * all or none. It is translated into the editor's operations and written into
 * the page's document (`page-docs.ts`) as one update, like an editor's own
 * change: the page's room hears it, and the rows are projected at once.
 */
import {
  anchorOf,
  applyOperation,
  canHold,
  type EditorDocument,
  isWithin,
  type Operation,
  subtreeIds,
  type Transaction,
} from '@oxy.so/bloom-editor/model';
import { blockTypeSchema, normalizeContent } from '@oxy.so/nilo-contracts';
import {
  type BlockRow,
  contentOf,
  fieldsFromContent,
  NILO_SCHEMA,
  rowsToDocument,
} from '@oxy.so/nilo-contracts/editor';
import { diffDocuments } from '@oxy.so/bloom-editor/yjs';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import { broadcastDocUpdate } from '../collab/page-docs.js';
import type { PgHandle } from '../db/client.js';
import { findBlocksByIds } from '../repositories/blocks.js';
import { getIO } from '../socket.js';
import { writeServerChange } from './page-docs.js';
import { projectPage } from './page-projection.js';

const entityIdSchema = z.string().refine(isLiveEntityId, 'Invalid id');

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Positions are anchors: a block goes right after `afterId` among
 * `parentBlockId`'s children (first when null; last when `afterId` is no
 * longer there).
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
});

export type BlockOperation = z.infer<typeof blockOperationSchema>;

export class TransactionRejected extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** The editor's transaction for `ops`, each validated against the page as the earlier ones left it. */
export function toEditorTransaction(
  before: EditorDocument,
  ops: readonly BlockOperation[],
): Transaction {
  let doc = before;
  const out: Operation[] = [];
  const requireBlock = (id: string) => {
    if (!doc.blocks[id]) throw new TransactionRejected(404, `Block ${id} is not on this page`);
  };
  const requireParent = (id: string | null) => {
    if (id !== null && !doc.blocks[id]) {
      throw new TransactionRejected(400, `Parent block ${id} is not on this page`);
    }
  };
  // A table holds rows, a row cells, a columns block columns — and those live
  // nowhere else: the same rule the editor keeps (`canHold`).
  const requireFits = (parentId: string | null, type: string) => {
    const parent = parentId === null ? null : (doc.blocks[parentId] ?? null);
    if (!canHold(NILO_SCHEMA, parent, type)) {
      throw new TransactionRejected(
        400,
        parent
          ? `A ${type} block cannot go in a ${parent.type} block`
          : `A ${type} block cannot go at the top of a page`,
      );
    }
  };
  for (const op of ops) {
    let next: Operation;
    switch (op.kind) {
      case 'insert': {
        if (doc.blocks[op.id]) throw new TransactionRejected(409, `Block ${op.id} already exists`);
        requireParent(op.parentBlockId);
        requireFits(op.parentBlockId, op.type);
        const { text, props } = fieldsFromContent(op.type, normalizeContent(op.type, op.content));
        next = {
          kind: 'insert',
          blocks: [
            {
              id: op.id,
              type: op.type,
              parent: op.parentBlockId,
              ...(text !== undefined && { text }),
              props,
              children: [],
            },
          ],
          parent: op.parentBlockId,
          after: op.afterId,
        };
        break;
      }
      case 'update': {
        requireBlock(op.id);
        const current = doc.blocks[op.id];
        if (!current || (op.type === undefined && op.content === undefined)) continue;
        const type = op.type ?? current.type;
        if (type !== current.type) requireFits(current.parent, type);
        const content = normalizeContent(
          type as Parameters<typeof normalizeContent>[0],
          op.content ?? contentOf(current),
        );
        const { text, props } = fieldsFromContent(type, content);
        next = {
          kind: 'update',
          id: op.id,
          before: { type: current.type, text: current.text, props: current.props },
          after: { type, text, props },
        };
        break;
      }
      case 'move': {
        requireBlock(op.id);
        requireParent(op.parentBlockId);
        if (op.parentBlockId !== null && isWithin(doc, op.parentBlockId, op.id)) {
          throw new TransactionRejected(400, 'A block cannot be nested inside itself');
        }
        requireFits(op.parentBlockId, (doc.blocks[op.id] as { type: string }).type);
        next = {
          kind: 'move',
          id: op.id,
          from: anchorOf(doc, op.id),
          to: { parent: op.parentBlockId, after: op.afterId === op.id ? null : op.afterId },
        };
        break;
      }
      case 'remove': {
        requireBlock(op.id);
        next = {
          kind: 'remove',
          blocks: subtreeIds(doc, op.id).map(
            (id) => doc.blocks[id] as EditorDocument['blocks'][string],
          ),
          ...anchorOf(doc, op.id),
        };
        break;
      }
    }
    doc = applyOperation(doc, next);
    out.push(next);
  }
  return { ops: out };
}

/**
 * Apply `ops` to a page, all or none (`TransactionRejected`), as one update
 * to its document, and project its rows before returning. Runs in `db`, a
 * transaction the caller holds included; the update is sent to the page's
 * room unless `broadcast` is false, when the caller sends it once its
 * transaction committed (`broadcastDocUpdate`). Returns the update, null
 * when nothing changed.
 */
export async function applyBlockTransaction(
  db: PgHandle,
  input: {
    pageId: string;
    /** The operations, or a function giving them against the page as it is now. */
    ops: readonly BlockOperation[] | ((doc: EditorDocument) => readonly BlockOperation[]);
    /** Who made the change; '' for the server. */
    actorId: string;
    broadcast?: boolean;
  },
): Promise<Uint8Array | null> {
  // A block id is the block's everywhere: one another page already has is
  // refused here (the projection would leave it out of this page's rows).
  if (typeof input.ops !== 'function') {
    const inserted = input.ops.filter((op) => op.kind === 'insert').map((op) => op.id);
    const taken = await findBlocksByIds(db, inserted);
    const elsewhere = taken.find((row) => row.pageId !== input.pageId);
    if (elsewhere) throw new TransactionRejected(409, `Block ${elsewhere.id} already exists`);
  }
  const ops = input.ops;
  return writeAndProject(db, {
    pageId: input.pageId,
    actorId: input.actorId,
    broadcast: input.broadcast,
    change: (doc) => toEditorTransaction(doc, typeof ops === 'function' ? ops(doc) : ops),
  });
}

/**
 * Make a page's blocks `target` (a version restored, a note written whole) as
 * one change from the document as it is: blocks both have keep their ids, so
 * comments anchored to them stay. Same handle and broadcast rules as
 * `applyBlockTransaction`.
 */
export async function replacePageBlocks(
  db: PgHandle,
  input: { pageId: string; target: readonly BlockRow[]; actorId: string; broadcast?: boolean },
): Promise<Uint8Array | null> {
  const target = rowsToDocument(input.target);
  return writeAndProject(db, {
    pageId: input.pageId,
    actorId: input.actorId,
    broadcast: input.broadcast,
    change: (doc) => ({ ops: diffDocuments(doc, target) }),
  });
}

async function writeAndProject(
  db: PgHandle,
  input: {
    pageId: string;
    actorId: string;
    broadcast?: boolean;
    change: (doc: EditorDocument) => Transaction | null;
  },
): Promise<Uint8Array | null> {
  const update = await writeServerChange(db, input);
  if (!update) return null;
  // In the same handle: a projection on another connection would wait for the
  // page lock the caller's transaction may hold.
  await projectPage(db, input.pageId);
  if (input.broadcast !== false) broadcastDocUpdate(getIO(), input.pageId, update);
  return update;
}
