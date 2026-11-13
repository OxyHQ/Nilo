"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.EditorContext = void 0;
exports.useBlock = useBlock;
exports.useEditorContext = useEditorContext;
exports.useEditorSnapshot = useEditorSnapshot;
var _react = require("react");
/** What a custom block renderer receives. */

/** Presentation belongs to React; the slash command model stays platform-free. */

/** Something a mention can point at (a person, a page, a date), as the app finds it. */

/** Where the editor looks up mentions: typing an indicator (`@`) opens the menu. */

/** An application action in a block's menu (comment on the block, copy a link to it). */

/** A stretch of one block's text, as a format action receives it. */

/**
 * An application action on selected text (comment on it, ask about it),
 * shown after the marks in the web selection bubble and in `EditorToolbar`
 * while text is selected.
 */

/** What is being pasted into a block's text, before the editor pastes it. */

/**
 * Asked before blocks are removed; nothing is removed unless it answers true
 * (or resolves to true).
 */

/** A language a code block can be in, as the app names it. */

/** One run of highlighted code: its text and the colour the app gives it. */

/**
 * Highlights code for display: the lines of `code` (split at `\n`), each a
 * list of tokens whose texts join up to that line exactly.
 */

/** Inline equations typed as `$$…$$`: mentions under `indicator`. */

const EditorContext = exports.EditorContext = /*#__PURE__*/(0, _react.createContext)(null);
function useEditorContext() {
  const value = (0, _react.useContext)(EditorContext);
  if (!value) throw new Error('Editor components must render inside <BlockEditor>');
  return value;
}

/** The whole store snapshot (document, selection, undo state). */
function useEditorSnapshot(store) {
  return (0, _react.useSyncExternalStore)(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** One block; re-renders only when that block changes (blocks are immutable). */
function useBlock(store, id) {
  const read = () => store.getSnapshot().doc.blocks[id];
  return (0, _react.useSyncExternalStore)(store.subscribe, read, read);
}
//# sourceMappingURL=context.js.map