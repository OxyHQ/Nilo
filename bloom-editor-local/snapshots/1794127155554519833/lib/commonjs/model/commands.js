"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.appendChild = appendChild;
exports.applyEdit = applyEdit;
exports.backspaceAtStart = backspaceAtStart;
exports.canTurnInto = canTurnInto;
exports.cloneSubtree = cloneSubtree;
exports.composeCommands = composeCommands;
exports.deleteAtEnd = deleteAtEnd;
exports.duplicateBlocks = duplicateBlocks;
exports.editText = editText;
exports.formatText = formatText;
exports.indent = indent;
exports.indentBlocks = indentBlocks;
exports.insertBlockAfter = insertBlockAfter;
exports.insertMention = insertMention;
exports.moveBlocks = moveBlocks;
exports.nextTextBlock = nextTextBlock;
exports.outdent = outdent;
exports.outdentBlocks = outdentBlocks;
exports.previousTextBlock = previousTextBlock;
exports.removeBlocks = removeBlocks;
exports.setBlocksProps = setBlocksProps;
exports.setProps = setProps;
exports.splitBlock = splitBlock;
exports.turnInto = turnInto;
var _model = require("@oxy.so/bloom-text/model");
var _document = require("./document.js");
var _operations = require("./operations.js");
var _schema = require("./schema.js");
/**
 * Editing commands. Each reads the document and returns the transaction that
 * performs one user action — or null when the action does not apply — so the
 * keyboard, menus, AI and tests all edit through the same code.
 *
 * The behaviour follows Notion: Return splits and continues lists, an empty
 * list item leaves the list, Backspace at the start reverts a styled block to
 * a paragraph before merging, Tab nests under the previous sibling, and
 * Shift-Tab adopts the following siblings.
 */

const caret = (blockId, offset) => ({
  kind: 'text',
  blockId,
  start: offset,
  end: offset
});

/**
 * Builds a transaction against a working copy, so each operation is computed
 * from the state the previous ones produced.
 */
class Builder {
  ops = [];
  constructor(doc) {
    this.doc = doc;
  }
  push(op) {
    this.doc = (0, _operations.applyOperation)(this.doc, op);
    this.ops.push(op);
  }
  update(id, after) {
    const block = (0, _document.getBlock)(this.doc, id);
    const before = {};
    if ('type' in after) before.type = block.type;
    if ('text' in after) before.text = block.text;
    if ('props' in after) before.props = block.props;
    this.push({
      kind: 'update',
      id,
      before,
      after
    });
  }
  /** Move `id` to `parent[index]`, counted without `id` in the list. */
  move(id, parent, index) {
    const from = (0, _operations.anchorOf)(this.doc, id);
    this.push({
      kind: 'move',
      id,
      from,
      to: (0, _operations.anchorAt)(this.doc, parent, index, id)
    });
  }
  insert(block, index) {
    this.push({
      kind: 'insert',
      ...(0, _operations.anchorAt)(this.doc, block.parent, index),
      blocks: [block]
    });
  }
  remove(id) {
    const anchor = (0, _operations.anchorOf)(this.doc, id);
    const blocks = (0, _document.subtreeIds)(this.doc, id).map(b => (0, _document.getBlock)(this.doc, b));
    this.push({
      kind: 'remove',
      ...anchor,
      blocks
    });
  }
  /**
   * The transaction. `undefined` for a selection means "leave it as it is";
   * `null` clears it.
   */
  done(selectionBefore, selectionAfter) {
    return {
      ops: this.ops,
      ...(selectionBefore !== undefined && {
        selectionBefore
      }),
      ...(selectionAfter !== undefined && {
        selectionAfter
      })
    };
  }
}
function newBlock(ctx, type, parent, init = {}) {
  const spec = (0, _schema.specOf)(ctx.schema, type);
  return {
    id: ctx.newId(),
    type,
    parent,
    ...(spec.hasText && {
      text: init.text ?? []
    }),
    props: (0, _schema.propsFor)(spec, init.props),
    children: []
  };
}
function textOf(block) {
  return block.text ?? [];
}
function lengthOf(block) {
  return (0, _model.segmentsToPlainText)(textOf(block)).length;
}

/** The previous block on screen that carries text, skipping hidden children. */
function previousTextBlock(ctx, id) {
  const order = (0, _document.readingOrder)(ctx.doc, ctx.isCollapsed);
  for (let i = order.indexOf(id) - 1; i >= 0; i -= 1) {
    const candidate = order[i];
    if (candidate && (0, _schema.specOf)(ctx.schema, (0, _document.getBlock)(ctx.doc, candidate).type).hasText) return candidate;
  }
  return null;
}

