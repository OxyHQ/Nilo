"use strict";

/**
 * Keeping an editor store and a `Y.Doc` the same.
 *
 * Every transaction the person makes (an edit, an undo, a redo) is written
 * into the `Y.Doc` (`write.ts`). Every change the `Y.Doc` takes from anywhere
 * else — a collaborator, work saved on this device, a server — is read back
 * (`materialize.ts`) and applied to the store as a remote transaction
 * (`diff.ts`): outside the undo history, the selection kept.
 */
import * as Y from 'yjs';
import { rebaseOperations } from "../model/operations.js";
import { diffDocuments } from "./diff.js";
import { blocksMap } from "./layout.js";
import { Materializer } from "./materialize.js";
import { writeTransaction } from "./write.js";
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
export class YjsBinding {
  materializer = new Materializer();
  constructor(store, doc, options = {}) {
    this.store = store;
    this.doc = doc;
    // The store starts as the document holds it.
    let base = this.materializer.read(doc, store.doc);
    store.reset(base);
    this.stopStore = store.onTransaction((tx, origin) => {
      if (origin === 'remote' || options.readOnly) return;
      writeTransaction(doc, tx, store.doc, this);
    });
    const blocks = blocksMap(doc);
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
        const ops = diffDocuments(store.doc, next);
        if (ops.length > 0) store.dispatch({
          ops
        }, 'remote');
        return;
      }
      // A reader: what changed in the document since it was last read, put
      // on top of the reader's own changes; the whole difference only when
      // that no longer applies.
      const next = this.materializer.read(doc, base);
      const changes = diffDocuments(base, next);
      base = next;
      if (changes.length === 0) return;
      const rebased = rebaseOperations(store.doc, onlyChangedProps(changes, store.doc));
      const ops = rebased ? rebased.ops : diffDocuments(store.doc, next);
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
//# sourceMappingURL=binding.js.map