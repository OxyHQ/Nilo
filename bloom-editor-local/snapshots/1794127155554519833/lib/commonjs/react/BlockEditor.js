"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.BlockEditor = BlockEditor;
exports.EditorSurface = EditorSurface;
var _react = require("react");
var _reactNative = require("react-native");
var _commands = require("../model/commands.js");
var _snapshot = require("../model/snapshot.js");
var _clipboard = require("../model/clipboard.js");
var _document = require("../model/document.js");
var _schema = require("../model/schema.js");
var _blockDom = require("./block-dom.js");
var _BlockMenu = require("./BlockMenu.js");
var _blockSelection = require("./block-selection.js");
var _CodeLanguageMenu = require("./CodeLanguageMenu.js");
var _confirmRemove = require("./confirm-remove.js");
var _controller = require("./controller.js");
var _BlockRow = require("./BlockRow.js");
var _selection = require("../model/selection.js");
var _context = require("./context.js");
var _labels = require("./labels.js");
var _theme = require("./theme.js");
var _jsxRuntime = require("react/jsx-runtime");
const NONE = {};
const openWithLinking = href => {
  void _reactNative.Linking.openURL(href);
};
const NO_ACTIONS = [];
const NO_FORMAT_ACTIONS = [];

/**
 * A Notion-style block editor over an `EditorStore`, the document laid out
 * top to bottom. Every edit goes through the store's commands; the app
 * persists by listening to its transactions.
 */
function BlockEditor(props) {
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(EditorSurface, {
    ...props,
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(DocumentBody, {})
  });
}

