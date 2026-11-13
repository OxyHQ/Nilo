"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.EditorController = void 0;
exports.normalizeLink = normalizeLink;
exports.useEditorController = useEditorController;
var _model = require("@oxy.so/bloom-text/model");
var _react = require("react");
var _commands = require("../model/commands.js");
var _document = require("../model/document.js");
var _inlineTarget = require("./inline-target.js");
var _uiStore = require("./ui-store.js");
/**
 * What an editor and the controls around it share: its transient UI state,
 * its live inputs and the formatting commands on the current selection. An app
 * that draws controls outside `BlockEditor` (a toolbar above the keyboard)
 * creates one with `useEditorController` and passes it to both.
 */
class EditorController {
  ui = new _uiStore.UiStore();
  inputs = new Map();
  controlHosts = new Set();
  ownsControlFocus(target) {
    return [...this.controlHosts].some(host => {
      const node = host;
      return typeof node?.contains === 'function' && node.contains(target);
    });
  }
  editable = true;
  linkSession = null;

  /** A link draft is cancelled, never retargeted, when its context changes. */
  validateLinkSession() {
    const session = this.linkSession;
    const selection = this.textSelection;
    if (!session) return false;
    const block = this.store.doc.blocks[session.blockId];
    if (!this.editable || !block || !selection || selection.blockId !== session.blockId || selection.start !== session.start || selection.end !== session.end || JSON.stringify(block.text ?? []) !== session.text) {
      this.cancelLinkEditor();
      return false;
    }
    return true;
  }
  setEditable(editable) {
    this.editable = editable;
    if (!editable) this.cancelLinkEditor();
  }
  cancelLinkEditor() {
    this.linkSession = null;
    if (this.ui.get().linking !== null) this.ui.set({
      linking: null
    });
  }

  /** Apply only to the session opened by openLinkEditor, never a fresh range. */
  applyLinkDraft(url) {
    if (!this.validateLinkSession()) return false;
    if (!this.setLink(url)) return false;
    this.cancelLinkEditor();
    return true;
  }
  constructor(store) {
    this.store = store;
  }

  /** The caret or range in a block's text, the one formatting acts on. */
  get textSelection() {
    const selection = this.store.selection;
    return selection?.kind === 'text' && this.store.doc.blocks[selection.blockId] ? selection : null;
  }
  toggleMark(mark) {
    const selection = this.textSelection;
    if (selection) this.inputs.get(selection.blockId)?.toggleMark(mark);
  }

  /** Link the selected text to `url`; false when nothing is selected or the URL is unsafe. */
  setLink(url) {
    const selection = this.textSelection;
    const href = normalizeLink(url);
    if (!this.editable || !selection || selection.start === selection.end || !href) return false;
    const block = (0, _document.getBlock)(this.store.doc, selection.blockId);
    const text = (0, _model.segmentsToPlainText)(block.text ?? []).slice(selection.start, selection.end);
    const input = this.inputs.get(selection.blockId);
    if (!input) return false;
    this.store.sealHistory();
    input.setLink(selection.start, selection.end, text, href);
    this.store.sealHistory();
    return true;
  }

  /** Remove the link under the selection, or the whole link the caret is in. */
  removeLink() {
    const selection = this.textSelection;
    if (!selection) return;
    let range = selection;
    if (selection.start === selection.end) {
      const target = (0, _inlineTarget.inlineTargetAt)((0, _document.getBlock)(this.store.doc, selection.blockId).text ?? [], selection.start);
      range = target?.kind === 'link' ? target : null;
    }
    if (range) this.inputs.get(selection.blockId)?.removeLink(range.start, range.end);
  }

  /**
   * Start a mention at the caret, as typing the indicator would: a mention
   * opens at the start or after a space, so one is added after a word. An
   * edit like any other — each platform's input picks the mention up from the
   * text (their own `startMention` differs: only iOS adds the space).
   */
  startMention(indicator) {
    const selection = this.textSelection;
    if (!selection) return;
    const text = (0, _model.segmentsToPlainText)((0, _document.getBlock)(this.store.doc, selection.blockId).text ?? []);
    const before = text[selection.start - 1];
    const space = before !== undefined && !/\s/.test(before) ? ' ' : '';
    this.store.sealHistory();
    this.store.run(c => (0, _commands.applyEdit)(c, selection.blockId, {
      index: selection.start,
      deleteCount: selection.end - selection.start,
      insert: `${space}${indicator}`
    }));
  }

