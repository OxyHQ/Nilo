"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.EditorStore = void 0;
var _history = require("./history.js");
var _operations = require("./operations.js");
var _schema = require("./schema.js");
/**
 * The editor store: the document, the selection, and the one path every edit
 * takes — `dispatch(transaction)`.
 *
 * Listeners on `onTransaction` see every applied transaction with its origin,
 * which is how persistence (the Yjs binding, `../yjs`) follows the document
 * without diffing it. `subscribe`/`getSnapshot` fit React's
 * `useSyncExternalStore`.
 */

/**
 * Where a transaction came from. `local` edits enter the undo history;
 * `remote` ones (another collaborator, a server refresh) do not; `history`
 * is an undo or redo being applied.
 */

class EditorStore {
  /** Mints block ids. */

  listeners = new Set();
  transactionListeners = new Set();
  constructor(options) {
    this.schema = options.schema ?? _schema.DEFAULT_SCHEMA;
    this.newId = options.newId;
    this.isCollapsed = options.isCollapsed ?? (block => block.props.expanded === false);
    this.history = new _history.History(options.history);
    this.snapshot = {
      doc: options.document,
      selection: null,
      canUndo: false,
      canRedo: false
    };
  }
  subscribe = listener => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;
  get doc() {
    return this.snapshot.doc;
  }
  get selection() {
    return this.snapshot.selection;
  }

  /** Follow every applied transaction (persistence, collaboration, analytics). */
  onTransaction(listener) {
    this.transactionListeners.add(listener);
    return () => this.transactionListeners.delete(listener);
  }

  /** The context commands read: current document, schema and id factory. */
  context() {
    return {
      doc: this.doc,
      schema: this.schema,
      newId: this.newId,
      isCollapsed: this.isCollapsed
    };
  }

  /** Run a command; returns whether it changed anything. */
  run(command) {
    return this.dispatch(command(this.context()));
  }
  dispatch(tx, origin = 'local') {
    if (!tx || tx.ops.length === 0) {
      if (tx?.selectionAfter !== undefined) this.setSelection(tx.selectionAfter);
      return false;
    }
    const doc = (0, _operations.applyTransaction)(this.doc, tx);
    if (origin === 'local') this.history.record(tx);
    const selection = origin === 'remote' ? this.snapshot.selection : tx.selectionAfter !== undefined ? tx.selectionAfter : this.snapshot.selection;
    this.commit({
      doc,
      selection
    });
    for (const listener of this.transactionListeners) listener(tx, origin);
    return true;
  }
  setSelection(selection) {
    if (selection === this.snapshot.selection) return;
    this.commit({
      doc: this.doc,
      selection
    });
  }

  /** Close the current typing group (on blur, on caret jumps). */
  sealHistory() {
    this.history.seal();
  }
  undo() {
    const tx = this.history.popUndo();
    if (!tx) return false;
    return this.applyHistory((0, _operations.invertTransaction)(tx));
  }
  redo() {
    const tx = this.history.popRedo();
    if (!tx) return false;
    return this.applyHistory(tx);
  }

  /**
   * Replace the whole document (initial load, a full server refresh). Clears
   * the history, whose operations describe the old document.
   */
  reset(doc) {
    this.history.clear();
    this.commit({
      doc,
      selection: null
    });
  }

  /**
   * Undo and redo apply an entry to the document as it is now, which other
   * people may have changed since: re-recorded against it, text merged, so
   * only this person's own change is taken back or made again.
   */
  applyHistory(tx) {
    const rebased = (0, _operations.rebaseOperations)(this.doc, tx.ops);
    if (!rebased) {
      // A remote edit removed what this entry describes; it can no longer be
      // undone safely, and neither can anything older.
      this.history.clear();
      this.commit({
        doc: this.doc,
        selection: this.snapshot.selection
      });
      return false;
    }
    const applied = {
      ...tx,
      ops: rebased.ops
    };
    this.commit({
      doc: rebased.doc,
      selection: tx.selectionAfter ?? this.snapshot.selection
    });
    for (const listener of this.transactionListeners) listener(applied, 'history');
    return true;
  }
  commit(next) {
    this.snapshot = {
      doc: next.doc,
      selection: next.selection,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo
    };
    for (const listener of this.listeners) listener();
  }
}
exports.EditorStore = EditorStore;
//# sourceMappingURL=store.js.map