/**
 * Sibling order. Blocks are ordered among their siblings by a fractional
 * `order`, then by id. Only the server assigns orders: an editor names the
 * block a new or moved block goes after, and the server places it with
 * `placeAfter` against the siblings as they are when the operation runs.
 */

/** Below this, two neighbours leave no room between them and the siblings are renumbered. */
export const MIN_ORDER_GAP = 1e-9;

export interface Sibling {
  id: string;
  order: number;
}

/** Sibling order: by `order`, then by id. */
export function compareOrder(orderA: number, idA: string, orderB: number, idB: string): number {
  return orderA - orderB || (idA < idB ? -1 : idA > idB ? 1 : 0);
}

/**
 * The order for a block going right after `afterId` among `siblings` (the
 * other children of its parent, in any order), first when `afterId` is null.
 * An anchor that is not among them (moved or removed meanwhile) puts the
 * block last, as the editor's own anchors do. When the neighbours leave no
 * room, the siblings are numbered 1, 2, 3… first; `renumbered` lists the
 * ones whose order that changed.
 */
export function placeAfter(
  siblings: readonly Sibling[],
  afterId: string | null,
): { order: number; renumbered: Sibling[] } {
  const sorted = [...siblings].sort((a, b) => compareOrder(a.order, a.id, b.order, b.id));
  let index = afterId === null ? -1 : sorted.findIndex((s) => s.id === afterId);
  if (afterId !== null && index < 0) index = sorted.length - 1;
  const between = (list: readonly Sibling[]): number | null => {
    const prev = index >= 0 ? list[index]?.order : undefined;
    const next = list[index + 1]?.order;
    if (prev === undefined && next === undefined) return 1;
    if (prev === undefined) return (next as number) - 1;
    if (next === undefined) return prev + 1;
    return next - prev > MIN_ORDER_GAP ? (prev + next) / 2 : null;
  };
  const order = between(sorted);
  if (order !== null) return { order, renumbered: [] };
  const numbered = sorted.map((s, i) => ({ id: s.id, order: i + 1 }));
  return {
    order: between(numbered) as number,
    renumbered: numbered.filter((s, i) => s.order !== sorted[i]?.order),
  };
}
