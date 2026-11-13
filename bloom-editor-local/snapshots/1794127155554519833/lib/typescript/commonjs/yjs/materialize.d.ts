import type * as Y from 'yjs';
import type { BlockId, EditorDocument } from '../model/document';
/**
 * The editor document a `Y.Doc` holds. `previous` lends its block objects to
 * blocks that did not change.
 */
export declare function materialize(doc: Y.Doc, previous?: EditorDocument): EditorDocument;
/**
 * Reads a `Y.Doc` again and again, decoding only the blocks named as changed
 * (their text above all, the costly part); the tree itself is rebuilt each
 * time, which is cheap.
 */
export declare class Materializer {
    private readonly decoded;
    private readonly dirty;
    private primed;
    /** Note blocks that changed since the last read; they are decoded again on the next. */
    touch(ids: Iterable<BlockId>): void;
    /** The document now: every block decoded the first time, then only those touched. */
    read(doc: Y.Doc, previous?: EditorDocument): EditorDocument;
}
//# sourceMappingURL=materialize.d.ts.map