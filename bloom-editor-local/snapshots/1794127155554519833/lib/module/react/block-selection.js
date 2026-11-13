"use strict";

import { blockRange, blockStep, selectableBlock } from "../model/selection.js";
/** Select `ids` as whole blocks, remembering where the selection runs from and to. */
export function selectBlocks(ui, ids, anchor = ids[0] ?? null, head = ids[ids.length - 1] ?? null) {
  ui.set({
    selectedBlocks: ids,
    selectionAnchor: anchor,
    selectionHead: head
  });
}
export function clearBlockSelection(ui) {
  const state = ui.get();
  if (state.selectedBlocks.length === 0 && state.selectionAnchor === null) return;
  ui.set({
    selectedBlocks: [],
    selectionAnchor: null,
    selectionHead: null
  });
}

/**
 * Shift-click: the blocks from where the selection started — the selected
 * blocks' anchor, or the block being edited — to `to`. False when there is
 * nowhere to start from.
 */
export function extendBlockSelection(store, ui, to) {
  const state = ui.get();
  const anchor = state.selectedBlocks.length > 0 ? state.selectionAnchor ?? state.selectedBlocks[0] ?? null : state.focused;
  if (anchor === null || !store.doc.blocks[anchor] || !store.doc.blocks[to]) return false;
  selectBlocks(ui, blockRange(store.doc, store.schema, anchor, to), anchor, to);
  return true;
}

/**
 * An arrow key on selected blocks: with Shift the head moves and the range
 * follows it; without, the block after (or before) the selection is selected
 * alone. False at either end of the page.
 */
export function stepBlockSelection(store, ui, direction, extend) {
  const {
    selectedBlocks,
    selectionAnchor,
    selectionHead
  } = ui.get();
  if (selectedBlocks.length === 0) return false;
  const edge = direction === 'up' ? selectedBlocks[0] : selectedBlocks[selectedBlocks.length - 1];
  const from = extend ? selectionHead ?? edge : edge;
  if (!from || !store.doc.blocks[from]) return false;
  const context = store.context();
  const next = blockStep(store.doc, store.schema, from, direction, context.isCollapsed);
  if (next === null) return false;
  if (extend) {
    const anchor = selectionAnchor ?? selectedBlocks[0] ?? from;
    selectBlocks(ui, blockRange(store.doc, store.schema, anchor, next), anchor, next);
  } else {
    const block = selectableBlock(store.doc, store.schema, next);
    selectBlocks(ui, [block]);
  }
  return true;
}
//# sourceMappingURL=block-selection.js.map