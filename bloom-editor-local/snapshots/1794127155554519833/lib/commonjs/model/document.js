"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.childrenOf = childrenOf;
exports.depthOf = depthOf;
exports.emptyDocument = emptyDocument;
exports.getBlock = getBlock;
exports.isWithin = isWithin;
exports.positionOf = positionOf;
exports.readingOrder = readingOrder;
exports.subtreeIds = subtreeIds;
exports.validateDocument = validateDocument;
/**
 * The document: a normalized block tree.
 *
 * Every block is addressed by id, knows its parent, and lists its children in
 * order — the shape Notion uses (an upward `parent` pointer for permissions
 * and lookups, a downward `children` array for order). Documents are
 * immutable; operations return a new document that shares every block they
 * did not touch.
 */

function emptyDocument() {
  return {
    root: [],
    blocks: {}
  };
}
function getBlock(doc, id) {
  const block = doc.blocks[id];
  if (!block) throw new Error(`Unknown block ${id}`);
  return block;
}

/** The ordered ids under `parent` (the document root when null). */
function childrenOf(doc, parent) {
  return parent === null ? doc.root : getBlock(doc, parent).children;
}
function positionOf(doc, id) {
  const {
    parent
  } = getBlock(doc, id);
  const index = childrenOf(doc, parent).indexOf(id);
  if (index < 0) throw new Error(`Block ${id} is not listed under its parent`);
  return {
    parent,
    index
  };
}

/** `id` and every block under it, depth-first, parents before children. */
function subtreeIds(doc, id) {
  const out = [];
  const visit = current => {
    out.push(current);
    for (const child of getBlock(doc, current).children) visit(child);
  };
  visit(id);
  return out;
}

/** Whether `ancestor` is `id` or contains it. */
function isWithin(doc, id, ancestor) {
  let current = id;
  while (current !== null) {
    if (current === ancestor) return true;
    current = getBlock(doc, current).parent;
  }
  return false;
}

/** Number of ancestors: 0 for a top-level block. */
function depthOf(doc, id) {
  let depth = 0;
  let parent = getBlock(doc, id).parent;
  while (parent !== null) {
    depth += 1;
    parent = getBlock(doc, parent).parent;
  }
  return depth;
}

/**
 * Every block in reading order (depth-first). `isCollapsed` hides a block's
 * children, the way a closed toggle does on screen.
 */
function readingOrder(doc, isCollapsed = () => false) {
  const out = [];
  const visit = ids => {
    for (const id of ids) {
      out.push(id);
      const block = getBlock(doc, id);
      if (block.children.length > 0 && !isCollapsed(block)) visit(block.children);
    }
  };
  visit(doc.root);
  return out;
}

/**
 * Consistency check for tests and imports: every parent pointer matches the
 * children array that lists it, every listed id exists, nothing is listed
 * twice. Returns the problems found (empty when consistent).
 */
function validateDocument(doc) {
  const problems = [];
  const seen = new Set();
  const check = (parent, ids) => {
    for (const id of ids) {
      const block = doc.blocks[id];
      if (!block) {
        problems.push(`${id} is listed but missing`);
        continue;
      }
      if (seen.has(id)) problems.push(`${id} is listed twice`);
      seen.add(id);
      if (block.parent !== parent) problems.push(`${id} has parent ${block.parent}, listed under ${parent}`);
      check(id, block.children);
    }
  };
  check(null, doc.root);
  for (const id of Object.keys(doc.blocks)) {
    if (!seen.has(id)) problems.push(`${id} is not reachable from the root`);
  }
  return problems;
}
//# sourceMappingURL=document.js.map