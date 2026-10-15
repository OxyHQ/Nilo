/**
 * Restoring a page version: the block operations that turn the page's
 * current blocks into the version's, keeping the ids of blocks both have (so
 * comments anchored to them stay anchored).
 */
import { compareOrder, normalizeContent } from '@nilo/contracts';
import type { VersionBlock } from '../db/schema/pages.js';
import type { BlockOperation } from './block-transactions.js';

const sameContent = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Inserts, updates and moves first — parents before children, siblings in
 * the version's order, each placed after the sibling before it — so a block
 * the version keeps is out from under anything about to go. Then the
 * top-most blocks the version does not have are removed, with whatever is
 * still under them.
 */
export function restoreOperations(
  current: readonly VersionBlock[],
  target: readonly VersionBlock[],
): BlockOperation[] {
  const ops: BlockOperation[] = [];
  const now = new Map(current.map((b) => [b.id, b]));
  const wanted = new Set(target.map((b) => b.id));
  const children = new Map<string | null, VersionBlock[]>();
  for (const block of target) {
    const parent =
      block.parentBlockId && wanted.has(block.parentBlockId) ? block.parentBlockId : null;
    children.set(parent, [...(children.get(parent) ?? []), block]);
  }

  const visit = (parent: string | null) => {
    const list = [...(children.get(parent) ?? [])].sort((a, b) =>
      compareOrder(a.order, a.id, b.order, b.id),
    );
    let afterId: string | null = null;
    for (const block of list) {
      const existing = now.get(block.id);
      if (!existing) {
        ops.push({
          kind: 'insert',
          id: block.id,
          parentBlockId: parent,
          afterId,
          type: block.type,
          content: block.content,
        });
      } else {
        if (
          existing.type !== block.type ||
          !sameContent(existing.content, normalizeContent(block.type, block.content))
        ) {
          ops.push({ kind: 'update', id: block.id, type: block.type, content: block.content });
        }
        ops.push({ kind: 'move', id: block.id, parentBlockId: parent, afterId });
      }
      afterId = block.id;
      visit(block.id);
    }
  };
  visit(null);

  for (const block of current) {
    if (wanted.has(block.id)) continue;
    // Top-most among the blocks going: its parent stays (or it is at the top).
    const parentGoes =
      block.parentBlockId !== null &&
      now.has(block.parentBlockId) &&
      !wanted.has(block.parentBlockId);
    if (!parentGoes) ops.push({ kind: 'remove', id: block.id });
  }
  return ops;
}
