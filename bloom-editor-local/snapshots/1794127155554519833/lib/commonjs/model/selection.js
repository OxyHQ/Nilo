"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.blockRange = blockRange;
exports.blockStep = blockStep;
exports.selectableBlock = selectableBlock;
var _document = require("./document.js");
var _schema = require("./schema.js");
/**
 * Selecting whole blocks, as Notion does: a selection runs between an anchor
 * (where it started) and a head (where Shift-click, Shift-arrow or a drag has
 * taken it), over siblings. When the two sit at different depths, each is
 * taken up to the ancestor that is a sibling of the other's, so a selection
 * is always whole blocks of one list — never half a list item's children.
 */

/** `id`, or — for a part of its container's layout (a cell, a row) — the container. */
function selectableBlock(doc, schema, id) {
  let at = id;
  while ((0, _schema.isStructural)(schema, (0, _document.getBlock)(doc, at).type)) {
    const parent = (0, _document.getBlock)(doc, at).parent;
    if (parent === null) break;
    at = parent;
  }
  return at;
}

/** `id` and its ancestors, the top-level block last. */
function ancestry(doc, id) {
  const out = [];
  for (let at = id; at !== null; at = (0, _document.getBlock)(doc, at).parent) out.push(at);
  return out;
}

/**
 * The blocks from `anchor` to `head`, in document order: siblings, each
 * end taken up to the level of the other.
 */
function blockRange(doc, schema, anchor, head) {
  const a = ancestry(doc, selectableBlock(doc, schema, anchor));
  const b = ancestry(doc, selectableBlock(doc, schema, head));
  // One holds the other: the outer one alone.
  if (a.includes(b[0])) return [b[0]];
  if (b.includes(a[0])) return [a[0]];
  // The ancestors of each that share a parent.
  const shared = new Set(b);
  let common = null;
  for (const id of a) {
    if (shared.has(id)) {
      common = id;
      break;
    }
  }
  const under = chain => {
    const at = common === null ? chain.length - 1 : chain.indexOf(common) - 1;
    return chain[at];
  };
  const from = under(a);
  const to = under(b);
  // Across a container's parts (two columns, two cells): the container.
  if ((0, _schema.isStructural)(schema, (0, _document.getBlock)(doc, from).type)) return [selectableBlock(doc, schema, from)];
  const siblings = (0, _document.childrenOf)(doc, (0, _document.getBlock)(doc, from).parent);
  const i = siblings.indexOf(from);
  const j = siblings.indexOf(to);
  return siblings.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/**
 * The block a selection's head moves to with an arrow key: the next block
 * after `id` and everything under it, or the previous block on screen.
 * Hidden children (a closed toggle's) are skipped; null at either end.
 */
function blockStep(doc, schema, id, direction, isCollapsed = block => block.props.expanded === false) {
  const order = (0, _document.readingOrder)(doc, isCollapsed).filter(b => !(0, _schema.isStructural)(schema, (0, _document.getBlock)(doc, b).type));
  const at = order.indexOf(selectableBlock(doc, schema, id));
  if (at < 0) return null;
  if (direction === 'up') return order[at - 1] ?? null;
  const within = new Set();
  const visit = b => {
    within.add(b);
    for (const child of (0, _document.getBlock)(doc, b).children) visit(child);
  };
  visit(order[at]);
  for (let i = at + 1; i < order.length; i += 1) {
    const next = order[i];
    if (!within.has(next)) return next;
  }
  return null;
}
//# sourceMappingURL=selection.js.map