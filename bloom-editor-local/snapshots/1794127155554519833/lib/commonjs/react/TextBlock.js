"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TextBlock = TextBlock;
var _EditorPopover = require("./EditorPopover.js");
var _chatComposer = require("@oxy.so/bloom/chat-composer");
var _bloomText = require("@oxy.so/bloom-text");
var _react = require("react");
var _reactNative = require("react-native");
var _commands = require("../model/commands.js");
var _document = require("../model/document.js");
var _html = require("../model/html.js");
var _markdown = require("../model/markdown.js");
var _paste = require("../model/paste.js");
var _schema = require("../model/schema.js");
var _slash = require("../model/slash.js");
var _blockSelection = require("./block-selection.js");
var _context = require("./context.js");
var _decorations = require("./decorations.js");
var _FormatBar = require("./FormatBar.js");
var _InlinePopover = require("./InlinePopover.js");
var _inlineTarget = require("./inline-target.js");
var _MentionMenu = require("./MentionMenu.js");
var _RangeMarks = require("./RangeMarks.js");
var _RunsText = require("./RunsText.js");
var _SlashMenu = require("./SlashMenu.js");
var _uiStore = require("./ui-store.js");
var _textRuns = require("./text-runs.js");
var _typography = require("./typography.js");
var _jsxRuntime = require("react/jsx-runtime");
const caret = (blockId, offset) => ({
  kind: 'text',
  blockId,
  start: offset,
  end: offset
});
function TextBlock({
  block
}) {
  const {
    store,
    controller,
    ui,
    theme,
    labels,
    inputs,
    readOnly,
    slashItems,
    onSlashAction,
    mentions,
    onPasteImages,
    codeLanguages,
    highlightCode,
    inlineEquations,
    decorations,
    onPasteText
  } = (0, _context.useEditorContext)();
  const id = block.id;
  const hostRef = (0, _react.useRef)(null);
  const inputHostRef = (0, _react.useRef)(null);
  const spec = (0, _schema.specOf)(store.schema, block.type);
  const inputRef = (0, _react.useRef)(null);
  const selectionRef = (0, _react.useRef)({
    start: 0,
    end: 0
  });
  const focusedRef = (0, _react.useRef)(false);
  const shiftEnterRef = (0, _react.useRef)(false);
  const [focused, setFocused] = (0, _react.useState)(false);
  const [dismissedRange, setDismissedRange] = (0, _react.useState)(null);
  (0, _react.useEffect)(() => {
    if (!focused || _reactNative.Platform.OS !== 'web') return;
    const outside = event => {
      const host = hostRef.current;
      if (host?.contains(event.target) || controller.ownsControlFocus(event.target)) return;
      setFocused(false);
      if (ui.get().focused === id) ui.set({
        focused: null
      });
      controller.cancelLinkEditor();
    };
    document.addEventListener('focusin', outside);
    return () => document.removeEventListener('focusin', outside);
  }, [focused, controller, ui, id]);
  const suggestionId = `bloom-editor-suggestions-${(0, _react.useId)().replace(/:/g, '')}`;
  const access = (0, _react.useRef)(null);
  const mentionSearch = (0, _react.useRef)(0);
  (0, _react.useLayoutEffect)(() => {
    access.current = {
      store,
      readOnly
    };
    if (readOnly) {
      mentionSearch.current += 1;
      if (ui.get().slash?.blockId === id) ui.set({
        slash: null
      });
      if (ui.get().mention?.blockId === id) ui.set({
        mention: null
      });
    }
    return () => {
      access.current = null;
      mentionSearch.current += 1;
      if (ui.get().slash?.blockId === id) ui.set({
        slash: null
      });
      if (ui.get().mention?.blockId === id) ui.set({
        mention: null
      });
    };
  }, [id, readOnly, store, ui]);
  const canEdit = (0, _react.useCallback)(() => access.current?.store === store && !access.current.readOnly && Boolean(store.doc.blocks[id]), [id, store]);
  const suggestionAnchor = (0, _react.useMemo)(() => ({
    contextRef: inputHostRef,
    getRect: () => {
      const host = inputHostRef.current;
      const box = host?.getBoundingClientRect?.();
      if (!box) return null;
      const offset = selectionRef.current.start;
      const rect = inputRef.current?.measureRanges([{
        start: offset,
        end: offset
      }])?.[0]?.[0];
      return rect ? {
        left: box.left + rect.x,
        right: box.left + rect.x + rect.width,
        top: box.top + rect.y,
        bottom: box.top + rect.y + rect.height
      } : box;
    }
  }), []);

  // Register this block's input for focus moves and formatting commands.
  (0, _react.useEffect)(() => {
    const handle = inputRef.current;
    if (handle) inputs.set(id, handle);
    return () => {
      inputs.delete(id);
    };
  }, [id, inputs]);

  // Follow the store's selection when it points into this block and the
  // input is not already there (a command moved the caret here).
  const target = (0, _react.useSyncExternalStore)(store.subscribe, () => {
    const sel = store.selection;
    return sel?.kind === 'text' && sel.blockId === id ? sel : null;
  });
  /** Focus as the input itself sees it; its focus event can be missed after a remount. */
  const hasFocus = (0, _react.useCallback)(() => focusedRef.current || inputRef.current?.isFocused() === true, []);

  // The selection a command asked for, applied once — never re-applied
  // later, so it cannot overwrite a caret the user has moved since.
  (0, _react.useLayoutEffect)(() => {
    if (!target || readOnly) return;
    const local = selectionRef.current;
    if (hasFocus() && local.start === target.start && local.end === target.end) return;
    const wanted = {
      start: target.start,
      end: target.end
    };
    selectionRef.current = wanted;
    let frame = 0;
    let cancelled = false;
    // A block created by this same edit may not have its editing surface
    // mounted yet: ask for focus on the next frames until it lands, then
    // place the caret.
    const attempt = tries => {
      // The user moved the caret since: their selection wins.
      if (cancelled || selectionRef.current !== wanted) return;
      if (!hasFocus()) inputRef.current?.focus();
      if (hasFocus()) {
        focusedRef.current = true;
        inputRef.current?.setSelection(wanted.start, wanted.end);
        return;
      }
      if (tries < 10) frame = requestAnimationFrame(() => attempt(tries + 1));
    };
    attempt(0);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [target, readOnly, hasFocus]);
  const run = (0, _react.useCallback)(command => store.run(command), [store]);
  const runSlashItem = (0, _react.useCallback)(item => {
    const slash = ui.get().slash;
    if (!canEdit() || slash?.blockId !== id) return;
    ui.set({
      slash: null
    });
    const current = (0, _document.getBlock)(store.doc, id);
    const text = (0, _bloomText.segmentsToPlainText)(current.text ?? []);
    // A remote edit may have replaced the query without moving our caret.
    // Never delete unrelated text using offsets from an obsolete popup.
    if ((0, _slash.slashQuery)(text, slash.slashAt, slash.slashAt + 1 + slash.query.length) !== slash.query) return;
    const end = Math.min(text.length, slash.slashAt + 1 + slash.query.length);
    const removeQuery = c => (0, _commands.applyEdit)(c, id, {
      index: slash.slashAt,
      deleteCount: end - slash.slashAt,
      insert: ''
    });
    const emptyAfter = text.length - (end - slash.slashAt) === 0;
    if (item.action.kind === 'block') {
      const {
        type,
        props
      } = item.action;
      store.sealHistory();
      run(c => (0, _commands.composeCommands)(c, [removeQuery, emptyAfter ? cc => (0, _commands.turnInto)(cc, id, type, props ?? {}) : cc => (0, _commands.insertBlockAfter)(cc, id, type, props ? {
        props
      } : {})]));
    } else {
      run(removeQuery);
      onSlashAction?.(item.action.id, id);
    }
  }, [canEdit, id, onSlashAction, run, store, ui]);
  const onChange = (0, _react.useCallback)(({
    segments,
    edit
  }) => {
    if (!canEdit()) return;
    const ctx = store.context();
    const current = (0, _document.getBlock)(ctx.doc, id);
    const text = (0, _bloomText.segmentsToPlainText)(segments);
    if (edit && edit.deleteCount === 0) {
      const at = (0, _slash.slashTriggerAt)(text, edit.index, edit.insert);
      if (at !== null) ui.set({
        mention: null,
        slash: {
          blockId: id,
          slashAt: at,
          query: '',
          highlighted: 0
        }
      });
    }
    const slash = ui.get().slash;
    if (slash?.blockId === id && edit) {
      const query = (0, _slash.slashQuery)(text, slash.slashAt, edit.index + edit.insert.length);
      ui.set({
        slash: query === null ? null : {
          ...slash,
          query,
          highlighted: query === slash.query ? slash.highlighted : 0
        }
      });
    }

    // Line breaks pasted into a one-line block: a block per line (Notion).
    if (edit?.insert.includes('\n')) {
      const pasted = (0, _paste.pasteIntoBlock)(ctx, id, segments, edit);
      if (pasted) {
        store.sealHistory();
        store.dispatch(pasted);
        store.sealHistory();
        return;
      }
    }
    const shortcut = (0, _markdown.detectBlockShortcut)(current.type, text, edit);
    if (shortcut) {
      store.sealHistory();
      store.dispatch((0, _commands.composeCommands)(ctx, [c => (0, _commands.editText)(c, id, segments), c => (0, _markdown.applyBlockShortcut)(c, id, shortcut)]));
      return;
    }
    const inline = (0, _markdown.applyInlineShortcut)(segments, edit) ?? (inlineEquations && !spec.multiline ? (0, _markdown.applyInlineEquation)(segments, edit, inlineEquations.indicator) : null);
    if (inline) {
      store.dispatch((0, _commands.composeCommands)(ctx, [c => (0, _commands.editText)(c, id, segments), c => (0, _commands.editText)(c, id, inline.segments, caret(id, inline.caret))]));
      return;
    }
    store.dispatch((0, _commands.editText)(ctx, id, segments));
  }, [canEdit, id, inlineEquations, spec.multiline, store, ui]);

  // Web: HTML pasted from a page or another editor becomes blocks. A paste
  // that says no more than its plain text is left to the input, whose lines
  // (and their Markdown prefixes) make blocks in `onChange`; code takes
  // plain text.
  const onPaste = (0, _react.useCallback)(({
    html,
    text
  }) => {
    if (readOnly) return false;
    // The app's first: a link it unfurls, a page it recognises.
    if (onPasteText?.({
      text,
      ...(html ? {
        html
      } : {}),
      blockId: id
    })) return true;
    if (!html) return false;
    const current = store.doc.blocks[id];
    if (!current || (0, _schema.specOf)(store.schema, current.type).multiline) return false;
    const snapshot = (0, _html.htmlToSnapshot)(html, {
      schema: store.schema
    });
    if (snapshot.length === 0 || (0, _html.isPlainSnapshot)(snapshot)) return false;
    const {
      start,
      end
    } = selectionRef.current;
    store.sealHistory();
    const pasted = store.run(c => (0, _paste.pasteSnapshot)(c, id, start, end, snapshot));
    store.sealHistory();
    return pasted;
  }, [id, onPasteText, readOnly, store]);
  const onSelectionChange = (0, _react.useCallback)(selection => {
    selectionRef.current = selection;
    // Inputs report selection changes without focus too (loading content,
    // applying a remote edit); only the focused one speaks for the caret.
    if (!hasFocus()) return;
    store.setSelection({
      kind: 'text',
      blockId: id,
      start: selection.start,
      end: selection.end
    });
    const slash = ui.get().slash;
    if (slash && slash.blockId === id) {
      const current = store.doc.blocks[id];
      if (!current) return;
      const text = (0, _bloomText.segmentsToPlainText)(current.text ?? []);
      const query = selection.start === selection.end ? (0, _slash.slashQuery)(text, slash.slashAt, selection.start) : null;
      if (query === null) ui.set({
        slash: null
      });else if (query !== slash.query) ui.set({
        slash: {
          ...slash,
          query,
          highlighted: 0
        }
      });
    }
  }, [hasFocus, id, store, ui]);
  const focusBlock = (0, _react.useCallback)((targetId, atEnd) => {
    if (!targetId) return false;
    const target = (0, _document.getBlock)(store.doc, targetId);
    const offset = atEnd ? (0, _bloomText.segmentsToPlainText)(target.text ?? []).length : 0;
    store.sealHistory();
    store.setSelection(caret(targetId, offset));
    return true;
  }, [store]);

  // Each lookup gets a number; only the latest one's answer is shown.
  const onMentionQuery = (0, _react.useCallback)(query => {
    const seq = ++mentionSearch.current;
    if (!query || !mentions || !canEdit()) {
      if (ui.get().mention?.blockId === id) ui.set({
        mention: null
      });
      return;
    }
    const current = ui.get().mention;
    ui.set({
      slash: null,
      mention: {
        blockId: id,
        indicator: query.indicator,
        text: query.text,
        highlighted: 0,
        items: current?.blockId === id ? current.items : [],
        loading: true
      }
    });
    mentions.search(query).then(items => {
      const open = ui.get().mention;
      if (!canEdit() || seq !== mentionSearch.current || open?.blockId !== id) return;
      ui.set({
        mention: {
          ...open,
          items,
          loading: false,
          highlighted: 0
        }
      });
    }, () => {
      const open = ui.get().mention;
      if (!canEdit() || seq !== mentionSearch.current || open?.blockId !== id) return;
      ui.set({
        mention: {
          ...open,
          items: [],
          loading: false
        }
      });
    });
  }, [canEdit, id, mentions, ui]);
  const chooseMention = (0, _react.useCallback)(item => {
    const open = ui.get().mention;
    if (!canEdit() || open?.blockId !== id || open.loading) return;
    ui.set({
      mention: null
    });
    inputRef.current?.insertMention(open.indicator, item.label, {
      ...item.attributes
    });
  }, [canEdit, id, ui]);
  const onKeyCommand = (0, _react.useCallback)(key => {
    if (!canEdit()) return false;
    const mention = ui.get().mention;
    if (mention && mention.blockId === id) {
      const count = Math.max(mention.items.length, 1);
      if (key.key === 'ArrowDown' || key.key === 'ArrowUp') {
        const step = key.key === 'ArrowDown' ? 1 : -1;
        ui.set({
          mention: {
            ...mention,
            highlighted: (mention.highlighted + step + count) % count
          }
        });
        return true;
      }
      if (key.key === 'Escape') {
        ui.set({
          mention: null
        });
        return true;
      }
      if (key.key === 'Enter' || key.key === 'Tab') {
        const item = mention.loading ? undefined : mention.items[mention.highlighted];
        if (item) chooseMention(item);else ui.set({
          mention: null
        });
        return true;
      }
    }
    const slash = ui.get().slash;
    if (slash && slash.blockId === id) {
      const matches = (0, _slash.filterSlashItems)(slashItems, slash.query);
      if (key.key === 'ArrowDown' || key.key === 'ArrowUp') {
        const step = key.key === 'ArrowDown' ? 1 : -1;
        const count = Math.max(matches.length, 1);
        ui.set({
          slash: {
            ...slash,
            highlighted: (slash.highlighted + step + count) % count
          }
        });
        return true;
      }
      if (key.key === 'Escape') {
        ui.set({
          slash: null
        });
        return true;
      }
      if (key.key === 'Enter' || key.key === 'Tab') {
        const item = matches[slash.highlighted];
        if (item) runSlashItem(item);else ui.set({
          slash: null
        });
        return true;
      }
    }
    const sel = selectionRef.current;
    const collapsed = sel.start === sel.end;
    const length = (0, _bloomText.segmentsToPlainText)((0, _document.getBlock)(store.doc, id).text ?? []).length;
    const ctxSel = caret(id, sel.start);
    if (key.mod && (key.key === 'z' || key.key === 'Z')) {
      if (key.shift) store.redo();else store.undo();
      return true;
    }
    if (key.mod && key.key === 'y') {
      store.redo();
      return true;
    }
    if (key.mod && !key.shift && (key.key === 'k' || key.key === 'K')) {
      // The link field, for the selection or the link the caret is in.
      controller.openLinkEditor();
      return true;
    }
    if (key.key === 'Enter' && key.shift) {
      // Soft line break; `onSubmit` reads this flag.
      shiftEnterRef.current = true;
      return false;
    }
    if (key.key === 'Tab') {
      store.sealHistory();
      run(c => key.shift ? (0, _commands.outdent)(c, id, ctxSel) : (0, _commands.indent)(c, id, ctxSel));
      return true;
    }
    if (key.key === 'Backspace' && collapsed && sel.start === 0 && !key.mod) {
      store.sealHistory();
      return run(c => (0, _commands.backspaceAtStart)(c, id));
    }
    if (key.key === 'Delete' && collapsed && sel.start === length) {
      store.sealHistory();
      return run(c => (0, _commands.deleteAtEnd)(c, id));
    }
    if (key.key === 'ArrowUp' && collapsed && sel.start === 0 && !key.mod) {
      return focusBlock((0, _commands.previousTextBlock)(store.context(), id), true);
    }
    if (key.key === 'ArrowDown' && collapsed && sel.start === length && !key.mod) {
      return focusBlock((0, _commands.nextTextBlock)(store.context(), id), false);
    }
    if (key.mod && key.shift && (key.key === 'ArrowUp' || key.key === 'ArrowDown')) {
      const {
        parent,
        index
      } = (0, _document.positionOf)(store.doc, id);
      const siblings = (0, _document.childrenOf)(store.doc, parent);
      const neighbour = siblings[key.key === 'ArrowUp' ? index - 1 : index + 1];
      if (!neighbour) return true;
      store.sealHistory();
      run(c => {
        const tx = (0, _commands.moveBlocks)(c, [id], neighbour, key.key === 'ArrowUp' ? 'before' : 'after');
        return tx ? {
          ...tx,
          selectionAfter: ctxSel
        } : null;
      });
      return true;
    }
    if (key.mod && (key.key === 'd' || key.key === 'D')) {
      store.sealHistory();
      run(c => (0, _commands.duplicateBlocks)(c, [id]));
      return true;
    }
    if (key.key === 'Escape') {
      inputRef.current?.blur();
      // A table cell selects its table: a cell on its own is not a block.
      let selected = id;
      while ((0, _schema.isStructural)(store.schema, (0, _document.getBlock)(store.doc, selected).type)) {
        const parent = (0, _document.getBlock)(store.doc, selected).parent;
        if (parent === null) break;
        selected = parent;
      }
      (0, _blockSelection.selectBlocks)(ui, [selected]);
      return true;
    }
    return false;
  }, [canEdit, chooseMention, controller, focusBlock, id, run, runSlashItem, slashItems, store, ui]);
  const onSubmit = (0, _react.useCallback)(() => {
    if (!canEdit()) return;
    const mention = ui.get().mention;
    if (mention && mention.blockId === id) {
      const item = mention.loading ? undefined : mention.items[mention.highlighted];
      if (item) chooseMention(item);else ui.set({
        mention: null
      });
      return;
    }
    const slash = ui.get().slash;
    if (slash && slash.blockId === id) {
      const item = (0, _slash.filterSlashItems)(slashItems, slash.query)[slash.highlighted];
      if (item) runSlashItem(item);else ui.set({
        slash: null
      });
      return;
    }
    const sel = selectionRef.current;
    store.sealHistory();
    if (shiftEnterRef.current) {
      shiftEnterRef.current = false;
      run(c => (0, _commands.applyEdit)(c, id, {
        index: sel.start,
        deleteCount: sel.end - sel.start,
        insert: '\n'
      }));
      return;
    }
    run(c => (0, _commands.composeCommands)(c, [cc => sel.end > sel.start ? (0, _commands.applyEdit)(cc, id, {
      index: sel.start,
      deleteCount: sel.end - sel.start,
      insert: ''
    }) : null, cc => (0, _commands.splitBlock)(cc, id, sel.start)]));
  }, [canEdit, chooseMention, id, run, runSlashItem, slashItems, store, ui]);

  // The input reports its marks whenever they change, focused or not (a link
  // set while the link field has the keyboard): the block the selection is in
  // speaks for the toolbar, and says again what it last had when focused.
  const marksRef = (0, _react.useRef)(null);
  const onActiveMarksChange = (0, _react.useCallback)(marks => {
    marksRef.current = marks;
    if (controller.textSelection?.blockId === id) ui.set({
      marks: {
        blockId: id,
        marks
      }
    });
  }, [controller, id, ui]);

  // The link or mention at the caret, for its popover.
  const inlineKey = (0, _react.useSyncExternalStore)(store.subscribe, () => {
    const sel = store.selection;
    if (sel?.kind !== 'text' || sel.blockId !== id || sel.start !== sel.end) return null;
    const found = (0, _inlineTarget.inlineTargetAt)(store.doc.blocks[id]?.text ?? [], sel.start);
    return found ? `${found.start}:${found.end}` : null;
  });
  const inlineTarget = (0, _react.useMemo)(() => {
    if (!inlineKey) return null;
    const sel = store.selection;
    return sel?.kind === 'text' ? (0, _inlineTarget.inlineTargetAt)(block.text ?? [], sel.start) : null;
  }, [inlineKey, block.text, store]);
  const slashState = (0, _uiStore.useUi)(ui, s => s.slash?.blockId === id ? s.slash : null);
  const mentionState = (0, _uiStore.useUi)(ui, s => s.mention?.blockId === id ? s.mention : null);
  const slashOpen = !readOnly && (slashState !== null || mentionState !== null);
  const activeSuggestion = mentionState ? !mentionState.loading && mentionState.items[mentionState.highlighted] : slashState ? (0, _slash.filterSlashItems)(slashItems, slashState.query)[slashState.highlighted] : undefined;
  const activeSuggestionId = activeSuggestion ? (0, _chatComposer.suggestionOptionId)(suggestionId, mentionState ? (0, _MentionMenu.mentionSuggestionId)(activeSuggestion) : activeSuggestion.id) : undefined;

  // Web: the marks and link of a selection, over the block (touch devices
  // get `EditorToolbar` above the keyboard instead).
  const linking = (0, _uiStore.useUi)(ui, s => s.linking === id);
  const formatAnchor = (0, _react.useMemo)(() => ({
    getBoundingClientRect: () => {
      const host = inputHostRef.current;
      const box = host?.getBoundingClientRect?.();
      if (!box) return null;
      const rect = inputRef.current?.measureRanges([selectionRef.current])?.[0]?.[0];
      return rect ? {
        left: box.left + rect.x,
        right: box.left + rect.x + rect.width,
        top: box.top + rect.y,
        bottom: box.top + rect.y + rect.height
      } : box;
    }
  }), [target?.start, target?.end]);
  const rangeKey = target ? `${target.start}:${target.end}` : null;
  const showInline = Boolean(inlineTarget && focused && !slashOpen && !readOnly && rangeKey !== dismissedRange);
  const showBubble = _reactNative.Platform.OS === 'web' && !readOnly && (linking || focused && target !== null && target.start !== target.end && rangeKey !== dismissedRange);
  const placeholder = (0, _react.useMemo)(() => {
    if (block.type.startsWith('heading_')) return labels.emptyHeading;
    if (block.type === 'bulleted_list_item' || block.type === 'numbered_list_item' || block.type === 'todo') {
      return labels.emptyListItem;
    }
    if (block.type === 'toggle') return labels.emptyToggle;
    return focused ? labels.placeholder : undefined;
  }, [block.type, focused, labels]);
  const isEmpty = (block.text ?? []).every(segment => segment.text.length === 0);
  const textStyle = (0, _react.useMemo)(() => {
    const color = typeof block.props.color === 'string' ? theme.colors[block.props.color]?.text : undefined;
    const muted = block.type === 'todo' && block.props.checked === true;
    return {
      ...(0, _typography.textStyleFor)(block.type, theme),
      ...(color && {
        color
      }),
      ...(muted && {
        color: theme.textMuted
      }),
      linkColor: theme.accent,
      codeColor: theme.colors.red?.text ?? theme.text,
      codeBackgroundColor: theme.codeBackground,
      mentionColor: theme.accent
    };
  }, [block.props.checked, block.props.color, block.type, theme]);

  // While the block is not being edited, what its input cannot draw is drawn
  // over it: colours and highlights in its text, or highlighted code. The
  // input stays in place, unseen, and takes the press that starts editing.
  // The app's highlights and carets in the text: drawn with the runs while
  // the block is not being edited, and measured on the input while it is.
  const ranges = (0, _decorations.useBlockDecoration)(decorations, id)?.ranges;
  const hasRanges = ranges !== undefined && ranges.length > 0;
  const isCode = block.type === 'code';
  const language = typeof block.props.language === 'string' ? block.props.language : 'plain';
  const runs = (0, _react.useMemo)(() => {
    if (focused) return null;
    const text = block.text ?? [];
    if (isCode && highlightCode) {
      const code = (0, _bloomText.segmentsToPlainText)(text);
      const highlighted = code ? (0, _textRuns.codeRuns)(code, highlightCode(code, language)) : null;
      if (highlighted || !hasRanges) return highlighted;
    }
    return (0, _textRuns.hasValueOnlyMarks)(text) || hasRanges ? (0, _textRuns.segmentRuns)(text, theme, textStyle, _RunsText.MONO_FONT) : null;
  }, [focused, block.text, isCode, highlightCode, language, theme, textStyle, hasRanges]);
  const plainText = (0, _react.useMemo)(() => (0, _bloomText.segmentsToPlainText)(block.text ?? []), [block.text]);
  const measured = (0, _RangeMarks.useMeasuredMarks)(inputRef, hostRef, ranges, plainText, focused && hasRanges);
  const hovered = (0, _uiStore.useUi)(ui, s => s.hovered === block.id);
  const languageLabel = codeLanguages?.find(l => l.id === language)?.label ?? language;
  const showLanguage = isCode && codeLanguages !== undefined && codeLanguages.length > 0 && !readOnly && (
  // Touch has no hover, and a press that blurs the input must still land.
  _reactNative.Platform.OS !== 'web' || hovered || focused);
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.View, {
    ref: hostRef,
    children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_RangeMarks.MeasuredHighlights, {
      marks: measured
    }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
      ref: inputHostRef,
      style: runs ? styles.unseen : undefined,
      children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_bloomText.RichTextInput, {
        ref: inputRef,
        value: block.text ?? [],
        onChange: onChange,
        onSelectionChange: onSelectionChange,
        onKeyCommand: onKeyCommand,
        onActiveMarksChange: onActiveMarksChange,
        mentionIndicators: mentions ? [...mentions.indicators] : undefined,
        onMentionQuery: mentions ? onMentionQuery : undefined,
        onSubmit: spec.multiline ? undefined : onSubmit,
        onPaste: readOnly ? undefined : onPaste,
        onPasteImages: onPasteImages && !readOnly ? images => onPasteImages(images, id) : undefined,
        onFocus: () => {
          focusedRef.current = true;
          setFocused(true);
          (0, _blockSelection.clearBlockSelection)(ui);
          ui.set({
            focused: id,
            ...(ui.get().slash?.blockId !== id && {
              slash: null
            }),
            ...(ui.get().mention?.blockId !== id && {
              mention: null
            }),
            ...(marksRef.current && {
              marks: {
                blockId: id,
                marks: marksRef.current
              }
            })
          });
          // The input reports its caret before it reports focus; claim it now.
          const {
            start,
            end
          } = selectionRef.current;
          store.setSelection({
            kind: 'text',
            blockId: id,
            start,
            end
          });
        },
        onBlur: () => {
          focusedRef.current = false;
          const release = () => {
            if (_reactNative.Platform.OS === 'web' && controller.ownsControlFocus(document.activeElement)) return;
            setFocused(false);
            if (ui.get().focused === id) ui.set({
              focused: null
            });
          };
          if (_reactNative.Platform.OS === 'web') queueMicrotask(release);else release();
          // Native suggestion rows keep the keyboard through the shared
          // scroll owner's keyboardShouldPersistTaps. A real blur leaves
          // this input; web's portal distinguishes inside/outside focus.
          if (_reactNative.Platform.OS !== 'web') {
            if (ui.get().slash?.blockId === id) ui.set({
              slash: null
            });
            if (ui.get().mention?.blockId === id) ui.set({
              mention: null
            });
          }
          store.sealHistory();
        },
        editable: !readOnly,
        "aria-controls": slashOpen ? suggestionId : undefined,
        "aria-expanded": slashOpen ? true : undefined,
        "aria-autocomplete": slashOpen ? 'list' : undefined,
        "aria-activedescendant": slashOpen ? activeSuggestionId : undefined,
        textStyle: textStyle,
        style: isCode ? styles.codeInput : undefined,
        accessibilityLabel: placeholder,
        testID: `block-input-${id}`
      })
    }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_RangeMarks.MeasuredCarets, {
      marks: measured,
      textColor: theme.background
    }), runs ? /*#__PURE__*/(0, _jsxRuntime.jsx)(_RunsText.RunsText, {
      runs: runs,
      ranges: ranges,
      textStyle: textStyle,
      flagTextColor: theme.background,
      style: isCode ? styles.codeInput : undefined
    }) : null, showLanguage ? /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
      accessibilityRole: "button",
      accessibilityLabel: `${labels.codeLanguage}: ${languageLabel}`,
      onPress: () => ui.set({
        codeLanguageMenu: id
      }),
      style: ({
        pressed
      }) => [styles.language, pressed && {
        backgroundColor: theme.selection
      }],
      children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
        style: [styles.languageText, {
          color: theme.textMuted
        }],
        children: languageLabel
      })
    }) : null, placeholder && isEmpty ?
    /*#__PURE__*/
    // Drawn here rather than passed to the input: the input rebuilds its
    // editing surface whenever its placeholder changes, which would drop
    // the caret on every focus change and type change.
    (0, _jsxRuntime.jsx)(_reactNative.Text, {
      pointerEvents: "none",
      accessible: false,
      style: [styles.placeholder, textStyleToText(textStyle), {
        color: theme.textMuted
      }],
      numberOfLines: 1,
      children: placeholder
    }) : null, /*#__PURE__*/(0, _jsxRuntime.jsx)(_EditorPopover.EditorPopover, {
      open: showBubble || showInline,
      anchor: formatAnchor,
      controller: controller,
      label: labels.formatting,
      onDismiss: () => setDismissedRange(rangeKey),
      children: showBubble ? /*#__PURE__*/(0, _jsxRuntime.jsx)(_FormatBar.FormatBar, {
        controller: controller,
        theme: theme,
        labels: labels
      }) : inlineTarget ? /*#__PURE__*/(0, _jsxRuntime.jsx)(_InlinePopover.InlinePopover, {
        target: inlineTarget
      }) : null
    }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_SlashMenu.SlashMenu, {
      blockId: id,
      onChoose: runSlashItem,
      anchor: suggestionAnchor,
      listboxId: suggestionId
    }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_MentionMenu.MentionMenu, {
      blockId: id,
      onChoose: chooseMention,
      anchor: suggestionAnchor,
      listboxId: suggestionId
    })]
  });
}
function textStyleToText(style) {
  return {
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight
  };
}
const styles = _reactNative.StyleSheet.create({
  placeholder: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0
  },
  unseen: {
    opacity: 0
  },
  codeInput: {
    padding: 12
  },
  language: {
    position: 'absolute',
    top: 4,
    right: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  languageText: {
    fontSize: 12
  }
});
//# sourceMappingURL=TextBlock.js.map