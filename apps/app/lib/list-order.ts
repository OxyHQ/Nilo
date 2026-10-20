/**
 * Reordering a list as a view's settings do: a sort, a group, a column or a
 * view tab moved by its arrows or dropped on another. Each returns a new list,
 * or null when the move changes nothing, so a caller saves only a change.
 */

/** `items` with the one at `from` moved to `to`, the others keeping their order. */
export function move<T>(items: readonly T[], from: number, to: number): T[] | null {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) return null;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** `items` with `item` taken out and put just before or after `target`. */
export function place<T>(
  items: readonly T[],
  item: T,
  target: T,
  side: 'before' | 'after',
): T[] | null {
  if (item === target || !items.includes(item)) return null;
  const rest = items.filter((x) => x !== item);
  const at = rest.indexOf(target);
  if (at === -1) return null;
  rest.splice(side === 'before' ? at : at + 1, 0, item);
  return rest;
}

/**
 * `items` in a stored order: those whose key `order` names first, in its
 * order, the others after — one added since — in theirs.
 */
export function rankBy<T, K>(items: readonly T[], order: readonly K[], keyOf: (item: T) => K): T[] {
  if (order.length === 0) return [...items];
  const rank = new Map<K, number>();
  order.forEach((key, i) => {
    if (!rank.has(key)) rank.set(key, i);
  });
  return items
    .map((item, i) => ({ item, i, at: rank.get(keyOf(item)) ?? order.length }))
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .map(({ item }) => item);
}
