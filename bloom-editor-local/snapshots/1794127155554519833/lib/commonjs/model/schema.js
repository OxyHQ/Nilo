"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DEFAULT_SCHEMA = void 0;
exports.acceptsChildren = acceptsChildren;
exports.canHold = canHold;
exports.defineSchema = defineSchema;
exports.extendSchema = extendSchema;
exports.isStructural = isStructural;
exports.isToggle = isToggle;
exports.parentOf = parentOf;
exports.placeAfter = placeAfter;
exports.propsFor = propsFor;
exports.specOf = specOf;
var _document = require("./document.js");
/**
 * What each block type does under the editor's commands. The schema is data,
 * so an application adds its own block types without touching the commands.
 */

/** The block types every Bloom editor understands. */
const DEFAULT_SCHEMA = exports.DEFAULT_SCHEMA = defineSchema([{
  type: 'paragraph',
  hasText: true,
  canHaveChildren: true
}, {
  type: 'heading_1',
  hasText: true,
  canHaveChildren: false,
  childrenWhen: 'toggleable',
  revertOnBackspace: true
}, {
  type: 'heading_2',
  hasText: true,
  canHaveChildren: false,
  childrenWhen: 'toggleable',
  revertOnBackspace: true
}, {
  type: 'heading_3',
  hasText: true,
  canHaveChildren: false,
  childrenWhen: 'toggleable',
  revertOnBackspace: true
}, {
  type: 'bulleted_list_item',
  hasText: true,
  canHaveChildren: true,
  continueAs: 'bulleted_list_item',
  exitOnEmptyReturn: true,
  revertOnBackspace: true
}, {
  type: 'numbered_list_item',
  hasText: true,
  canHaveChildren: true,
  continueAs: 'numbered_list_item',
  exitOnEmptyReturn: true,
  revertOnBackspace: true
}, {
  type: 'todo',
  hasText: true,
  canHaveChildren: true,
  continueAs: 'todo',
  exitOnEmptyReturn: true,
  revertOnBackspace: true,
  defaultProps: {
    checked: false
  },
  resetOnContinue: ['checked']
}, {
  type: 'toggle',
  hasText: true,
  canHaveChildren: true,
  continueAs: 'toggle',
  exitOnEmptyReturn: true,
  revertOnBackspace: true,
  defaultProps: {
    expanded: true
  }
}, {
  type: 'quote',
  hasText: true,
  canHaveChildren: true,
  exitOnEmptyReturn: true,
  revertOnBackspace: true
}, {
  type: 'callout',
  hasText: true,
  canHaveChildren: true,
  revertOnBackspace: true
}, {
  type: 'code',
  hasText: true,
  canHaveChildren: false,
  multiline: true,
  defaultProps: {
    language: 'plain'
  }
}, {
  type: 'divider',
  hasText: false,
  canHaveChildren: false
}]);
function defineSchema(specs) {
  const out = {};
  for (const spec of specs) out[spec.type] = spec;
  return out;
}

/** A schema with `specs` added or replacing types of the same name. */
function extendSchema(base, specs) {
  return {
    ...base,
    ...defineSchema(specs)
  };
}

/**
 * A block's props under `spec`: the type's defaults under `props`, without
 * the props the type does not keep.
 */
function propsFor(spec, props = {}) {
  const merged = {
    ...spec.defaultProps,
    ...props
  };
  if (!spec.props) return merged;
  const kept = {};
  for (const key of spec.props) if (key in merged) kept[key] = merged[key];
  return kept;
}

/** The spec for `type`; unknown types behave as plain, childless, textless blocks. */
function specOf(schema, type) {
  return schema[type] ?? {
    type,
    hasText: false,
    canHaveChildren: false
  };
}

/**
 * Whether a block of `type` may sit in `parent` (null: the top of the page),
 * as far as either one's `childTypes` and `parentTypes` say.
 */
function canHold(schema, parent, type) {
  const parents = specOf(schema, type).parentTypes;
  if (parents && (parent === null || !parents.includes(parent.type))) return false;
  const children = parent ? specOf(schema, parent.type).childTypes : undefined;
  return !children || children.includes(type);
}

/** The block `id` sits in; null at the top of the page. */
function parentOf(doc, id) {
  const {
    parent
  } = (0, _document.getBlock)(doc, id);
  return parent === null ? null : (0, _document.getBlock)(doc, parent);
}

/**
 * Where blocks of `types` go after `afterId` (null: the end of the page):
 * just after it, or — when its parent cannot hold them (a cell's row, a
 * row's table) — just after the nearest ancestor whose parent can.
 */
function placeAfter(doc, schema, afterId, types) {
  let anchor = afterId;
  while (anchor !== null) {
    const parent = parentOf(doc, anchor);
    if (types.every(type => canHold(schema, parent, type))) {
      const pos = (0, _document.positionOf)(doc, anchor);
      return {
        parent: pos.parent,
        index: pos.index + 1
      };
    }
    anchor = (0, _document.getBlock)(doc, anchor).parent;
  }
  return {
    parent: null,
    index: doc.root.length
  };
}

/** Whether blocks of `type` are part of their parent's layout (`parentTypes`). */
function isStructural(schema, type) {
  return specOf(schema, type).parentTypes !== undefined;
}

/** Whether `block` may hold children now (its type always, or while a prop says so). */
function acceptsChildren(schema, block) {
  const spec = specOf(schema, block.type);
  if (spec.canHaveChildren) return true;
  return spec.childrenWhen !== undefined && block.props[spec.childrenWhen] === true;
}

/** Whether `block` folds its children away like a toggle (a toggle, a toggle heading). */
function isToggle(schema, block) {
  if (block.type === 'toggle') return true;
  const spec = specOf(schema, block.type);
  return spec.childrenWhen !== undefined && block.props[spec.childrenWhen] === true;
}
//# sourceMappingURL=schema.js.map