import { type EditorDocument } from './document';
import type { Schema } from './schema';
import { type BlockSnapshot } from './snapshot';
/** A delayed Cut may remove only the same content, subtree and positions it copied. */
export declare function cutSourceMatches(before: EditorDocument, current: EditorDocument, ids: readonly string[]): boolean;
/**
 * Whether the currently supported plain-text paste can reconstruct this entire
 * selection. This is deliberately conservative: losing a property, child, mark
 * or attachment must prevent Cut, even when the text looks useful on its own.
 * Uses a separate document, never the editor being copied from.
 */
export declare function canCutAsMarkdown(snapshot: readonly BlockSnapshot[], text: string, schema: Schema): boolean;
//# sourceMappingURL=clipboard.d.ts.map