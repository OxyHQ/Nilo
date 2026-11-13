import type { BlockId } from '../model/document.js';
/**
 * A stretch of a block's text the application marks: a highlight behind it
 * (a collaborator's selection, a commented passage), a caret, or both.
 * Offsets are the block's plain-text offsets, as its selection counts them.
 */
export interface TextRangeDecoration {
    start: number;
    /**
     * Where the caret is drawn, when there is one: a selection made backwards
     * has its `end` before its `start`.
     */
    end: number;
    /** A colour behind the text from `start` to `end`. */
    background?: string;
    /** A thin caret at `end`, with a name over it. */
    caret?: {
        color: string;
        label?: string;
    };
}
/**
 * How a block is marked by the application: a coloured edge and a label
 * (whose caret is there), and marks on stretches of its text.
 */
export interface BlockDecoration {
    /** The colour of an edge beside the block; no edge without one. */
    color?: string;
    /** Read by assistive technology, e.g. "Ana is editing". */
    label?: string;
    /**
     * Highlights and carets in the block's text. Drawn over the text while the
     * block is not being edited; while it is, over the input on web, and not at
     * all on native (where the input tells nothing of where its text is drawn).
     */
    ranges?: readonly TextRangeDecoration[];
}
/**
 * Per-block decorations an application changes often (collaborators' carets):
 * a store outside the editor's context, so setting them re-renders only the
 * blocks whose decoration changed.
 */
export declare class BlockDecorations {
    private map;
    private readonly listeners;
    readonly subscribe: (listener: () => void) => () => boolean;
    readonly get: (id: BlockId) => BlockDecoration | undefined;
    /** Replace every decoration. */
    set(decorations: ReadonlyMap<BlockId, BlockDecoration>): void;
}
/** One block's decoration; re-renders only when it changes. */
export declare function useBlockDecoration(store: BlockDecorations | undefined, id: BlockId): BlockDecoration | undefined;
//# sourceMappingURL=decorations.d.ts.map