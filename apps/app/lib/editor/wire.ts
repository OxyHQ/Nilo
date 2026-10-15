/**
 * The API's block shape ⇄ the editor's document.
 *
 * The API stores blocks flat: `parentBlockId`, a fractional `order` among
 * siblings, and a `content` bag (text as `segments` plus the type's fields).
 * The editor holds a tree with anchor positions, `text` and `props`. This
 * module converts documents, local transactions (to the operations the
 * transactions endpoint applies) and the operations the server applied
 * (back to editor operations).
 *
 * Orders belong to the server. The editor sends positions as anchors ("after
 * this block"); the server turns them into orders against its own state and
 * reports every order it wrote, to the sender and to the page's room. The
 * `OrderBook` keeps those orders, each with the version that wrote it, and
 * is used to place remote changes and to keep lists in the server's order.
 */
import {
  anchorOf,
  applyOperation as applyLocally,
  type Anchor,
  type BlockFields,
  type BlockId,
  childrenOf,
  type Block as EditorBlock,
  type EditorDocument,
  getBlock,
  type Operation,
  specOf,
  subtreeIds,
  type Transaction,
} from '@oxy.so/bloom-editor/model';
import { type Segment, segmentsToPlainText } from '@oxy.so/bloom-text/model';
import { compareOrder } from '@nilo/contracts';
import type { Block, BlockContent } from '@/lib/types/pages';
import { NILO_SCHEMA } from './schema';

/** One operation of `POST /pages/:pageId/blocks/transactions`, as the editor sends it. */
export type WireOperation =
  | {
      kind: 'insert';
      id: string;
      parentBlockId: string | null;
      afterId: string | null;
      type: string;
      content: BlockContent;
    }
  | {
      kind: 'update';
      id: string;
      type?: string;
      content?: BlockContent;
      /** The page version of the content this was made on; see `OrderBook.contentVersion`. */
      baseVersion?: number;
    }
  | { kind: 'move'; id: string; parentBlockId: string | null; afterId: string | null }
  | { kind: 'remove'; id: string };

/**
 * An operation as the server applied it, in its acknowledgement and in the
 * room's broadcast: positions resolved to orders, content normalized, and
 * the renumberings it made (`reorder`).
 */
export type AppliedOperation =
  | {
      kind: 'insert';
      id: string;
      parentBlockId: string | null;
      type: string;
      content: BlockContent;
      order: number;
    }
  | { kind: 'update'; id: string; type?: string; content?: BlockContent }
  | { kind: 'move'; id: string; parentBlockId: string | null; order: number }
  | { kind: 'reorder'; id: string; parentBlockId: string | null; order: number }
  | { kind: 'remove'; id: string };

/**
 * The server's `order` for every block, each with the version that wrote it.
 * Acknowledgements and broadcasts can arrive out of version order; an older
 * version never overwrites a newer one, so the book always ends up holding
 * exactly the server's orders.
 *
 * It also knows, per block, the version of the content this client has: an
 * update says it (`baseVersion`), and the server refuses it as stale when
 * someone wrote the block since — the session then merges and sends again.
 */
export class OrderBook {
  private readonly entries = new Map<BlockId, { order: number; version: number }>();
  private readonly contents = new Map<BlockId, number>();

  /** The version of the block's content this client has seen. */
  contentVersion(id: BlockId): number | undefined {
    return this.contents.get(id);
  }

  recordContent(id: BlockId, version: number): void {
    if ((this.contents.get(id) ?? -1) < version) this.contents.set(id, version);
  }

  get(id: BlockId): number | undefined {
    return this.entries.get(id)?.order;
  }

  has(id: BlockId): boolean {
    return this.entries.has(id);
  }

  record(id: BlockId, order: number, version: number): void {
    const current = this.entries.get(id);
    if (!current || current.version <= version) this.entries.set(id, { order, version });
  }

  /** Every order with its version and content version, to persist (`OrderBook.from` reads it back). */
  toJSON(): [BlockId, number, number, number?][] {
    return [...this.entries].map(([id, e]) => {
      const content = this.contents.get(id);
      return content === undefined ? [id, e.order, e.version] : [id, e.order, e.version, content];
    });
  }

  static from(saved: readonly (readonly [BlockId, number, number, number?])[]): OrderBook {
    const book = new OrderBook();
    for (const [id, order, version, content] of saved) {
      book.record(id, order, version);
      if (content !== undefined) book.recordContent(id, content);
    }
    return book;
  }

  /** Record the orders and contents in operations the server applied at `version`. */
  recordApplied(ops: readonly AppliedOperation[], version: number): void {
    for (const op of ops) {
      if (op.kind === 'insert' || op.kind === 'move' || op.kind === 'reorder')
        this.record(op.id, op.order, version);
      if (op.kind === 'insert' || (op.kind === 'update' && op.content !== undefined))
        this.recordContent(op.id, version);
    }
  }
}

