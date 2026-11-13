"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.canCutAsMarkdown = canCutAsMarkdown;
exports.cutSourceMatches = cutSourceMatches;
var _document = require("./document.js");
var _operations = require("./operations.js");
var _paste = require("./paste.js");
var _snapshot = require("./snapshot.js");
/** A delayed Cut may remove only the same content, subtree and positions it copied. */
function cutSourceMatches(before, current, ids) {
  if (ids.some(id => !before.blocks[id] || !current.blocks[id])) return false;
  const state = doc => ({
    blocks: (0, _snapshot.exportSnapshot)(doc, ids),
    positions: ids.map(id => ({
      id,
      ...(0, _operations.anchorOf)(doc, id),
      subtree: (0, _document.subtreeIds)(doc, id)
    }))
  });
  return JSON.stringify(state(before)) === JSON.stringify(state(current));
}

/**
 * Whether the currently supported plain-text paste can reconstruct this entire
 * selection. This is deliberately conservative: losing a property, child, mark
 * or attachment must prevent Cut, even when the text looks useful on its own.
 * Uses a separate document, never the editor being copied from.
 */
function canCutAsMarkdown(snapshot, text, schema) {
  if (!snapshot.length || text.length > 1_000_000) return false;
  const pending = snapshot.map(node => ({
    node,
    depth: 1
  }));
  let count = 0;
  while (pending.length) {
    const next = pending.pop();
    if (!next) break;
    if (++count > 2_000 || next.depth > 64) return false;
    for (const node of next.node.children ?? []) pending.push({
      node,
      depth: next.depth + 1
    });
  }
  if (JSON.stringify(snapshot).length > 1_000_000) return false;
  let sequence = 0;
  const newId = () => `clipboard-${++sequence}`;
  const source = (0, _snapshot.documentFromSnapshot)(snapshot, newId, schema);
  const empty = (0, _snapshot.documentFromSnapshot)([{
    type: 'paragraph',
    text: []
  }], newId, schema);
  const id = empty.root[0];
  if (!id) return false;
  const transaction = (0, _paste.pasteIntoBlock)({
    doc: empty,
    schema,
    newId
  }, id, [{
    text
  }], {
    index: 0,
    deleteCount: 0,
    insert: text
  });
  return transaction !== null && JSON.stringify((0, _snapshot.documentToSnapshot)(source)) === JSON.stringify((0, _snapshot.documentToSnapshot)((0, _operations.applyTransaction)(empty, transaction)));
}
//# sourceMappingURL=clipboard.js.map