/** The next block on screen that carries text. */
function nextTextBlock(ctx, id) {
  const order = (0, _document.readingOrder)(ctx.doc, ctx.isCollapsed);
  for (let i = order.indexOf(id) + 1; i < order.length; i += 1) {
    const candidate = order[i];
    if (candidate && (0, _schema.specOf)(ctx.schema, (0, _document.getBlock)(ctx.doc, candidate).type).hasText) return candidate;
  }
  return null;
}

/** Replace a block's text after an edit in its input. */
function editText(ctx, id, next, selectionAfter) {
  const b = new Builder(ctx.doc);
  b.update(id, {
    text: next
  });
  return b.done(undefined, selectionAfter);
}

/** Apply one text edit to a block, keeping marks outside it. */
function applyEdit(ctx, id, edit) {
  const block = (0, _document.getBlock)(ctx.doc, id);
  const next = (0, _model.applyTextEdit)(textOf(block), edit);
  const end = edit.index + edit.insert.length;
  return editText(ctx, id, next, caret(id, end));
}

/** Set or clear marks on `[start, end)` of a block's text. */
function formatText(ctx, id, start, end, marks) {
  if (start >= end) return null;
  const block = (0, _document.getBlock)(ctx.doc, id);
  const sel = {
    kind: 'text',
    blockId: id,
    start,
    end
  };
  const b = new Builder(ctx.doc);
  b.update(id, {
    text: (0, _model.applyMarks)(textOf(block), start, end, marks)
  });
  return b.done(sel, sel);
}

/** Merge `patch` into a block's props (`undefined` removes a key). */
function setProps(ctx, id, patch) {
  const block = (0, _document.getBlock)(ctx.doc, id);
  const props = {
    ...block.props
  };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete props[key];else props[key] = value;
  }
  const spec = (0, _schema.specOf)(ctx.schema, block.type);
  const b = new Builder(ctx.doc);
  b.update(id, {
    props: spec.props ? (0, _schema.propsFor)({
      ...spec,
      defaultProps: undefined
    }, props) : props
  });
  // A heading no longer a toggle hands its children to the following position.
  if (block.children.length > 0 && !(0, _schema.acceptsChildren)(ctx.schema, (0, _document.getBlock)(b.doc, id))) {
    const {
      parent,
      index
    } = (0, _document.positionOf)(b.doc, id);
    block.children.forEach((child, i) => {
      b.move(child, parent, index + 1 + i);
    });
  }
  return b.done();
}

/**
 * Whether `id` can become `type` without losing anything: a type without text
 * (an image, a divider) only takes a block whose text is empty.
 */
function canTurnInto(ctx, id, type) {
  const block = (0, _document.getBlock)(ctx.doc, id);
  return (0, _schema.specOf)(ctx.schema, type).hasText || lengthOf(block) === 0;
}

/**
 * Change a block's type, keeping its text and props (so turning a to-do into a
 * paragraph and back keeps `checked`, as Notion does) unless the new type
 * lists the props it keeps. The new type's default props fill gaps; text is
 * added or kept per the new type. Refused (null) when the new type has no
 * text and the block has some: it would be gone once the document is saved.
 *
 * Explicit `props` select the destination variant as well as its type. An
 * omitted `childrenWhen` flag in that object selects the ordinary variant.
 * Resolve both together before placing children: a toggle heading must not
 * briefly become a childless heading. Without `props`, legacy callers keep
 * the current props/variant.
 */
