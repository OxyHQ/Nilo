"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Materializer = void 0;
exports.materialize = materialize;
var _model = require("@oxy.so/bloom-text/model");
var _layout = require("./layout.js");
var _text = require("./text.js");
/**
 * Reading a `Y.Doc` as an editor document.
 *
 * Every device reads the same state the same way, so these rules give every
 * device the same tree:
 *
 * - siblings sort by `index`, then by id (two blocks given the same key at
 *   once still have one order);
 * - a block whose parent is gone (removed while someone added a child to
 *   it) is gone too, with everything under it — the removal wins;
 * - a cycle (two people each moving a block under the other) is broken at
 *   the block with the smallest id, which goes to the top level.
 *
 * Blocks that did not change keep their previous objects, so a view that
 * draws one row per block redraws only the rows that changed.
 */

function decode(block) {
  const type = block.get(_layout.FIELD.type);
  const props = block.get(_layout.FIELD.props);
  const text = (0, _layout.textOf)(block);
  return {
    type: typeof type === 'string' ? type : 'paragraph',
    parent: (0, _layout.parentOf)(block),
    index: (0, _layout.indexOf)(block),
    text: text ? (0, _text.readSegments)(text) : undefined,
    props: props && typeof props.toJSON === 'function' ? props.toJSON() : {}
  };
}
function sameJson(a, b) {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}
function sameIds(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
function sameBlock(a, b) {
  if (a.type !== b.type || a.parent !== b.parent || !sameIds(a.children, b.children)) return false;
  if (a.text === undefined !== (b.text === undefined)) return false;
  if (a.text && b.text && !(0, _model.segmentsEqual)(a.text, b.text)) return false;
  const keys = new Set([...Object.keys(a.props), ...Object.keys(b.props)]);
  for (const key of keys) if (!sameJson(a.props[key], b.props[key])) return false;
  return true;
}

/** Break cycles: each loop's smallest id goes to the top level. */
function effectiveParents(decoded) {
  const parent = new Map();
  for (const [id, block] of decoded) parent.set(id, block.parent);
  const settled = new Set();
  for (const start of [...decoded.keys()].sort()) {
    const path = [];
    const onPath = new Set();
    let current = start;
    while (current !== null && !settled.has(current) && decoded.has(current)) {
      if (onPath.has(current)) {
        const loop = path.slice(path.indexOf(current));
        const breaker = [...loop].sort()[0];
        parent.set(breaker, null);
        break;
      }
      onPath.add(current);
      path.push(current);
      current = parent.get(current) ?? null;
    }
    for (const id of path) settled.add(id);
  }
  return parent;
}

/**
 * The editor document a `Y.Doc` holds. `previous` lends its block objects to
 * blocks that did not change.
 */
function materialize(doc, previous) {
  return new Materializer().read(doc, previous);
}

/**
 * Reads a `Y.Doc` again and again, decoding only the blocks named as changed
 * (their text above all, the costly part); the tree itself is rebuilt each
 * time, which is cheap.
 */
class Materializer {
  decoded = new Map();
  dirty = new Set();
  primed = false;

  /** Note blocks that changed since the last read; they are decoded again on the next. */
  touch(ids) {
    for (const id of ids) this.dirty.add(id);
  }

  /** The document now: every block decoded the first time, then only those touched. */
  read(doc, previous) {
    const map = (0, _layout.blocksMap)(doc);
    if (!this.primed) {
      map.forEach((block, id) => {
        this.decoded.set(id, decode(block));
      });
      this.primed = true;
    } else {
      for (const id of this.dirty) {
        const block = map.get(id);
        if (block) this.decoded.set(id, decode(block));else this.decoded.delete(id);
      }
    }
    this.dirty.clear();
    return build(this.decoded, previous);
  }
}
exports.Materializer = Materializer;
function build(decoded, previous) {
  const parent = effectiveParents(decoded);
  // Present: reachable from the top level through blocks that exist.
  const present = new Map();
  const isPresent = id => {
    const known = present.get(id);
    if (known !== undefined) return known;
    present.set(id, false);
    const p = parent.get(id) ?? null;
    const result = p === null ? true : decoded.has(p) && isPresent(p);
    present.set(id, result);
    return result;
  };
  const childrenOf = new Map();
  for (const id of decoded.keys()) {
    if (!isPresent(id)) continue;
    const p = parent.get(id) ?? null;
    const list = childrenOf.get(p);
    if (list) list.push(id);else childrenOf.set(p, [id]);
  }
  const order = (a, b) => {
    const ia = decoded.get(a)?.index ?? '';
    const ib = decoded.get(b)?.index ?? '';
    if (ia !== ib) return ia < ib ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  };
  for (const list of childrenOf.values()) list.sort(order);
  const blocks = {};
  for (const [id, data] of decoded) {
    if (!isPresent(id)) continue;
    const block = {
      id,
      type: data.type,
      parent: parent.get(id) ?? null,
      props: data.props,
      children: childrenOf.get(id) ?? [],
      ...(data.text !== undefined && {
        text: data.text
      })
    };
    const before = previous?.blocks[id];
    blocks[id] = before && sameBlock(before, block) ? before : block;
  }
  const root = childrenOf.get(null) ?? [];
  return {
    root: previous && sameIds(previous.root, root) ? previous.root : root,
    blocks
  };
}
//# sourceMappingURL=materialize.js.map