function hasText(type: string): boolean {
  return specOf(NILO_SCHEMA, type).hasText;
}

/** The editor's text and props for an API block's content. */
export function fieldsFromContent(
  type: string,
  content: BlockContent,
): { text?: Segment[]; props: Record<string, unknown> } {
  const { text, segments, ...props } = content as BlockContent & { segments?: Segment[] };
  if (!hasText(type)) return { props };
  const value = Array.isArray(segments) && segments.length > 0 ? segments : text ? [{ text }] : [];
  return { text: value, props };
}

/** The API content for an editor block: its props, plus `segments` and plain `text`. */
export function contentOf(block: Pick<EditorBlock, 'type' | 'text' | 'props'>): BlockContent {
  const content: Record<string, unknown> = { ...block.props };
  if (hasText(block.type)) {
    const segments = block.text ?? [];
    content.text = segmentsToPlainText(segments);
    // Code blocks store plain text only.
    if (block.type !== 'code') content.segments = segments;
  }
  return content as BlockContent;
}

/** Build the editor document from the API's flat list, read at `version`. */
export function blocksToDocument(
  blocks: readonly Block[],
  version = 0,
): { doc: EditorDocument; orders: OrderBook } {
  const orders = new OrderBook();
  const byParent = new Map<string | null, Block[]>();
  const known = new Set(blocks.map((b) => b.id));
  for (const block of blocks) {
    orders.record(block.id, block.order, version);
    // Read at `version`: whatever wrote it, this content is that version's.
    orders.recordContent(block.id, version);
    // A block whose parent is gone sits at the root rather than vanishing.
    const parent =
      block.parentBlockId && known.has(block.parentBlockId) ? block.parentBlockId : null;
    const list = byParent.get(parent) ?? [];
    list.push(block);
    byParent.set(parent, list);
  }
  const childIds = (parent: string | null) =>
    (byParent.get(parent) ?? [])
      .sort((a, b) => compareOrder(a.order, a.id, b.order, b.id))
      .map((b) => b.id);

  const docBlocks: Record<BlockId, EditorBlock> = {};
  for (const block of blocks) {
    const parent =
      block.parentBlockId && known.has(block.parentBlockId) ? block.parentBlockId : null;
    const { text, props } = fieldsFromContent(block.type, block.content);
    docBlocks[block.id] = {
      id: block.id,
      type: block.type,
      parent,
      ...(text !== undefined && { text }),
      props,
      children: childIds(block.id),
    };
  }
  return { doc: { root: childIds(null), blocks: docBlocks }, orders };
}

/** The block before `id` among its siblings in `doc`, as the anchor the server resolves. */
function previousSibling(doc: EditorDocument, id: BlockId): BlockId | null {
  const siblings = childrenOf(doc, getBlock(doc, id).parent);
  const index = siblings.indexOf(id);
  return index > 0 ? (siblings[index - 1] as BlockId) : null;
}

/**
 * The transactions-endpoint operations for a local transaction, replayed on
 * `before` (the document it applies to): each position is the block's anchor
 * where the editor put it, which the server turns into an order.
 */
export function transactionToWire(
  tx: Transaction,
  before: EditorDocument,
  /** When given, updates carry the content version they were made on. */
  orders?: OrderBook,
): WireOperation[] {
  const out: WireOperation[] = [];
  let doc = before;
  for (const op of tx.ops) {
    doc = applyLocally(doc, op);
    if (op.kind === 'insert') {
      // Parents come before their children, so each anchor names a block the
      // server has by the time it is resolved.
      for (const block of op.blocks) {
        out.push({
          kind: 'insert',
          id: block.id,
          parentBlockId: block.parent,
          afterId: previousSibling(doc, block.id),
          type: block.type,
          content: contentOf(block),
        });
      }
    } else if (op.kind === 'remove') {
      const top = op.blocks[0];
      if (top) out.push({ kind: 'remove', id: top.id });
    } else if (op.kind === 'move') {
      out.push({
        kind: 'move',
        id: op.id,
        parentBlockId: op.to.parent,
        afterId: previousSibling(doc, op.id),
      });
    } else {
      // The API replaces content whole: send the block's full content as it is now.
      const baseVersion = orders?.contentVersion(op.id);
      out.push({
        kind: 'update',
        id: op.id,
        ...('type' in op.after && op.after.type !== undefined && { type: op.after.type }),
        content: contentOf(getBlock(doc, op.id)),
        ...(baseVersion !== undefined && { baseVersion }),
      });
    }
  }
  return out;
}

