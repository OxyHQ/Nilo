"use strict";

import { useSyncExternalStore } from 'react';

/** Transient editor UI state, kept out of the document and its history. */

export class UiStore {
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
export function useUi(store, select) {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}
//# sourceMappingURL=ui-store.js.map