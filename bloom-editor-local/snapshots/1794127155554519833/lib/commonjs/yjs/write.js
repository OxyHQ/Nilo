"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.writeDocument = writeDocument;
exports.writeTransaction = writeTransaction;
var Y = _interopRequireWildcard(require("yjs"));
var _fractional = require("./fractional.js");
var _layout = require("./layout.js");
var _text = require("./text.js");
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
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

function sameJson(a, b) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
function createBlock(map, block, parent) {
  const entry = new Y.Map();
  // Integrated first, so the nested types below belong to the document.
  map.set(block.id, entry);
  entry.set(_layout.FIELD.type, block.type);
  entry.set(_layout.FIELD.parent, parent);
  const props = new Y.Map();
  entry.set(_layout.FIELD.props, props);
  for (const [key, value] of Object.entries(block.props)) {
    if (value !== undefined) props.set(key, value);
  }
  if (block.text !== undefined) {
    const text = new Y.Text();
    entry.set(_layout.FIELD.text, text);
    (0, _text.writeSegments)(text, block.text);
  }
}

/** `id` and every block under it, by the `parent` fields the document holds now. */
function subtreeInDoc(map, id) {
  const children = new Map();
  map.forEach((block, childId) => {
    const parent = (0, _layout.parentOf)(block);
    if (parent === null) return;
    const list = children.get(parent);
    if (list) list.push(childId);else children.set(parent, [childId]);
  });
  const out = [];
  const visit = current => {
    if (out.includes(current)) return;
    out.push(current);
    for (const child of children.get(current) ?? []) visit(child);
  };
  visit(id);
  return out;
}
function writeOperation(map, op, placed) {
  switch (op.kind) {
    case 'insert':
      {
        const [top] = op.blocks;
        for (const block of op.blocks) {
          createBlock(map, block, block.id === top?.id ? op.parent : block.parent);
          placed.add(block.id);
        }
        return;
      }
    case 'remove':
      {
        const [top] = op.blocks;
        // What is there now, children added by others included: the removal wins.
        if (top) for (const id of subtreeInDoc(map, top.id)) map.delete(id);
        return;
      }
    case 'move':
      {
        const block = map.get(op.id);
        if (!block) return;
        block.set(_layout.FIELD.parent, op.to.parent);
        placed.add(op.id);
        return;
      }
    case 'update':
      {
        const block = map.get(op.id);
        if (!block) return;
        const fields = op.after;
        if (fields.type !== undefined && block.get(_layout.FIELD.type) !== fields.type) {
          block.set(_layout.FIELD.type, fields.type);
        }
        if (fields.props !== undefined) {
          const props = (0, _layout.propsOf)(block);
          for (const key of [...props.keys()]) {
            if (!(key in fields.props) || fields.props[key] === undefined) props.delete(key);
          }
          for (const [key, value] of Object.entries(fields.props)) {
            if (value !== undefined && !sameJson(props.get(key), value)) props.set(key, value);
          }
        }
        if ('text' in fields) {
          if (fields.text === undefined) {
            if (block.has(_layout.FIELD.text)) block.delete(_layout.FIELD.text);
          } else {
            const text = (0, _layout.textOf)(block);
            if (text) (0, _text.updateSegments)(text, fields.text);else {
              const created = new Y.Text();
              block.set(_layout.FIELD.text, created);
              (0, _text.writeSegments)(created, fields.text);
            }
          }
        }
        return;
      }
  }
}

/**
 * Give `parent`'s children in `after` keys in their order: each keeps its key
 * when that is still in order and it was not just placed, otherwise it gets
 * one between the previous key and the next one that is kept.
 */
function writePlaces(map, siblings, placed) {
  const existing = siblings.map(id => {
    const block = map.get(id);
    if (!block || placed.has(id)) return null;
    const key = (0, _layout.indexOf)(block);
    return (0, _fractional.isFractionalKey)(key) ? key : null;
  });
  let previous = null;
  siblings.forEach((id, i) => {
    const block = map.get(id);
    if (!block) return;
    const own = existing[i] ?? null;
    if (own !== null && (previous === null || own > previous)) {
      previous = own;
      return;
    }
    let bound = null;
    for (let j = i + 1; j < siblings.length; j += 1) {
      const key = existing[j] ?? null;
      if (key !== null && (previous === null || key > previous)) {
        bound = key;
        break;
      }
    }
    const key = (0, _fractional.keyBetween)(previous, bound);
    if ((0, _layout.indexOf)(block) !== key) block.set(_layout.FIELD.index, key);
    previous = key;
  });
}

/**
 * Write a transaction the store applied into `doc`, as one Yjs transaction
 * tagged `origin`. `after` is the store's document once it was applied.
 */
function writeTransaction(doc, tx, after, origin) {
  doc.transact(() => {
    const map = (0, _layout.blocksMap)(doc);
    const placed = new Set();
    for (const op of tx.ops) writeOperation(map, op, placed);
    const parents = new Set();
    for (const id of placed) {
      const block = after.blocks[id];
      if (block) parents.add(block.parent);
    }
    for (const parent of parents) {
      const siblings = parent === null ? after.root : after.blocks[parent]?.children ?? [];
      writePlaces(map, siblings, placed);
    }
  }, origin);
}

/** Fill an empty `doc` with `document`: how a page that predates Yjs is first stored. */
function writeDocument(doc, document, origin) {
  doc.transact(() => {
    const map = (0, _layout.blocksMap)(doc);
    const visit = (parent, ids) => {
      let previous = null;
      for (const id of ids) {
        const block = document.blocks[id];
        if (!block) continue;
        createBlock(map, block, parent);
        const key = (0, _fractional.keyBetween)(previous, null);
        map.get(id)?.set(_layout.FIELD.index, key);
        previous = key;
        visit(id, block.children);
      }
    };
    visit(null, document.root);
  }, origin);
}
//# sourceMappingURL=write.js.map