function turnInto(ctx, id, type, props) {
  const block = (0, _document.getBlock)(ctx.doc, id);
  if (block.type === type && props === undefined || !canTurnInto(ctx, id, type)) return null;
  if (!(0, _schema.canHold)(ctx.schema, (0, _schema.parentOf)(ctx.doc, id), type)) return null;
  const spec = (0, _schema.specOf)(ctx.schema, type);
  const b = new Builder(ctx.doc);
  const after = {
    type
  };
  if (spec.hasText && !block.text) after.text = [];
  if (props !== undefined || spec.defaultProps || spec.props) {
    after.props = (0, _schema.propsFor)(spec, {
      ...block.props,
      ...(props !== undefined && spec.childrenWhen ? {
        [spec.childrenWhen]: false
      } : {}),
      ...props
    });
  }
  if (block.type === type && after.props && Object.keys(after.props).length === Object.keys(block.props).length && Object.entries(after.props).every(([key, value]) => Object.is(block.props[key], value))) return null;
  b.update(id, after);
  // A type that cannot hold children hands them to the following position.
  if (!(0, _schema.acceptsChildren)(ctx.schema, (0, _document.getBlock)(b.doc, id)) && block.children.length > 0) {
    const {
      parent,
      index
    } = (0, _document.positionOf)(b.doc, id);
    block.children.forEach((child, i) => {
      b.move(child, parent, index + 1 + i);
    });
  }
  const sel = spec.hasText ? caret(id, lengthOf((0, _document.getBlock)(b.doc, id))) : null;
  return b.done(null, sel);
}

/** Insert a new block after `afterId` (or at the end when null). */
function insertBlockAfter(ctx, afterId, type, init = {}) {
  const b = new Builder(ctx.doc);
  const {
    parent,
    index
  } = (0, _schema.placeAfter)(ctx.doc, ctx.schema, afterId, [type]);
  const block = newBlock(ctx, type, parent, init);
  b.insert(block, index);
  const sel = (0, _schema.specOf)(ctx.schema, type).hasText ? caret(block.id, 0) : {
    kind: 'blocks',
    ids: [block.id]
  };
  return b.done(null, sel);
}

/**
 * Add a block as the last child of `parentId` (into an empty container, at
 * the end of a note). Null when that block takes no children.
 */
function appendChild(ctx, parentId, type, init = {}) {
  const parent = (0, _document.getBlock)(ctx.doc, parentId);
  if (!(0, _schema.acceptsChildren)(ctx.schema, parent)) return null;
  const b = new Builder(ctx.doc);
  const block = newBlock(ctx, type, parentId, init);
  b.insert(block, parent.children.length);
  const sel = (0, _schema.specOf)(ctx.schema, type).hasText ? caret(block.id, 0) : {
    kind: 'blocks',
    ids: [block.id]
  };
  return b.done(null, sel);
}

/**
 * Return in a text block with the caret at `offset`.
 *
 * - In an empty list-like block: leave it — outdent when nested, else revert
 *   to a paragraph.
 * - Otherwise split the text. The tail goes to a new block of the type the
 *   spec continues as (lists continue, headings give a paragraph); a split
 *   in the middle keeps the type on both halves. When the block shows
 *   children, the new block becomes its first child.
 */
function splitBlock(ctx, id, offset) {
  const block = (0, _document.getBlock)(ctx.doc, id);
  const spec = (0, _schema.specOf)(ctx.schema, block.type);
  if (!spec.hasText || spec.multiline) return null;
  const length = lengthOf(block);
  if (length === 0 && spec.exitOnEmptyReturn) {
    return outdent(ctx, id) ?? turnInto(ctx, id, 'paragraph');
  }
  const [head, tail] = (0, _model.splitSegmentsAt)(textOf(block), offset);
  const atEnd = offset >= length;
  const collapsed = ctx.isCollapsed?.(block) ?? false;
  // Return at the end of an open toggle (or toggle heading) writes inside it, as in Notion.
  const intoToggle = atEnd && (0, _schema.isToggle)(ctx.schema, block) && !collapsed;
  const continueType = intoToggle ? 'paragraph' : atEnd ? spec.continueAs ?? 'paragraph' : block.type;
  const continueSpec = (0, _schema.specOf)(ctx.schema, continueType);
  const inheritedProps = continueType === block.type ? {
    ...block.props
  } : {};
  for (const key of continueSpec.resetOnContinue ?? []) delete inheritedProps[key];
  const b = new Builder(ctx.doc);
  if (!atEnd) b.update(id, {
    text: head
  });
  const showsChildren = intoToggle || block.children.length > 0 && !collapsed;
  const created = newBlock(ctx, continueType, showsChildren ? id : block.parent, {
    text: atEnd ? [] : tail,
    props: {
      ...continueSpec.defaultProps,
      ...inheritedProps
    }
  });
  if (showsChildren) {
    b.insert(created, 0);
  } else {
    const {
      index
    } = (0, _document.positionOf)(b.doc, id);
    b.insert(created, index + 1);
  }
  return b.done(caret(id, offset), caret(created.id, 0));
}