/** The anchor for an order among `parent`'s children in `doc`. */
function anchorForOrder(
  doc: EditorDocument,
  orders: OrderBook,
  parent: BlockId | null,
  order: number,
  self: BlockId,
): Anchor {
  let after: BlockId | null = null;
  for (const id of childrenOf(doc, parent)) {
    if (id === self) continue;
    const sibling = orders.get(id);
    // A sibling with no order yet (a local block not confirmed) keeps its place.
    if (sibling === undefined || compareOrder(sibling, id, order, self) < 0) after = id;
    else break;
  }
  return { parent, after };
}

/**
 * Editor operations for a transaction the server applied at `version`
 * (someone else's), against `doc`. Operations on blocks this document does
 * not have are skipped.
 */
export function wireToOperations(
  doc: EditorDocument,
  applied: readonly AppliedOperation[],
  orders: OrderBook,
  version: number,
): Operation[] {
  const out: Operation[] = [];
  let current = doc;
  const has = (id: string | null) => id === null || current.blocks[id] !== undefined;
  // Applied as we go, so later operations see the earlier ones.
  const track = (op: Operation) => {
    out.push(op);
    current = applyLocally(current, op);
  };

  for (const op of applied) {
    if (op.kind === 'insert') {
      orders.record(op.id, op.order, version);
      orders.recordContent(op.id, version);
      if (current.blocks[op.id] || !has(op.parentBlockId)) continue;
      const { text, props } = fieldsFromContent(op.type, op.content ?? {});
      track({
        kind: 'insert',
        ...anchorForOrder(current, orders, op.parentBlockId, op.order, op.id),
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
      });
    } else if (op.kind === 'update') {
      if (op.content !== undefined) orders.recordContent(op.id, version);
      const block = current.blocks[op.id];
      if (!block) continue;
      const type = op.type ?? block.type;
      const fields = op.content ? fieldsFromContent(type, op.content) : null;
      const after: BlockFields = {};
      const before: BlockFields = {};
      if (op.type !== undefined) {
        after.type = op.type;
        before.type = block.type;
      }
      if (fields) {
        after.props = fields.props;
        before.props = block.props;
        after.text = fields.text;
        before.text = block.text;
      }
      track({ kind: 'update', id: op.id, before, after });
    } else if (op.kind === 'move' || op.kind === 'reorder') {
      orders.record(op.id, op.order, version);
      if (!current.blocks[op.id] || !has(op.parentBlockId)) continue;
      const from = anchorOf(current, op.id);
      const to = anchorForOrder(current, orders, op.parentBlockId, op.order, op.id);
      if (from.parent !== to.parent || from.after !== to.after)
        track({ kind: 'move', id: op.id, from, to });
    } else {
      if (!current.blocks[op.id]) continue;
      track({
        kind: 'remove',
        ...anchorOf(current, op.id),
        blocks: subtreeIds(current, op.id).map((id) => getBlock(current, id)),
      });
    }
  }
  return out;
}

/**
 * Moves that put every list in the server's order (`compareSiblings`), for
 * `SyncSession`'s `reconcile`. A block with no order yet (a local insert not
 * confirmed) travels with the block before it, which is the anchor it was
 * sent with.
 */
export function reconcileOrder(doc: EditorDocument, orders: OrderBook): Operation[] {
  const out: Operation[] = [];
  let current = doc;
  const lists: (BlockId | null)[] = [null, ...Object.keys(doc.blocks)];
  for (const parent of lists) {
    const children = childrenOf(current, parent);
    if (children.length < 2) continue;
    // Runs of one ordered block and the unordered ones after it; a leading
    // unordered run stays first.
    const runs: { key: BlockId | null; ids: BlockId[] }[] = [];
    for (const id of children) {
      if (orders.has(id) || runs.length === 0)
        runs.push({ key: orders.has(id) ? id : null, ids: [id] });
      else runs[runs.length - 1]?.ids.push(id);
    }
    const sorted = [...runs].sort((a, b) => {
      if (a.key === null) return -1;
      if (b.key === null) return 1;
      return compareOrder(orders.get(a.key) as number, a.key, orders.get(b.key) as number, b.key);
    });
    const wanted = sorted.flatMap((run) => run.ids);
    if (wanted.every((id, i) => id === children[i])) continue;
    wanted.forEach((id, i) => {
      if (childrenOf(current, parent)[i] === id) return;
      const op: Operation = {
        kind: 'move',
        id,
        from: anchorOf(current, id),
        to: { parent, after: i === 0 ? null : (wanted[i - 1] as BlockId) },
      };
      current = applyLocally(current, op);
      out.push(op);
    });
  }
  return out;
}
