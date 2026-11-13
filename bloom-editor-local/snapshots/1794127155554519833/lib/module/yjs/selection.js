"use strict";

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
import { blocksMap, textOf } from "./layout.js";

/** A caret or range in a block's text, in plain-text offsets. */

/** A Yjs relative position in its JSON form (`Y.relativePositionToJSON`). */

/** A selection in a block's text as relative positions: plain JSON, to broadcast. */

function blockText(doc, blockId) {
  const block = blocksMap(doc).get(blockId);
  return block ? textOf(block) : null;
}

/**
 * A selection as positions that follow its text through concurrent edits.
 * Text typed at either end of a range stays outside it; a caret moves on past
 * text typed where it is, as the typist's own caret does. Null when the block
 * has no text in `doc`.
 */
export function selectionToRelative(doc, selection) {
  const text = blockText(doc, selection.blockId);
  if (!text || !Number.isFinite(selection.start) || !Number.isFinite(selection.end)) return null;
  const clamp = offset => Math.max(0, Math.min(text.length, Math.trunc(offset)));
  const from = clamp(Math.min(selection.start, selection.end));
  const to = clamp(Math.max(selection.start, selection.end));
  // The start holds on to the character after it, the end to the one before
  // it, so what is typed at either end is not taken in. A caret is both, and
  // holds on to one character, so it never turns into a range.
  const start = Y.createRelativePositionFromTypeIndex(text, from, 0);
  const end = from === to ? start : Y.createRelativePositionFromTypeIndex(text, to, -1);
  return {
    blockId: selection.blockId,
    start: Y.relativePositionToJSON(start),
    end: Y.relativePositionToJSON(end)
  };
}

/**
 * Where a selection broadcast as relative positions is in `doc` now. Null
 * when the block or its text is gone, when `doc` lacks the edits the
 * positions were made after (they arrive later), and for anything that is
 * not a pair of positions in that block's text.
 */
export function relativeToSelection(doc, relative) {
  if (typeof relative?.blockId !== 'string') return null;
  const text = blockText(doc, relative.blockId);
  if (!text) return null;
  const resolve = json => {
    if (typeof json !== 'object' || json === null) return null;
    try {
      const position = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(json), doc);
      return position && position.type === text ? position.index : null;
    } catch {
      // Not a relative position (it came from the network): no selection.
      return null;
    }
  };
  const start = resolve(relative.start);
  const end = resolve(relative.end);
  if (start === null || end === null) return null;
  return {
    blockId: relative.blockId,
    start: Math.min(start, end),
    end: Math.max(start, end)
  };
}
//# sourceMappingURL=selection.js.map