/**
 * How a document lives in a `Y.Doc`.
 *
 * One map, `blocks`, from block id to the block's own `Y.Map`:
 *
 * - `type`: string;
 * - `parent`: the parent's id, or null at the top level;
 * - `index`: a fractional key (`fractional.ts`) ordering it among its siblings;
 * - `props`: a `Y.Map`, so two people changing different properties both win;
 * - `text`: a `Y.Text`, present only for blocks that carry text.
 *
 * There are no children arrays. A block's place is written on the block alone
 * (`parent` and `index` together), so two people moving the same block at
 * once leave it in one place, never two, and nothing is ever listed twice.
 * What a tree needs and a CRDT cannot promise is settled when the document is
 * read (`materialize.ts`), the same way on every device.
 */
import * as Y from 'yjs';
export declare const BLOCKS_KEY = "blocks";
export declare const FIELD: {
    readonly type: "type";
    readonly parent: "parent";
    readonly index: "index";
    readonly props: "props";
    readonly text: "text";
};
export declare function blocksMap(doc: Y.Doc): Y.Map<Y.Map<unknown>>;
export declare function propsOf(block: Y.Map<unknown>): Y.Map<unknown>;
export declare function textOf(block: Y.Map<unknown>): Y.Text | null;
export declare function parentOf(block: Y.Map<unknown>): string | null;
export declare function indexOf(block: Y.Map<unknown>): string;
//# sourceMappingURL=layout.d.ts.map