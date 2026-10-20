/**
 * The DOM ids of block rows on web (`blockDomId`). One block can be on the
 * page twice — a synced original where it was made and where a reference
 * shows it — so each surface that draws blocks has its own prefix, and what
 * scrolls to a block of the page (the table of contents, a search result, a
 * comment's text) looks for it under the page's own.
 */
import { BLOCK_DOM_PREFIX, blockDomId } from '@oxy.so/bloom-editor';

/** The page's own editor: Bloom's default. */
export const PAGE_DOM_PREFIX = BLOCK_DOM_PREFIX;

/** The row of one of the page's own blocks. */
export const pageBlockDomId = (blockId: string): string => blockDomId(blockId, PAGE_DOM_PREFIX);

/**
 * A synced block's surface inside the one whose prefix is `outer`: one per
 * reference and per path to it, so a reference shown twice (inside an
 * original that is itself shown elsewhere on the page) has two.
 */
export function syncedSurfacePrefix(outer: string, referenceId: string): string {
  return `${outer === PAGE_DOM_PREFIX ? 'nilo-synced-' : outer}${referenceId}-`;
}