  /**
   * Colour the selected text (`'default'` clears it): the text colour, or the
   * highlight behind it with `background`. False when no text is selected.
   */
  setTextColor(name, kind = 'color') {
    const selection = this.textSelection;
    if (!selection || selection.start === selection.end) return false;
    this.store.sealHistory();
    return this.store.run(c => (0, _commands.formatText)(c, selection.blockId, selection.start, selection.end, {
      [kind]: name === 'default' ? null : name
    }));
  }

  /** The text colour and highlight where the selected text starts. */
  textColors() {
    const selection = this.textSelection;
    if (!selection || selection.start === selection.end) return {};
    const text = (0, _document.getBlock)(this.store.doc, selection.blockId).text ?? [];
    const [, rest] = (0, _model.splitSegmentsAt)(text, selection.start);
    const first = rest[0];
    return {
      ...(first?.color && {
        color: first.color
      }),
      ...(first?.background && {
        background: first.background
      })
    };
  }

  /** The link the selection is in or starts in, for the link field to show. */
  linkAtSelection() {
    const selection = this.textSelection;
    if (!selection) return null;
    const text = (0, _document.getBlock)(this.store.doc, selection.blockId).text ?? [];
    const target = (0, _inlineTarget.inlineTargetAt)(text, selection.start + (selection.start === selection.end ? 0 : 1));
    return target?.kind === 'link' ? target.href : null;
  }

  /**
   * Open the link field (⌘K): for the selected text, or — at a caret inside a
   * link — for that whole link. False when there is nothing to link.
   */
  openLinkEditor() {
    if (!this.editable) return false;
    const selection = this.textSelection;
    if (!selection) return false;
    if (selection.start === selection.end) {
      const target = (0, _inlineTarget.inlineTargetAt)((0, _document.getBlock)(this.store.doc, selection.blockId).text ?? [], selection.start);
      if (target?.kind !== 'link') return false;
      this.store.setSelection({
        ...selection,
        start: target.start,
        end: target.end
      });
      this.inputs.get(selection.blockId)?.setSelection(target.start, target.end);
    }
    const target = this.textSelection;
    if (!target) return false;
    this.linkSession = {
      blockId: target.blockId,
      start: target.start,
      end: target.end,
      text: JSON.stringify((0, _document.getBlock)(this.store.doc, target.blockId).text ?? [])
    };
    this.ui.set({
      linking: selection.blockId
    });
    return true;
  }

  /**
   * Put a mention at the selection (an inline equation an app's slash item
   * inserts, a page picked elsewhere), replacing selected text.
   */
  insertMention(mention) {
    const selection = this.textSelection;
    if (!selection) return false;
    this.store.sealHistory();
    return this.store.run(c => (0, _commands.insertMention)(c, selection.blockId, selection.start, selection.end, mention));
  }

  /** Give the keyboard back to the selected block, with its selection. */
  refocus() {
    const selection = this.textSelection;
    const input = selection && this.inputs.get(selection.blockId);
    if (!selection || !input) return;
    input.focus();
    input.setSelection(selection.start, selection.end);
  }
}
exports.EditorController = EditorController;
function useEditorController(store) {
  return (0, _react.useMemo)(() => new EditorController(store), [store]);
}

/** A URL as typed (`example.com`) made a link, or null when it is not one we allow. */
function normalizeLink(raw) {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if ((0, _model.isSafeLink)(trimmed)) return trimmed;
  // A bare host and path: the web.
  if (/^[\w-]+(\.[\w-]+)+([/?#:]|$)/.test(trimmed)) {
    const withScheme = `https://${trimmed}`;
    return (0, _model.isSafeLink)(withScheme) ? withScheme : null;
  }
  return null;
}
//# sourceMappingURL=controller.js.map