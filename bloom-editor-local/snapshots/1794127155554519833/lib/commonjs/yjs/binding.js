"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.YjsBinding = void 0;
var Y = _interopRequireWildcard(require("yjs"));
var _operations = require("../model/operations.js");
var _diff = require("./diff.js");
var _layout = require("./layout.js");
var _materialize = require("./materialize.js");
var _write = require("./write.js");
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
/**
 * Keeping an editor store and a `Y.Doc` the same.
 *
 * Every transaction the person makes (an edit, an undo, a redo) is written
 * into the `Y.Doc` (`write.ts`). Every change the `Y.Doc` takes from anywhere
 * else — a collaborator, work saved on this device, a server — is read back
 * (`materialize.ts`) and applied to the store as a remote transaction
 * (`diff.ts`): outside the undo history, the selection kept.
 */

/** Update operations narrowed to the props that changed, applied over the store's own. */
function onlyChangedProps(ops, store) {
  return ops.map(op => {
    if (op.kind !== 'update' || !op.after.props || !op.before.props) return op;
    const current = store.blocks[op.id]?.props;
    if (!current) return op;
    const props = {
      ...current
    };
    const keys = new Set([...Object.keys(op.before.props), ...Object.keys(op.after.props)]);
    for (const key of keys) {
      const before = op.before.props[key];
      const after = op.after.props[key];
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      if (after === undefined) delete props[key];else props[key] = after;
    }
    return {
      ...op,
      after: {
        ...op.after,
        props
      }
    };
  });
}
class YjsBinding {
  materializer = new _materialize.Materializer();
  constructor(store, doc, options = {}) {
    this.store = store;
    this.doc = doc;
    // The store starts as the document holds it.
    let base = this.materializer.read(doc, store.doc);
    store.reset(base);
    this.stopStore = store.onTransaction((tx, origin) => {
      if (origin === 'remote' || options.readOnly) return;
      (0, _write.writeTransaction)(doc, tx, store.doc, this);
    });
    const blocks = (0, _layout.blocksMap)(doc);
    const observer = (events, tr) => {
      const changed = new Set();
      for (const event of events) {
        if (event instanceof Y.YMapEvent && event.target === blocks) {
          for (const key of event.keysChanged) changed.add(key);
        } else {
          const id = event.path[0];
          if (typeof id === 'string') changed.add(id);
        }
      }
      this.materializer.touch(changed);
      // Its own writes are already in the store.
      if (tr.origin === this) return;
      if (!options.readOnly) {
        const next = this.materializer.read(doc, store.doc);
        const ops = (0, _diff.diffDocuments)(store.doc, next);
        if (ops.length > 0) store.dispatch({
          ops
        }, 'remote');
        return;
      }
      // A reader: what changed in the document since it was last read, put
      // on top of the reader's own changes; the whole difference only when
      // that no longer applies.
      const next = this.materializer.read(doc, base);
      const changes = (0, _diff.diffDocuments)(base, next);
      base = next;
      if (changes.length === 0) return;
      const rebased = (0, _operations.rebaseOperations)(store.doc, onlyChangedProps(changes, store.doc));
      const ops = rebased ? rebased.ops : (0, _diff.diffDocuments)(store.doc, next);
      if (ops.length > 0) store.dispatch({
        ops
      }, 'remote');
    };
    blocks.observeDeep(observer);
    this.stopDoc = () => blocks.unobserveDeep(observer);
  }
  dispose() {
    this.stopStore();
    this.stopDoc();
  }
}
exports.YjsBinding = YjsBinding;
//# sourceMappingURL=binding.js.map