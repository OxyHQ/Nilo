"use strict";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { duplicateBlocks, indentBlocks, insertBlockAfter, outdentBlocks, removeBlocks } from "../model/commands.js";
import { exportSnapshot, snapshotToMarkdown } from "../model/snapshot.js";
import { canCutAsMarkdown, cutSourceMatches } from "../model/clipboard.js";
import { getBlock } from "../model/document.js";
import { specOf } from "../model/schema.js";
import { BLOCK_DOM_PREFIX, blockElementAt, GUTTER_DOM_PREFIX } from "./block-dom.js";
import { BlockMenu } from "./BlockMenu.js";
import { clearBlockSelection, extendBlockSelection, selectBlocks, stepBlockSelection } from "./block-selection.js";
import { CodeLanguageMenu } from "./CodeLanguageMenu.js";
import { afterConfirm } from "./confirm-remove.js";
import { useEditorController } from "./controller.js";
import { BlockList } from "./BlockRow.js";
import { blockRange } from "../model/selection.js";
import { EditorContext, useEditorContext, useEditorSnapshot } from "./context.js";
import { DEFAULT_LABELS } from "./labels.js";
import { DEFAULT_THEME } from "./theme.js";
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
const NONE = {};
const openWithLinking = href => {
  void Linking.openURL(href);
};
const NO_ACTIONS = [];
const NO_FORMAT_ACTIONS = [];

/**
 * A Notion-style block editor over an `EditorStore`, the document laid out
 * top to bottom. Every edit goes through the store's commands; the app
 * persists by listening to its transactions.
 */
export function BlockEditor(props) {
  return /*#__PURE__*/_jsx(EditorSurface, {
    ...props,
    children: /*#__PURE__*/_jsx(DocumentBody, {})
  });
}

/** The document's blocks in order, and the space below them that adds one. */
function DocumentBody() {
  const {
    store,
    readOnly,
    labels
  } = useEditorContext();
  const snapshot = useEditorSnapshot(store);

  // Clicking below the last block focuses it when it is an empty paragraph,
  // otherwise adds one — as in Notion.
  const focusEnd = () => {
    if (readOnly) return;
    const last = snapshot.doc.root[snapshot.doc.root.length - 1];
    if (last) {
      const block = getBlock(snapshot.doc, last);
      const isEmptyParagraph = block.type === 'paragraph' && block.children.length === 0 && (block.text ?? []).every(s => !s.text);
      if (isEmptyParagraph && specOf(store.schema, block.type).hasText) {
        store.setSelection({
          kind: 'text',
          blockId: last,
          start: 0,
          end: 0
        });
        return;
      }
    }
    store.sealHistory();
    store.run(c => insertBlockAfter(c, last ?? null, 'paragraph'));
  };
  return /*#__PURE__*/_jsxs(_Fragment, {
    children: [/*#__PURE__*/_jsx(BlockList, {
      ids: snapshot.doc.root,
      depth: 0
    }), !readOnly ? /*#__PURE__*/_jsx(Pressable, {
      accessibilityRole: "button",
      accessibilityLabel: labels.addBelow,
      onPress: focusEnd,
      style: styles.tail
    }) : null]
  });
}

/**
 * The editor without a layout: its context (store, menus, theme), the
 * keyboard and clipboard handling of whole-block selections, and the block
 * menu; the app lays the blocks out with `BlockList`s inside it.
 */
