/**
 * The document: a normalized block tree.
 *
 * Every block is addressed by id, knows its parent, and lists its children in
 * order — the shape Notion uses (an upward `parent` pointer for permissions
 * and lookups, a downward `children` array for order). Documents are
 * immutable; operations return a new document that shares every block they
 * did not touch.
 */
import type { Segment } from '@oxy.so/bloom-text/model';
export type BlockId = string;
export interface Block {
    id: BlockId;
    type: string;
    /** The parent block, or null for a top-level block. */
    parent: BlockId | null;
    /** Inline text, for block types that carry it. */
    text?: Segment[];
    /** Type-specific data: `checked`, `expanded`, `url`, `color`, `language`… */
    props: Readonly<Record<string, unknown>>;
    /** Children in order. */
    children: readonly BlockId[];
}
export interface EditorDocument {
    /** Top-level blocks in order. */
    root: readonly BlockId[];
    blocks: Readonly<Record<BlockId, Block>>;
}
export declare function emptyDocument(): EditorDocument;
export declare function getBlock(doc: EditorDocument, id: BlockId): Block;
/** The ordered ids under `parent` (the document root when null). */
export declare function childrenOf(doc: EditorDocument, parent: BlockId | null): readonly BlockId[];
export interface Position {
    parent: BlockId | null;
    index: number;
}
export declare function positionOf(doc: EditorDocument, id: BlockId): Position;
/** `id` and every block under it, depth-first, parents before children. */
export declare function subtreeIds(doc: EditorDocument, id: BlockId): BlockId[];
/** Whether `ancestor` is `id` or contains it. */
export declare function isWithin(doc: EditorDocument, id: BlockId, ancestor: BlockId): boolean;
/** Number of ancestors: 0 for a top-level block. */
export declare function depthOf(doc: EditorDocument, id: BlockId): number;
/**
 * Every block in reading order (depth-first). `isCollapsed` hides a block's
 * children, the way a closed toggle does on screen.
 */
export declare function readingOrder(doc: EditorDocument, isCollapsed?: (block: Block) => boolean): BlockId[];
/**
 * Consistency check for tests and imports: every parent pointer matches the
 * children array that lists it, every listed id exists, nothing is listed
 * twice. Returns the problems found (empty when consistent).
 */
export declare function validateDocument(doc: EditorDocument): string[];
//# sourceMappingURL=document.d.ts.map