/**
 * Backspace with the caret at the very start of a text block.
 *
 * Reverts a styled block to a paragraph, then outdents a nested paragraph,
 * then merges the paragraph into the previous text block (its children move
 * to that block). An empty block after a non-text block (divider, image)
 * removes the empty block.
 */
function backspaceAtStart(ctx, id) {
  const block = (0, _document.getBlock)(ctx.doc, id);
  const spec = (0, _schema.specOf)(ctx.schema, block.type);
  if (spec.revertOnBackspace && block.type !== 'paragraph') {
    const reverted = turnInto(ctx, id, 'paragraph');
    // The caret stays where it was: at the start.
    return reverted && {
      ...reverted,
      selectionAfter: caret(id, 0)
    };
  }
  if (block.parent !== null && !(0, _schema.specOf)(ctx.schema, (0, _document.getBlock)(ctx.doc, block.parent).type).isContainer) {
    const out = outdent(ctx, id);
    if (out) return out;
  }
  const previous = previousTextBlock(ctx, id);
  if (previous === null) return null;
  const target = (0, _document.getBlock)(ctx.doc, previous);
  const joinAt = lengthOf(target);
  const b = new Builder(ctx.doc);
  b.update(previous, {
    text: [...textOf(target), ...textOf(block)]
  });
  const targetTakes = (0, _schema.acceptsChildren)(ctx.schema, target);
  const children = [...block.children];
  children.forEach((child, i) => {
    if (targetTakes) b.move(child, previous, (0, _document.getBlock)(b.doc, previous).children.length);else {
      const {
        parent,
        index
      } = (0, _document.positionOf)(b.doc, id);
      b.move(child, parent, index + 1 + i);
    }
  });
  b.remove(id);
  return b.done(caret(id, 0), caret(previous, joinAt));
}

/** Delete with the caret at the end: pull the next text block's text in. */
function deleteAtEnd(ctx, id) {
  const next = nextTextBlock(ctx, id);
  if (next === null) return null;
  return mergeInto(ctx, id, next);
}
function mergeInto(ctx, into, from) {
  const target = (0, _document.getBlock)(ctx.doc, into);
  const source = (0, _document.getBlock)(ctx.doc, from);
  const joinAt = lengthOf(target);
  const b = new Builder(ctx.doc);
  b.update(into, {
    text: [...textOf(target), ...textOf(source)]
  });
  for (const child of [...source.children]) {
    const {
      parent,
      index
    } = (0, _document.positionOf)(b.doc, from);
    b.move(child, parent, index + 1);
  }
  b.remove(from);
  return b.done(caret(into, joinAt), caret(into, joinAt));
}

/** Tab: nest the block as the last child of its previous sibling. */
function indent(ctx, id, selection = null) {
  const {
    parent,
    index
  } = (0, _document.positionOf)(ctx.doc, id);
  if (index === 0) return null;
  if (parent !== null && (0, _schema.specOf)(ctx.schema, (0, _document.getBlock)(ctx.doc, parent).type).isContainer && (0, _document.getBlock)(ctx.doc, parent).type !== 'column') {
    return null;
  }
  const previous = (0, _document.childrenOf)(ctx.doc, parent)[index - 1];
  if (!previous) return null;
  const previousBlock = (0, _document.getBlock)(ctx.doc, previous);
  const previousSpec = (0, _schema.specOf)(ctx.schema, previousBlock.type);
  if (!(0, _schema.acceptsChildren)(ctx.schema, previousBlock) || previousSpec.isContainer) return null;
  const b = new Builder(ctx.doc);
  b.move(id, previous, previousBlock.children.length);
  if (previousBlock.props.expanded === false) b.update(previous, {
    props: {
      ...previousBlock.props,
      expanded: true
    }
  });
  return b.done(selection ?? undefined, selection ?? undefined);
}

/**
 * Shift-Tab: move the block to just after its parent. Its following siblings
 * become its children, so the visual order does not change.
 */
function outdent(ctx, id, selection = null) {
  const block = (0, _document.getBlock)(ctx.doc, id);
  if (block.parent === null) return null;
  const parent = (0, _document.getBlock)(ctx.doc, block.parent);
  if ((0, _schema.specOf)(ctx.schema, parent.type).isContainer) return null;
  const {
    index
  } = (0, _document.positionOf)(ctx.doc, id);
  const following = parent.children.slice(index + 1);
  const {
    parent: grandparent,
    index: parentIndex
  } = (0, _document.positionOf)(ctx.doc, parent.id);
  const b = new Builder(ctx.doc);
  b.move(id, grandparent, parentIndex + 1);
  if (following.length > 0 && (0, _schema.acceptsChildren)(ctx.schema, block)) {
    for (const sibling of following) b.move(sibling, id, (0, _document.getBlock)(b.doc, id).children.length);
  }
  const sel = selection ?? ((0, _schema.specOf)(ctx.schema, block.type).hasText ? caret(id, 0) : null);
  return b.done(sel, sel);
}

