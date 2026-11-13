/**
 * Atomic operations and transactions.
 *
 * Every user action becomes a transaction: a list of operations applied
 * together, the way Notion groups its record operations. Each operation
 * carries the state it replaces, so inverting it (undo) needs no document and
 * a persistence adapter can translate it without diffing.
 *
 * Positions are anchors — "under this parent, after that sibling" — never
 * indices, as Notion's `listAfter` is: an operation replayed after someone
 * else's concurrent change still lands next to the block it was placed by.
 * An anchor that no longer exists puts the block at the end of its parent.
 */
import { type Segment } from '@oxy.so/bloom-text/model';
import { type Block, type BlockId, type EditorDocument } from './document.js';
/** The fields an update can change. A present key is set; `text: undefined` removes the text. */
export interface BlockFields {
    type?: string;
    text?: Segment[] | undefined;
    props?: Readonly<Record<string, unknown>>;
}
/** A place in the tree: under `parent` (the root when null), right after `after` (first when null). */
export interface Anchor {
    parent: BlockId | null;
    after: BlockId | null;
}
export type Operation = 
/** Insert a subtree, `blocks[0]` at the anchor, the rest its descendants. */
({
    kind: 'insert';
    blocks: Block[];
} & Anchor)
/** Remove a subtree; `blocks` and the anchor are what the inverse restores. */
 | ({
    kind: 'remove';
    blocks: Block[];
} & Anchor)
/** Move a block and its subtree. */
 | {
    kind: 'move';
    id: BlockId;
    from: Anchor;
    to: Anchor;
} | {
    kind: 'update';
    id: BlockId;
    before: BlockFields;
    after: BlockFields;
};
/** Where the caret or selection is: in one block's text, or over whole blocks. */
export type EditorSelection = {
    kind: 'text';
    blockId: BlockId;
    start: number;
    end: number;
} | {
    kind: 'blocks';
    ids: readonly BlockId[];
};
export interface Transaction {
    ops: readonly Operation[];
    selectionBefore?: EditorSelection | null;
    selectionAfter?: EditorSelection | null;
}
/** The anchor a block currently sits at. */
export declare function anchorOf(doc: EditorDocument, id: BlockId): Anchor;
/** The anchor for `parent[index]` in `doc`, as if `moving` were not in the list. */
export declare function anchorAt(doc: EditorDocument, parent: BlockId | null, index: number, moving?: BlockId): Anchor;
/** Apply one operation. Throws when it cannot apply to this document. */
export declare function applyOperation(doc: EditorDocument, op: Operation): EditorDocument;
export declare function invertOperation(op: Operation): Operation;
export declare function applyTransaction(doc: EditorDocument, tx: Transaction): EditorDocument;
export declare function invertTransaction(tx: Transaction): Transaction;
/**
 * The same operations, re-recorded against `doc`: each one's "before" state
 * (old fields, removed subtree, origin anchor) is read from the document it
 * now applies to, so inverting it later restores what was really there.
 * A text change made against an older text is merged into the block's text
 * as it is now (`mergeText`): someone else's words in the same block stay.
 * Returns null when an operation no longer applies.
 */
export declare function rebaseOperations(doc: EditorDocument, ops: readonly Operation[]): {
    ops: Operation[];
    doc: EditorDocument;
} | null;
//# sourceMappingURL=operations.d.ts.map