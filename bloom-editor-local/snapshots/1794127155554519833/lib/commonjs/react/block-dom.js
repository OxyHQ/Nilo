"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GUTTER_DOM_PREFIX = exports.BLOCK_DOM_PREFIX = void 0;
exports.blockDomId = blockDomId;
exports.blockElementAt = blockElementAt;
exports.blockIdFromDomId = blockIdFromDomId;
exports.gutterDomId = gutterDomId;
/**
 * The default DOM id prefix of a block's row on web (`domIdPrefix`): pointer
 * selection and drag and drop find blocks by it, and an app scrolls to a
 * block with `document.getElementById(blockDomId(id))`.
 */
const BLOCK_DOM_PREFIX = exports.BLOCK_DOM_PREFIX = 'bloom-block-';

/**
 * The DOM id of a block's row on web. Two surfaces that show the same block
 * (a synced block shown where it was made and where it is referenced) give
 * their editors different prefixes, so no id is on the page twice.
 */
function blockDomId(id, prefix = BLOCK_DOM_PREFIX) {
  return `${prefix}${id}`;
}

/**
 * The block id a DOM id names under `prefix`, or null when it names none of
 * them (another surface's block, a gutter).
 */
function blockIdFromDomId(domId, prefix = BLOCK_DOM_PREFIX) {
  return domId.startsWith(prefix) && domId.length > prefix.length ? domId.slice(prefix.length) : null;
}

/**
 * The DOM id prefix of every block's gutter on web, whatever the surface:
 * pointer selection leaves the gutter to its buttons.
 */
const GUTTER_DOM_PREFIX = exports.GUTTER_DOM_PREFIX = 'bloom-gutter-';

/**
 * A block's gutter: `GUTTER_DOM_PREFIX`, then the block's own DOM id — unique
 * per surface, and never mistaken for a block row (it does not start with
 * the block prefix).
 */
function gutterDomId(id, prefix = BLOCK_DOM_PREFIX) {
  return `${GUTTER_DOM_PREFIX}${blockDomId(id, prefix)}`;
}

/**
 * Web: the row of the block `target` is in, under `prefix`, and that block's
 * id — the nearest row whose id names a block `has` knows, so a surface
 * nested in a block (a synced block's), whose rows use another prefix, is
 * looked through to the block it is in.
 */
function blockElementAt(target, prefix, has) {
  let element = target?.closest?.('[id]') ?? null;
  while (element) {
    const id = blockIdFromDomId(element.id, prefix);
    if (id !== null && has(id)) return {
      element,
      id
    };
    element = element.parentElement?.closest('[id]') ?? null;
  }
  return null;
}
//# sourceMappingURL=block-dom.js.map