/** The document's blocks in order, and the space below them that adds one. */
function DocumentBody() {
  const {
    store,
    readOnly,
    labels
  } = (0, _context.useEditorContext)();
  const snapshot = (0, _context.useEditorSnapshot)(store);

  // Clicking below the last block focuses it when it is an empty paragraph,
  // otherwise adds one — as in Notion.
  const focusEnd = () => {
    if (readOnly) return;
    const last = snapshot.doc.root[snapshot.doc.root.length - 1];
    if (last) {
      const block = (0, _document.getBlock)(snapshot.doc, last);
      const isEmptyParagraph = block.type === 'paragraph' && block.children.length === 0 && (block.text ?? []).every(s => !s.text);
      if (isEmptyParagraph && (0, _schema.specOf)(store.schema, block.type).hasText) {
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
    store.run(c => (0, _commands.insertBlockAfter)(c, last ?? null, 'paragraph'));
  };
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_jsxRuntime.Fragment, {
    children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_BlockRow.BlockList, {
      ids: snapshot.doc.root,
      depth: 0
    }), !readOnly ? /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
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
function EditorSurface({
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
  domIdPrefix = _blockDom.BLOCK_DOM_PREFIX,
  theme = _theme.DEFAULT_THEME,
  labels,
  readOnly = false,
  controller: given,
  style,
  children
}) {
  const own = (0, _controller.useEditorController)(store);
  const controller = given ?? own;
  const {
    ui,
    inputs
  } = controller;
  (0, _react.useLayoutEffect)(() => {
    controller.setEditable(!readOnly);
    const unsubscribe = store.subscribe(() => controller.validateLinkSession());
    return () => {
      unsubscribe();
      controller.setEditable(false);
    };
  }, [controller, store, readOnly]);
  const mergedLabels = (0, _react.useMemo)(() => ({
    ..._labels.DEFAULT_LABELS,
    ...labels
  }), [labels]);

  // The format bar is drawn inside the editor and in `EditorToolbar` outside
  // it: both read the actions from the controller's UI state.
  (0, _react.useEffect)(() => {
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
  const removalAccess = (0, _react.useRef)(null);
  (0, _react.useLayoutEffect)(() => {
    removalAccess.current = {
      store,
      readOnly
    };
    return () => {
      removalAccess.current = null;
    };
  }, [store, readOnly]);
  const confirming = (0, _react.useRef)(false);
  const requestRemove = (0, _react.useCallback)((ids, stillCurrent) => {
    if (readOnly || ids.length === 0 || confirming.current) return;
    const answer = (0, _confirmRemove.afterConfirm)(confirmRemove, ids, () => {
      const access = removalAccess.current;
      if (!access || access.store !== store || access.readOnly) return;
      if (stillCurrent && !stillCurrent()) return;
      const present = ids.filter(id => store.doc.blocks[id]);
      if (present.length === 0) return;
      (0, _blockSelection.clearBlockSelection)(ui);
      store.sealHistory();
      store.run(c => (0, _commands.removeBlocks)(c, present));
    });
    if (typeof answer !== 'boolean') {
      confirming.current = true;
      void answer.finally(() => {
        confirming.current = false;
      });
    }
  }, [confirmRemove, readOnly, store, ui]);
  const value = (0, _react.useMemo)(() => ({
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
  (0, _react.useEffect)(() => {
    const node = root.current;
    if (_reactNative.Platform.OS !== 'web' || readOnly || !node?.addEventListener) return;
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
        store.run(c => (0, _commands.duplicateBlocks)(c, selected));
      } else if (event.key === 'Tab') {
        event.preventDefault();
        store.sealHistory();
        store.run(c => event.shiftKey ? (0, _commands.outdentBlocks)(c, selected) : (0, _commands.indentBlocks)(c, selected));
      } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !mod) {
        event.preventDefault();
        (0, _blockSelection.stepBlockSelection)(store, ui, event.key === 'ArrowUp' ? 'up' : 'down', event.shiftKey);
      } else if (event.key === 'Escape') {
        (0, _blockSelection.clearBlockSelection)(ui);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const first = selected[0];
        (0, _blockSelection.clearBlockSelection)(ui);
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
  const root = (0, _react.useRef)(null);
  (0, _react.useEffect)(() => {
    const node = root.current;
    if (_reactNative.Platform.OS !== 'web' || readOnly || !node?.addEventListener) return;
    const blockAt = target => (0, _blockDom.blockElementAt)(target, domIdPrefix, id => store.doc.blocks[id] !== undefined)?.id ?? null;
    const inGutter = target => Boolean(target?.closest?.(`[id^="${_blockDom.GUTTER_DOM_PREFIX}"]`));
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
      (0, _blockSelection.selectBlocks)(ui, (0, _selection.blockRange)(store.doc, store.schema, drag.from, over), drag.from, over);
    };
    const onPointerDown = event => {
      if (event.button !== 0 || inGutter(event.target)) return;
      const id = blockAt(event.target);
      if (!id) {
        (0, _blockSelection.clearBlockSelection)(ui);
        return;
      }
      const state = ui.get();
      const fromElsewhere = state.selectedBlocks.length > 0 || state.focused !== null && state.focused !== id;
      if (event.shiftKey && fromElsewhere) {
        // Not a click into the text: its mousedown (which would focus it and
        // place a caret) is cancelled below.
        suppressMouseDown = true;
        if ((0, _blockSelection.extendBlockSelection)(store, ui, id) && state.focused) {
          controller.inputs.get(state.focused)?.blur();
        }
        return;
      }
      (0, _blockSelection.clearBlockSelection)(ui);
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
  (0, _react.useEffect)(() => {
    const node = root.current;
    if (_reactNative.Platform.OS !== 'web' || !node?.addEventListener) return;
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
  (0, _react.useEffect)(() => {
    const node = root.current;
    if (_reactNative.Platform.OS !== 'web' || !node?.addEventListener) return;
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
        const snapshot = (0, _snapshot.exportSnapshot)(copiedDocument, ids);
        const text = (0, _snapshot.snapshotToMarkdown)(snapshot);
        if (cut && !(0, _clipboard.canCutAsMarkdown)(snapshot, text, store.schema)) {
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
        const current = (0, _clipboard.cutSourceMatches)(copiedDocument, store.doc, ids);
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
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_context.EditorContext.Provider, {
    value: value,
    children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.View, {
      ref: root,
      ...(_reactNative.Platform.OS === 'web' ? {
        tabIndex: -1,
        dataSet: {
          bloomEditorSurface: ''
        }
      } : {}),
      style: [styles.editor, style],
      children: [children, /*#__PURE__*/(0, _jsxRuntime.jsx)(_BlockMenu.BlockMenu, {}), /*#__PURE__*/(0, _jsxRuntime.jsx)(_CodeLanguageMenu.CodeLanguageMenu, {})]
    })
  });
}
const styles = _reactNative.StyleSheet.create({
  editor: {
    position: 'relative'
  },
  tail: {
    minHeight: 96
  }
});
//# sourceMappingURL=BlockEditor.js.map