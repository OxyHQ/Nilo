/**
 * Moving a database view among its siblings (the view tabs): views are listed
 * by `order`, so a move writes the orders that change, the moved view's and
 * those it passes. The orders become the positions, 0 to n - 1, which also
 * settles views created with the same order.
 */
interface Ordered {
  id: string;
  order: number;
}

/** `views` in their order, `id` moved to `index`. */
export function movedViews<T extends Ordered>(views: readonly T[], id: string, index: number): T[] {
  const sorted = [...views].sort((a, b) => a.order - b.order);
  const from = sorted.findIndex((v) => v.id === id);
  if (from === -1) return sorted;
  const [moved] = sorted.splice(from, 1);
  sorted.splice(Math.max(0, Math.min(index, sorted.length)), 0, moved as T);
  return sorted;
}

/** The orders to write for `views` to be listed as they are here. */
export function orderChanges(views: readonly Ordered[]): { viewId: string; order: number }[] {
  return views.flatMap((v, order) => (v.order === order ? [] : [{ viewId: v.id, order }]));
}
