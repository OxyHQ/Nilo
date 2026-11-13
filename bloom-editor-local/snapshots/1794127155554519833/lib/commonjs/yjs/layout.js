"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FIELD = exports.BLOCKS_KEY = void 0;
exports.blocksMap = blocksMap;
exports.indexOf = indexOf;
exports.parentOf = parentOf;
exports.propsOf = propsOf;
exports.textOf = textOf;
var Y = _interopRequireWildcard(require("yjs"));
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
/**
 * How a document lives in a `Y.Doc`.
 *
 * One map, `blocks`, from block id to the block's own `Y.Map`:
 *
 * - `type`: string;
 * - `parent`: the parent's id, or null at the top level;
 * - `index`: a fractional key (`fractional.ts`) ordering it among its siblings;
 * - `props`: a `Y.Map`, so two people changing different properties both win;
 * - `text`: a `Y.Text`, present only for blocks that carry text.
 *
 * There are no children arrays. A block's place is written on the block alone
 * (`parent` and `index` together), so two people moving the same block at
 * once leave it in one place, never two, and nothing is ever listed twice.
 * What a tree needs and a CRDT cannot promise is settled when the document is
 * read (`materialize.ts`), the same way on every device.
 */

const BLOCKS_KEY = exports.BLOCKS_KEY = 'blocks';
const FIELD = exports.FIELD = {
  type: 'type',
  parent: 'parent',
  index: 'index',
  props: 'props',
  text: 'text'
};
function blocksMap(doc) {
  return doc.getMap(BLOCKS_KEY);
}
function propsOf(block) {
  const props = block.get(FIELD.props);
  if (props instanceof Y.Map) return props;
  const created = new Y.Map();
  block.set(FIELD.props, created);
  return created;
}
function textOf(block) {
  const text = block.get(FIELD.text);
  return text instanceof Y.Text ? text : null;
}
function parentOf(block) {
  const parent = block.get(FIELD.parent);
  return typeof parent === 'string' ? parent : null;
}
function indexOf(block) {
  const index = block.get(FIELD.index);
  return typeof index === 'string' ? index : '';
}
//# sourceMappingURL=layout.js.map