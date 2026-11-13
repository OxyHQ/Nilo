/**
 * Writing the editor's transactions into a `Y.Doc`.
 *
 * Each operation is translated as itself: an insert creates block maps, a
 * removal deletes them, a move writes `parent`, an update writes only the
 * fields it changes (props one key at a time, text by `updateSegments`).
 * Places are then written from the document the transaction produced: the
 * blocks it placed get a key between their neighbours', and any sibling left
 * out of order (two keys chosen at once can tie) gets a new one.
 */
import * as Y from 'yjs';
import type { EditorDocument } from '../model/document';
import type { Transaction } from '../model/operations';
/**
 * Write a transaction the store applied into `doc`, as one Yjs transaction
 * tagged `origin`. `after` is the store's document once it was applied.
 */
export declare function writeTransaction(doc: Y.Doc, tx: Transaction, after: EditorDocument, origin: unknown): void;
/** Fill an empty `doc` with `document`: how a page that predates Yjs is first stored. */
export declare function writeDocument(doc: Y.Doc, document: EditorDocument, origin: unknown): void;
//# sourceMappingURL=write.d.ts.map