/**
 * Tab on selected blocks: each nests under the block before it, so a run of
 * siblings goes under the one above the first. Null when the first cannot
 * nest (it is the first of its list), as in Notion.
 */
function indentBlocks(ctx, ids) {
  const roots = selectionRoots(ctx.doc, ids);
  if (roots.length === 0) return null;
  let doc = ctx.doc;
  const ops = [];
  for (const [i, id] of roots.entries()) {
    const tx = indent({
      ...ctx,
      doc
    }, id);
    if (!tx) {
      if (i === 0) return null;
      continue;
    }
    for (const op of tx.ops) {
      doc = (0, _operations.applyOperation)(doc, op);
      ops.push(op);
    }
  }
  const sel = {
    kind: 'blocks',
    ids: roots
  };
  return {
    ops,
    selectionBefore: sel,
    selectionAfter: sel
  };
}

/**
 * Shift-Tab on selected blocks: each moves out of its parent, last first, so
 * they stay in their order and none takes another as a child. Null when none
 * can move out.
 */
function outdentBlocks(ctx, ids) {
  const roots = selectionRoots(ctx.doc, ids);
  let doc = ctx.doc;
  const ops = [];
  for (const id of [...roots].reverse()) {
    const tx = outdent({
      ...ctx,
      doc
    }, id);
    if (!tx) continue;
    for (const op of tx.ops) {
      doc = (0, _operations.applyOperation)(doc, op);
      ops.push(op);
    }
  }
  if (ops.length === 0) return null;
  const sel = {
    kind: 'blocks',
    ids: roots
  };
  return {
    ops,
    selectionBefore: sel,
    selectionAfter: sel
  };
}

/** Merge `patch` into the props of every block in `ids`, as one edit. */
function setBlocksProps(ctx, ids, patch) {
  return composeCommands(ctx, ids.map(id => c => setProps(c, id, patch)));
}

/** A mention to put in a block's text: what it shows and what it points at. */

/**
 * Put a mention over `[start, end)` of a block's text (at the caret when they
 * are equal): an atomic run, the caret after it. Null for an empty mention.
 */
function insertMention(ctx, id, start, end, mention) {
  if (!mention.text) return null;
  const block = (0, _document.getBlock)(ctx.doc, id);
  if (!(0, _schema.specOf)(ctx.schema, block.type).hasText) return null;
  const [head, rest] = (0, _model.splitSegmentsAt)(textOf(block), start);
  const [, tail] = (0, _model.splitSegmentsAt)(rest, Math.max(0, end - start));
  const run = {
    text: mention.text,
    mention: {
      indicator: mention.indicator,
      attributes: {
        ...mention.attributes
      }
    }
  };
  const next = (0, _model.coalesceSegments)([...head, run, ...tail]);
  return editText(ctx, id, next, caret(id, start + mention.text.length));
}

