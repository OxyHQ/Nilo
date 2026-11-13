"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.diffDocuments = diffDocuments;
var _model = require("@oxy.so/bloom-text/model");
var _document = require("../model/document.js");
var _operations = require("../model/operations.js");
/**
 * The operations that turn one editor document into another: how a change
 * read from a `Y.Doc` (someone else's edit, offline work arriving) enters the
 * store as an ordinary remote transaction, which keeps the store's history and
 * selection rules in force.
 */

function sameJson(a, b) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
function sameProps(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (!sameJson(a[key], b[key])) return false;
  return true;
}

/** Operations that, applied in order to `from`, give `to`. */
function diffDocuments(from, to) {
  const ops = [];
  let work = from;
  const push = op => {
    work = (0, _operations.applyOperation)(work, op);
    ops.push(op);
  };

  // Removed: each topmost block that `to` lacks, with what is under it. A
  // child that survives elsewhere is put back below, as an insert.
  for (const id of (0, _document.readingOrder)(from)) {
    if (to.blocks[id] || !work.blocks[id]) continue;
    const parent = work.blocks[id]?.parent ?? null;
    if (parent !== null && !to.blocks[parent] && work.blocks[parent]) continue;
    push({
      kind: 'remove',
      blocks: (0, _document.subtreeIds)(work, id).map(sub => work.blocks[sub]),
      ...(0, _operations.anchorOf)(work, id)
    });
  }

  // Placed: `to`'s tree from the top, parents before children, so every
  // anchor names a block already where `to` has it.
  const place = parent => {
    const target = (0, _document.childrenOf)(to, parent);
    target.forEach((id, i) => {
      const after = i > 0 ? target[i - 1] : null;
      const block = to.blocks[id];
      if (!work.blocks[id]) {
        push({
          kind: 'insert',
          blocks: [{
            ...block,
            parent,
            children: []
          }],
          parent,
          after
        });
      } else {
        const current = (0, _operations.anchorOf)(work, id);
        if (current.parent !== parent || current.after !== after) {
          push({
            kind: 'move',
            id,
            from: current,
            to: {
              parent,
              after
            }
          });
        }
      }
      place(id);
    });
  };
  place(null);

  // Changed: type, text and props, each only when it differs.
  for (const id of (0, _document.readingOrder)(to)) {
    const next = to.blocks[id];
    const current = work.blocks[id];
    if (!current) continue;
    const before = {};
    const after = {};
    if (current.type !== next.type) {
      before.type = current.type;
      after.type = next.type;
    }
    const textChanged = current.text === undefined !== (next.text === undefined) || current.text !== undefined && next.text !== undefined && !(0, _model.segmentsEqual)(current.text, next.text);
    if (textChanged) {
      before.text = current.text;
      after.text = next.text;
    }
    if (!sameProps(current.props, next.props)) {
      before.props = current.props;
      after.props = next.props;
    }
    if (Object.keys(after).length > 0) push({
      kind: 'update',
      id,
      before,
      after
    });
  }
  return ops;
}
//# sourceMappingURL=diff.js.map