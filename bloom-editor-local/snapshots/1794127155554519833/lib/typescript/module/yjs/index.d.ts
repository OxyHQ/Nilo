/**
 * The block editor's documents in Yjs: a `Y.Doc` layout for block trees, and a
 * binding that keeps an `EditorStore` and a `Y.Doc` the same. Platform-free:
 * a server reads and writes the same documents with it.
 */
export { YjsBinding, type YjsBindingOptions } from './binding.js';
export { diffDocuments } from './diff.js';
export { isFractionalKey, keyBetween } from './fractional.js';
export { BLOCKS_KEY, blocksMap } from './layout.js';
export { Materializer, materialize } from './materialize.js';
export { type BlockTextSelection, type RelativePositionJSON, type RelativeSelection, relativeToSelection, selectionToRelative, } from './selection.js';
export { readSegments, updateSegments, writeSegments } from './text.js';
export { writeDocument, writeTransaction } from './write.js';
//# sourceMappingURL=index.d.ts.map