/** Top-level blocks of a selection: drop any block whose ancestor is also selected. */
function selectionRoots(doc, ids) {
  const set = new Set(ids);
  const roots = ids.filter(id => {
    let parent = (0, _document.getBlock)(doc, id).parent;
    while (parent !== null) {
      if (set.has(parent)) return false;
      parent = (0, _document.getBlock)(doc, parent).parent;
    }
    return true;
  });
  const order = (0, _document.readingOrder)(doc);
  return roots.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** Delete blocks (and their subtrees). Focus lands on the text block before them. */
function removeBlocks(ctx, ids) {
  const roots = selectionRoots(ctx.doc, ids);
  if (roots.length === 0) return null;
  const first = roots[0];
  const focus = first ? previousTextBlock(ctx, first) : null;
  const b = new Builder(ctx.doc);
  for (const id of roots) b.remove(id);
  const sel = focus ? caret(focus, lengthOf((0, _document.getBlock)(b.doc, focus))) : null;
  return b.done({
    kind: 'blocks',
    ids: roots
  }, sel);
}

/** Copy blocks (with their subtrees) to just after the last of them. */
function duplicateBlocks(ctx, ids) {
  const roots = selectionRoots(ctx.doc, ids);
  const last = roots[roots.length - 1];
  if (!last) return null;
  const b = new Builder(ctx.doc);
  const {
    parent,
    index
  } = (0, _document.positionOf)(ctx.doc, last);
  const copies = [];
  roots.forEach((id, i) => {
    const subtree = cloneSubtree(ctx, ctx.doc, id, parent);
    b.push({
      kind: 'insert',
      ...(0, _operations.anchorAt)(b.doc, parent, index + 1 + i),
      blocks: subtree
    });
    const top = subtree[0];
    if (top) copies.push(top.id);
  });
  return b.done({
    kind: 'blocks',
    ids: roots
  }, {
    kind: 'blocks',
    ids: copies
  });
}

/** A copy of a subtree with fresh ids, parents before children. */
function cloneSubtree(ctx, doc, id, parent) {
  const out = [];
  const visit = (sourceId, newParent) => {
    const source = (0, _document.getBlock)(doc, sourceId);
    const id = ctx.newId();
    // Reserve the parent's slot first, so the list stays parents-first.
    const slot = out.length;
    out.push(source);
    const children = source.children.map(child => visit(child, id));
    out[slot] = {
      ...source,
      id,
      parent: newParent,
      children
    };
    return id;
  };
  visit(id, parent);
  return out;
}
/**
 * Move blocks next to (or into) `target`, keeping their relative order.
 * Returns null when the move would place a block inside itself.
 */
function moveBlocks(ctx, ids, target, position) {
  const roots = selectionRoots(ctx.doc, ids);
  if (roots.length === 0) return null;
  if (roots.some(id => (0, _document.isWithin)(ctx.doc, target, id))) return null;
  if (position === 'inside' && !(0, _schema.acceptsChildren)(ctx.schema, (0, _document.getBlock)(ctx.doc, target))) return null;
  // A row stays in its table, a cell in its row, and nothing else goes in.
  const destination = position === 'inside' ? (0, _document.getBlock)(ctx.doc, target) : (0, _schema.parentOf)(ctx.doc, target);
  if (roots.some(id => !(0, _schema.canHold)(ctx.schema, destination, (0, _document.getBlock)(ctx.doc, id).type))) return null;
  const b = new Builder(ctx.doc);
  for (const [i, id] of roots.entries()) {
    if (position === 'inside') {
      // The last slot, counted after the block leaves its current list.
      const from = (0, _document.positionOf)(b.doc, id);
      const length = (0, _document.getBlock)(b.doc, target).children.length;
      const last = from.parent === target ? length - 1 : length;
      if (from.parent === target && from.index === last) continue;
      b.move(id, target, last);
      continue;
    }
    const anchor = i === 0 ? target : roots[i - 1];
    if (!anchor) continue;
    const {
      parent,
      index
    } = (0, _document.positionOf)(b.doc, anchor);
    const insertAt = position === 'before' && i === 0 ? index : index + 1;
    const from = (0, _document.positionOf)(b.doc, id);
    // Removal from the same parent ahead of the anchor shifts the anchor left.
    const adjusted = from.parent === parent && from.index < insertAt ? insertAt - 1 : insertAt;
    if (from.parent === parent && from.index === adjusted) continue;
    b.move(id, parent, adjusted);
  }
  if (b.ops.length === 0) return null;
  return b.done({
    kind: 'blocks',
    ids: roots
  }, {
    kind: 'blocks',
    ids: roots
  });
}

/**
 * Run commands in sequence as one transaction (one undo step): each sees the
 * document the previous ones produced. A command returning null is skipped.
 * Null when none applied.
 */
function composeCommands(ctx, commands) {
  let doc = ctx.doc;
  const ops = [];
  let selectionBefore;
  let selectionAfter;
  for (const command of commands) {
    const tx = command({
      ...ctx,
      doc
    });
    if (!tx) continue;
    for (const op of tx.ops) {
      doc = (0, _operations.applyOperation)(doc, op);
      ops.push(op);
    }
    if (selectionBefore === undefined) selectionBefore = tx.selectionBefore;
    if (tx.selectionAfter !== undefined) selectionAfter = tx.selectionAfter;
  }
  if (ops.length === 0) return null;
  return {
    ops,
    selectionBefore: selectionBefore ?? null,
    selectionAfter: selectionAfter ?? null
  };
}
//# sourceMappingURL=commands.js.map