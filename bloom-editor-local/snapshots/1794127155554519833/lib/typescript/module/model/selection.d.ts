/**
 * Selecting whole blocks, as Notion does: a selection runs between an anchor
 * (where it started) and a head (where Shift-click, Shift-arrow or a drag has
 * taken it), over siblings. When the two sit at different depths, each is
 * taken up to the ancestor that is a sibling of the other's, so a selection
 * is always whole blocks of one list — never half a list item's children.
 */
import { type Block, type BlockId, type EditorDocument } from './document.js';
import { type Schema } from './schema.js';
/** `id`, or — for a part of its container's layout (a cell, a row) — the container. */
export declare function selectableBlock(doc: EditorDocument, schema: Schema, id: BlockId): BlockId;
/**
 * The blocks from `anchor` to `head`, in document order: siblings, each
 * end taken up to the level of the other.
 */
export declare function blockRange(doc: EditorDocument, schema: Schema, anchor: BlockId, head: BlockId): BlockId[];
/**
 * The block a selection's head moves to with an arrow key: the next block
 * after `id` and everything under it, or the previous block on screen.
 * Hidden children (a closed toggle's) are skipped; null at either end.
 */
export declare function blockStep(doc: EditorDocument, schema: Schema, id: BlockId, direction: 'up' | 'down', isCollapsed?: (block: Block) => boolean): BlockId | null;
//# sourceMappingURL=selection.d.ts.map