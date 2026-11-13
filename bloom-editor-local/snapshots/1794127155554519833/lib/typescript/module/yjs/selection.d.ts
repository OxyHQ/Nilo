/**
 * A selection in one block's text as Yjs relative positions, for telling
 * collaborators where someone's caret is.
 *
 * An offset into a block's text is only right for the text it was read from:
 * once someone types before it, it points at other characters. A relative
 * position names the character itself (in the block's `Y.Text`), so it is
 * still where that person's caret is after any edits made at the same time,
 * on any device that has the edits it was made after. Broadcast the relative
 * form (it is plain JSON) and read it back with `relativeToSelection`.
 */
import * as Y from 'yjs';
import type { BlockId } from '../model/document.js';
/** A caret or range in a block's text, in plain-text offsets. */
export interface BlockTextSelection {
    blockId: BlockId;
    start: number;
    end: number;
}
/** A Yjs relative position in its JSON form (`Y.relativePositionToJSON`). */
export type RelativePositionJSON = Readonly<Record<string, unknown>>;
/** A selection in a block's text as relative positions: plain JSON, to broadcast. */
export interface RelativeSelection {
    blockId: BlockId;
    start: RelativePositionJSON;
    end: RelativePositionJSON;
}
/**
 * A selection as positions that follow its text through concurrent edits.
 * Text typed at either end of a range stays outside it; a caret moves on past
 * text typed where it is, as the typist's own caret does. Null when the block
 * has no text in `doc`.
 */
export declare function selectionToRelative(doc: Y.Doc, selection: BlockTextSelection): RelativeSelection | null;
/**
 * Where a selection broadcast as relative positions is in `doc` now. Null
 * when the block or its text is gone, when `doc` lacks the edits the
 * positions were made after (they arrive later), and for anything that is
 * not a pair of positions in that block's text.
 */
export declare function relativeToSelection(doc: Y.Doc, relative: RelativeSelection): BlockTextSelection | null;
//# sourceMappingURL=selection.d.ts.map