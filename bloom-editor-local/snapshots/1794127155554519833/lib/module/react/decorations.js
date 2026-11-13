"use strict";

import { useSyncExternalStore } from 'react';

/**
 * A stretch of a block's text the application marks: a highlight behind it
 * (a collaborator's selection, a commented passage), a caret, or both.
 * Offsets are the block's plain-text offsets, as its selection counts them.
 */

/**
 * How a block is marked by the application: a coloured edge and a label
 * (whose caret is there), and marks on stretches of its text.
 */

/**
 * Per-block decorations an application changes often (collaborators' carets):
 * a store outside the editor's context, so setting them re-renders only the
 * blocks whose decoration changed.
 */
export class BlockDecorations {
  map = new Map();
  listeners = new Set();
  subscribe = listener => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  get = id => this.map.get(id);

  /** Replace every decoration. */
  set(decorations) {
    this.map = decorations;
    for (const listener of this.listeners) listener();
  }
}

/** One block's decoration; re-renders only when it changes. */
export function useBlockDecoration(store, id) {
  return useSyncExternalStore(store?.subscribe ?? noop, () => store?.get(id), () => store?.get(id));
}
const noop = () => () => {};
//# sourceMappingURL=decorations.js.map