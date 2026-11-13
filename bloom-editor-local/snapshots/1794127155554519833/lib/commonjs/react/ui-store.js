"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.UiStore = void 0;
exports.useUi = useUi;
var _react = require("react");
/** Transient editor UI state, kept out of the document and its history. */

class UiStore {
  state = {
    slash: null,
    mention: null,
    focused: null,
    marks: null,
    linking: null,
    blockMenu: null,
    selectedBlocks: [],
    selectionAnchor: null,
    selectionHead: null,
    codeLanguageMenu: null,
    hovered: null,
    formatActions: [],
    drag: null
  };
  listeners = new Set();
  subscribe = listener => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  get = () => this.state;
  set(patch) {
    this.state = {
      ...this.state,
      ...patch
    };
    for (const listener of this.listeners) listener();
  }
}

/** Read a slice of UI state; re-renders only when the slice changes. */
exports.UiStore = UiStore;
function useUi(store, select) {
  return (0, _react.useSyncExternalStore)(store.subscribe, () => select(store.get()), () => select(store.get()));
}
//# sourceMappingURL=ui-store.js.map