export function EditorSurface({
  store,
  slashItems,
  onSlashAction,
  renderers = NONE,
  markers = NONE,
  blockActions = NO_ACTIONS,
  decorations,
  mentions,
  onOpenLink = openWithLinking,
  onOpenMention,
  onCopyBlockLink,
  onClipboardError,
  onPasteImages,
  codeLanguages,
  highlightCode,
  inlineEquations,
  formatActions = NO_FORMAT_ACTIONS,
  onPasteText,
  confirmRemove,
  domIdPrefix = BLOCK_DOM_PREFIX,
  theme = DEFAULT_THEME,
  labels,
  readOnly = false,
  controller: given,
  style,
  children
}) {
  const own = useEditorController(store);
  const controller = given ?? own;
  const {
    ui,
    inputs
  } = controller;
  useLayoutEffect(() => {
    controller.setEditable(!readOnly);
    const unsubscribe = store.subscribe(() => controller.validateLinkSession());
    return () => {
      unsubscribe();
      controller.setEditable(false);
    };
  }, [controller, store, readOnly]);
  const mergedLabels = useMemo(() => ({
    ...DEFAULT_LABELS,
    ...labels
  }), [labels]);

  // The format bar is drawn inside the editor and in `EditorToolbar` outside
  // it: both read the actions from the controller's UI state.
  useEffect(() => {
    ui.set({
      formatActions
    });
    return () => {
      if (ui.get().formatActions === formatActions) ui.set({
        formatActions: NO_FORMAT_ACTIONS
      });
    };
  }, [ui, formatActions]);

  // Removing whole blocks waits for the app's word; one question at a time.
  const removalAccess = useRef(null);
  useLayoutEffect(() => {
    removalAccess.current = {
      store,
      readOnly
    };
    return () => {
      removalAccess.current = null;
    };
  }, [store, readOnly]);
  const confirming = useRef(false);
  const requestRemove = useCallback((ids, stillCurrent) => {
    if (readOnly || ids.length === 0 || confirming.current) return;
    const answer = afterConfirm(confirmRemove, ids, () => {
      const access = removalAccess.current;
      if (!access || access.store !== store || access.readOnly) return;
      if (stillCurrent && !stillCurrent()) return;
      const present = ids.filter(id => store.doc.blocks[id]);
      if (present.length === 0) return;
      clearBlockSelection(ui);
      store.sealHistory();
      store.run(c => removeBlocks(c, present));
    });
    if (typeof answer !== 'boolean') {
      confirming.current = true;
      void answer.finally(() => {
        confirming.current = false;
      });
    }
  }, [confirmRemove, readOnly, store, ui]);
  const value = useMemo(() => ({
    store,
    controller,
    ui,
    theme,
    labels: mergedLabels,
    renderers,
    markers,
    blockActions,
    decorations,
    mentions,
    onOpenLink,
    onOpenMention,
    slashItems,
    onSlashAction,
    onCopyBlockLink,
    onPasteImages,
    codeLanguages,
    highlightCode,
    inlineEquations,
    onPasteText,
    requestRemove,
    domIdPrefix,
    readOnly,
    inputs
  }), [store, controller, ui, theme, mergedLabels, renderers, markers, blockActions, decorations, mentions, onOpenLink, onOpenMention, slashItems, onSlashAction, onCopyBlockLink, onPasteImages, codeLanguages, highlightCode, inlineEquations, onPasteText, requestRemove, domIdPrefix, readOnly, inputs]);

  // Whole-block selection on web: arrows move it (Shift extends it),
  // Backspace deletes, ⌘D duplicates, Tab and Shift-Tab nest, Return edits.
  useEffect(() => {
    const node = root.current;
    if (Platform.OS !== 'web' || readOnly || !node?.addEventListener) return;
    const onKey = event => {
      const target = event.target;
      if (event.defaultPrevented || node.ownerDocument.activeElement !== node || target?.closest?.('[data-bloom-editor-surface]') !== node) return;
      const {
        selectedBlocks: selected,
        blockMenu,
        codeLanguageMenu
      } = ui.get();
      // An open menu has the keyboard.
      if (blockMenu !== null || codeLanguageMenu !== null) return;
      const mod = event.metaKey || event.ctrlKey;
      // A Cut/Delete clears the block selection, but this surface still owns
      // focus and its history. Do not fall through to the browser's text undo.
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();else store.undo();
        return;
      }
      if (selected.length === 0) return;
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        requestRemove(selected);
      } else if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        store.sealHistory();
        store.run(c => duplicateBlocks(c, selected));
      } else if (event.key === 'Tab') {
        event.preventDefault();
        store.sealHistory();
        store.run(c => event.shiftKey ? outdentBlocks(c, selected) : indentBlocks(c, selected));
      } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !mod) {
        event.preventDefault();
        stepBlockSelection(store, ui, event.key === 'ArrowUp' ? 'up' : 'down', event.shiftKey);
      } else if (event.key === 'Escape') {
        clearBlockSelection(ui);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const first = selected[0];
        clearBlockSelection(ui);
        if (first && store.doc.blocks[first]?.text) {
          store.setSelection({
            kind: 'text',
            blockId: first,
            start: 0,
            end: 0
          });
        }
      }
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [readOnly, requestRemove, store, ui]);

  // Selecting blocks with the pointer (web): Shift-click extends a selection
  // to the block clicked (from the selected blocks, or from the block being
  // edited); dragging out of one block's text into another selects the
  // blocks between them, as Notion does.
  const root = useRef(null);
  useEffect(() => {
    const node = root.current;
    if (Platform.OS !== 'web' || readOnly || !node?.addEventListener) return;
    const blockAt = target => blockElementAt(target, domIdPrefix, id => store.doc.blocks[id] !== undefined)?.id ?? null;
    const inGutter = target => Boolean(target?.closest?.(`[id^="${GUTTER_DOM_PREFIX}"]`));
    let drag = null;
    let suppressMouseDown = false;
    const endDrag = () => {
      if (drag?.selecting) node.style.userSelect = '';
      drag = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
    const onMove = event => {
      if (!drag || event.buttons === 0) {
        endDrag();
        return;
      }
      if (ui.get().drag) return;
      const over = blockAt(document.elementFromPoint(event.clientX, event.clientY));
      if (!over) return;
      if (!drag.selecting) {
        if (over === drag.from) return;
        // Out of the block the drag began in: whole blocks from here on.
        drag.selecting = true;
        node.style.userSelect = 'none';
        const focused = ui.get().focused;
        if (focused) controller.inputs.get(focused)?.blur();
      }
      window.getSelection?.()?.removeAllRanges();
      selectBlocks(ui, blockRange(store.doc, store.schema, drag.from, over), drag.from, over);
    };
    const onPointerDown = event => {
      if (event.button !== 0 || inGutter(event.target)) return;
      const id = blockAt(event.target);
      if (!id) {
        clearBlockSelection(ui);
        return;
      }
      const state = ui.get();
      const fromElsewhere = state.selectedBlocks.length > 0 || state.focused !== null && state.focused !== id;
      if (event.shiftKey && fromElsewhere) {
        // Not a click into the text: its mousedown (which would focus it and
        // place a caret) is cancelled below.
        suppressMouseDown = true;
        if (extendBlockSelection(store, ui, id) && state.focused) {
          controller.inputs.get(state.focused)?.blur();
        }
        return;
      }
      clearBlockSelection(ui);
      if (!event.target.closest?.('[contenteditable="true"]')) return;
      drag = {
        from: id,
        selecting: false
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
    };
    const onMouseDown = event => {
      if (!suppressMouseDown) return;
      suppressMouseDown = false;
      // Neither the browser nor the editing surface below acts on it.
      event.preventDefault();
      event.stopPropagation();
    };
    node.addEventListener('pointerdown', onPointerDown, true);
    node.addEventListener('mousedown', onMouseDown, true);
    return () => {
      endDrag();
      node.removeEventListener('pointerdown', onPointerDown, true);
      node.removeEventListener('mousedown', onMouseDown, true);
    };
  }, [controller, domIdPrefix, readOnly, store, ui]);

  // Copying and cutting selected blocks (web): as Markdown, which pasting
  // turns back into blocks — in this editor or any other.
  useEffect(() => {
    const node = root.current;
    if (Platform.OS !== 'web' || !node?.addEventListener) return;
    // A whole-block selection has its own keyboard focus, just as text has
    // its input. This also gives browser copy/cut events a concrete owner.
    let previous = ui.get().selectedBlocks;
    const focusSelection = () => {
      const selected = ui.get().selectedBlocks;
      if (selected === previous) return;
      previous = selected;
      if (selected.length > 0) node.focus({
        preventScroll: true
      });
    };
    if (previous.length > 0) node.focus({
      preventScroll: true
    });
    const stop = ui.subscribe(focusSelection);
    return () => {
      stop();
    };
  }, [ui]);
  useEffect(() => {
    const node = root.current;
    if (Platform.OS !== 'web' || !node?.addEventListener) return;
    const onCopy = cut => event => {
      const target = event.target;
      // A nested editor or a field in a custom renderer owns its own text.
      // Retained selections in other editors never intercept this event.
      if (event.defaultPrevented || target?.closest?.('[data-bloom-editor-surface]') !== node || target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])') || node.ownerDocument.activeElement !== node) return;
      const selected = ui.get().selectedBlocks;
      if (selected.length === 0) return;
      // Own this operation even on failure: the browser must not perform a
      // fallback Cut after we declined to remove the selected blocks.
      event.preventDefault();
      const ids = selected.filter(id => !selected.includes(store.doc.blocks[id]?.parent ?? ''));
      const copiedDocument = store.doc;
      try {
        const snapshot = exportSnapshot(copiedDocument, ids);
        const text = snapshotToMarkdown(snapshot);
        if (cut && !canCutAsMarkdown(snapshot, text, store.schema)) {
          onClipboardError?.('unsupported-cut');
          return;
        }
        if (!event.clipboardData) throw new Error('Clipboard unavailable');
        event.clipboardData.setData('text/plain', text);
        if (event.clipboardData.getData('text/plain') !== text) throw new Error('Clipboard write not confirmed');
      } catch {
        onClipboardError?.('write-failed');
        return;
      }
      if (cut) requestRemove(ids, () => {
        const current = cutSourceMatches(copiedDocument, store.doc, ids);
        if (!current) onClipboardError?.('changed-cut');
        return current;
      });
    };
    const copy = onCopy(false);
    const cut = onCopy(true);
    node.addEventListener('copy', copy);
    node.addEventListener('cut', cut);
    return () => {
      node.removeEventListener('copy', copy);
      node.removeEventListener('cut', cut);
    };
  }, [onClipboardError, requestRemove, store, ui]);
  return /*#__PURE__*/_jsx(EditorContext.Provider, {
    value: value,
    children: /*#__PURE__*/_jsxs(View, {
      ref: root,
      ...(Platform.OS === 'web' ? {
        tabIndex: -1,
        dataSet: {
          bloomEditorSurface: ''
        }
      } : {}),
      style: [styles.editor, style],
      children: [children, /*#__PURE__*/_jsx(BlockMenu, {}), /*#__PURE__*/_jsx(CodeLanguageMenu, {})]
    })
  });
}
const styles = StyleSheet.create({
  editor: {
    position: 'relative'
  },
  tail: {
    minHeight: 96
  }
});
//# sourceMappingURL=BlockEditor.js.map