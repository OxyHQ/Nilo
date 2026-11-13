/**
 * Block snapshots: a nested, id-free JSON form of blocks.
 *
 * One format serves the clipboard, templates, duplication across pages, and
 * import/export: transformers convert other formats (Markdown, HTML, a Notion
 * export) to and from snapshots, and inserting a snapshot is one transaction.
 */
import { type Segment } from '@oxy.so/bloom-text/model';
import type { IdFactory } from './commands';
import { type BlockId, type EditorDocument } from './document';
import type { Transaction } from './operations';
import { type Schema } from './schema';
export interface BlockSnapshot {
    type: string;
    text?: Segment[];
    props?: Record<string, unknown>;
    children?: BlockSnapshot[];
}
/** Snapshot the given blocks (with their subtrees), in the order given. */
export declare function exportSnapshot(doc: EditorDocument, ids: readonly BlockId[]): BlockSnapshot[];
/** The whole document as a snapshot. */
export declare function documentToSnapshot(doc: EditorDocument): BlockSnapshot[];
/**
 * Build a document from a snapshot, minting ids. With a schema, each block's
 * props are completed and restricted as the schema says (`propsFor`).
 */
export declare function documentFromSnapshot(snapshot: readonly BlockSnapshot[], newId: IdFactory, schema?: Schema): EditorDocument;
/**
 * Insert a snapshot after `afterId` (at the end of the document when null),
 * as one transaction. Returns null for an empty snapshot. With a schema,
 * props follow it as in `documentFromSnapshot`.
 */
export declare function insertSnapshot(doc: EditorDocument, snapshot: readonly BlockSnapshot[], afterId: BlockId | null, newId: IdFactory, schema?: Schema): Transaction | null;
/** Render a snapshot as Markdown (export, copy as text). */
export declare function snapshotToMarkdown(snapshot: readonly BlockSnapshot[]): string;
//# sourceMappingURL=snapshot.d.ts.map