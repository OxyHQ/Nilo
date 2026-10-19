/**
 * Where a page dropped in the sidebar goes: the `PATCH /pages/:id` writes
 * that put it there (`components/sidebar-sections/sidebar-page-tree.tsx`).
 */
import { placeAfter } from '@oxy.so/nilo-contracts';
import type { Page } from './types/pages';

export type DropPosition = 'before' | 'after' | 'inside';

export interface PageMove {
  id: string;
  patch: { order: number; parentId?: string | null; teamspaceId?: string | null };
}

/**
 * Where on a row a drop lands, by how far down it the pointer is (0 at its
 * top, 1 at its bottom): the top quarter before it, the bottom quarter after
 * it, the middle inside it.
 */
export function dropPositionAt(ratio: number): DropPosition {
  if (ratio < 0.25) return 'before';
  if (ratio > 0.75) return 'after';
  return 'inside';
}

/** A sidebar row's frame on screen, for the native drag's hit test. */
export interface RowRect {
  id: string;
  y: number;
  height: number;
}

export interface DropTarget {
  targetId: string;
  position: DropPosition;
}

/**
 * The row under `y` and where on it a drop would land; null over no row, or
 * over the row being dragged (a drop there changes nothing).
 */
export function dropTargetAt(
  rows: readonly RowRect[],
  y: number,
  sourceId: string,
): DropTarget | null {
  const row = rows.find((r) => r.height > 0 && y >= r.y && y < r.y + r.height);
  if (!row || row.id === sourceId) return null;
  return { targetId: row.id, position: dropPositionAt((y - row.y) / row.height) };
}

/** The tree's own sibling order (`buildPageTree`): by order, the latest update first on a tie. */
function displayOrder(a: Page, b: Page): number {
  const ao = a.order ?? 0;
  const bo = b.order ?? 0;
  if (ao !== bo) return ao - bo;
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

/**
 * The writes that move `sourceId` before, after or inside `targetId` of a tree
 * of `pages`: an order between the new neighbours (`placeAfter`), with the
 * siblings renumbered first when they leave no room. The source may come from
 * another section: a page dropped at the top of this one moves to `place`
 * (its teamspace, or null for private). Null when the drop changes nothing it
 * could (onto itself, or into its own subtree).
 */
export function planSidebarDrop({
  pages,
  sourceId,
  targetId,
  position,
  place,
}: {
  pages: readonly Page[];
  sourceId: string;
  targetId: string;
  position: DropPosition;
  /** Where this tree's top-level pages live; absent, a drop there keeps the page's place. */
  place?: { teamspaceId: string | null };
}): PageMove[] | null {
  if (sourceId === targetId) return null;
  const byId = new Map(pages.map((page) => [page.id, page] as const));
  const target = byId.get(targetId);
  if (!target) return null;
  // Never into its own subtree.
  for (let cursor: Page | undefined = target; cursor; ) {
    if (cursor.id === sourceId) return null;
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  const parentId = position === 'inside' ? target.id : (target.parentId ?? null);
  const siblings = pages
    .filter(
      (page) => (page.parentId ?? null) === parentId && page.id !== sourceId && !page.template,
    )
    .sort(displayOrder);
  const index = siblings.findIndex((page) => page.id === targetId);
  const afterIndex =
    position === 'inside' ? siblings.length - 1 : position === 'after' ? index : index - 1;

  // `placeAfter` breaks a tie by id; ranked ids keep the tree's own order.
  const rank = (i: number) => String(i).padStart(8, '0');
  const ranked = siblings.map((page, i) => ({ id: rank(i), order: page.order ?? 0 }));
  const { order, renumbered } = placeAfter(ranked, afterIndex >= 0 ? rank(afterIndex) : null);

  const moves: PageMove[] = renumbered.map((sibling) => ({
    id: (siblings[Number(sibling.id)] as Page).id,
    patch: { order: sibling.order },
  }));
  moves.push({
    id: sourceId,
    patch: {
      order,
      parentId,
      ...(parentId === null && place ? { teamspaceId: place.teamspaceId } : {}),
    },
  });
  return moves;
}
