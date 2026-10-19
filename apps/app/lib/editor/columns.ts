/**
 * A columns block: `columns` holds two to four `column`s side by side, each
 * holding its own blocks, and each column's `ratio` is its share of the width
 * (the shares add up to one; a column without one takes an even share). These
 * are the edits that change the layout; each is one transaction (one undo
 * step) that keeps `columnCount` in step with the columns.
 */
import {
  type BlockId,
  type CommandContext,
  composeCommands,
  type EditorDocument,
  getBlock,
  insertSnapshot,
  moveBlocks,
  removeBlocks,
  setProps,
  type Transaction,
} from '@oxy.so/bloom-editor/model';

export const COLUMNS = 'columns';
export const COLUMN = 'column';
/** What the contract allows (`columnCount` is 2, 3 or 4). */
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 4;
/** The narrowest share a column can be dragged to. */
export const MIN_RATIO = 0.1;

export function columnIds(doc: EditorDocument, columnsId: BlockId): BlockId[] {
  return getBlock(doc, columnsId).children.filter((id) => doc.blocks[id]?.type === COLUMN);
}

/**
 * Each column's share of the width, adding up to one: the ratios stored,
 * a column without one taking an even share of what is left, scaled when
 * they add up to anything else.
 */
export function columnShares(ratios: readonly (number | undefined)[]): number[] {
  if (ratios.length === 0) return [];
  const valid = ratios.map((r) => (typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : 0));
  const given = valid.reduce((sum, r) => sum + r, 0);
  const missing = valid.filter((r) => r === 0).length;
  const even = 1 / ratios.length;
  const fill = missing === 0 ? 0 : given < 1 ? (1 - given) / missing : even;
  const raw = valid.map((r) => (r === 0 ? fill : r));
  const total = raw.reduce((sum, r) => sum + r, 0);
  return raw.map((r) => r / total);
}

export function sharesOf(doc: EditorDocument, columnsId: BlockId): number[] {
  return columnShares(
    columnIds(doc, columnsId).map((id) => {
      const ratio = getBlock(doc, id).props.ratio;
      return typeof ratio === 'number' ? ratio : undefined;
    }),
  );
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** Every column's ratio, written as one change. */
function writeShares(
  ctx: CommandContext,
  ids: readonly BlockId[],
  shares: readonly number[],
): Transaction | null {
  return composeCommands(
    ctx,
    ids.map((id, i) => (c: CommandContext) => setProps(c, id, { ratio: round(shares[i] ?? 0) })),
  );
}

/**
 * The divider between column `index` and the next dragged by `delta` (a
 * share of the whole width): those two columns trade width, neither going
 * under `MIN_RATIO`; the others keep theirs.
 */
export function resizeShares(shares: readonly number[], index: number, delta: number): number[] {
  const left = shares[index];
  const right = shares[index + 1];
  if (left === undefined || right === undefined) return [...shares];
  const pair = left + right;
  const next = Math.min(pair - MIN_RATIO, Math.max(MIN_RATIO, left + delta));
  const out = [...shares];
  out[index] = next;
  out[index + 1] = pair - next;
  return out;
}

/** Store the shares a drag ended at. */
export function setColumnShares(
  ctx: CommandContext,
  columnsId: BlockId,
  shares: readonly number[],
): Transaction | null {
  const ids = columnIds(ctx.doc, columnsId);
  if (ids.length !== shares.length) return null;
  return writeShares(ctx, ids, columnShares(shares));
}

/**
 * A new, empty column after column `index` (before the first when -1); it
 * takes an even share, and the others make room in proportion.
 */
export function addColumn(
  ctx: CommandContext,
  columnsId: BlockId,
  index: number,
): Transaction | null {
  const ids = columnIds(ctx.doc, columnsId);
  if (ids.length >= MAX_COLUMNS) return null;
  const shares = sharesOf(ctx.doc, columnsId);
  const count = ids.length + 1;
  const scaled = shares.map((share) => (share * (count - 1)) / count);
  const at = Math.max(-1, Math.min(index, ids.length - 1));
  const nextShares = [...scaled.slice(0, at + 1), 1 / count, ...scaled.slice(at + 1)];
  let added: BlockId | undefined;
  return composeCommands(ctx, [
    (c) => {
      const column = { type: COLUMN, children: [{ type: 'paragraph', text: [] }] };
      const anchor = at >= 0 ? (ids[at] ?? null) : null;
      if (anchor) {
        const tx = insertSnapshot(c.doc, [column], anchor, c.newId, c.schema);
        added = tx?.selectionAfter?.kind === 'blocks' ? tx.selectionAfter.ids[0] : undefined;
        return tx;
      }
      // First: after the first column, then the first moves after it.
      const first = ids[0];
      if (!first) return null;
      const tx = insertSnapshot(c.doc, [column], first, c.newId, c.schema);
      added = tx?.selectionAfter?.kind === 'blocks' ? tx.selectionAfter.ids[0] : undefined;
      return tx;
    },
    (c) => (at < 0 && added && ids[0] ? moveBlocks(c, [ids[0]], added, 'after') : null),
    (c) => writeShares(c, columnIds(c.doc, columnsId), nextShares),
    (c) => setProps(c, columnsId, { columnCount: count }),
    (c) => {
      const paragraph = added ? getBlock(c.doc, added).children[0] : undefined;
      return paragraph
        ? {
            ops: [],
            selectionAfter: { kind: 'text' as const, blockId: paragraph, start: 0, end: 0 },
          }
        : null;
    },
  ]);
}

/**
 * Remove column `columnId`, its blocks and its width going to the column
 * before it (at its end), or for the first column to the one after it (at its
 * start), so the page still reads in the same order. A layout left with one
 * column is no layout: its blocks take the place of the columns block.
 */
export function removeColumn(
  ctx: CommandContext,
  columnsId: BlockId,
  columnId: BlockId,
): Transaction | null {
  const ids = columnIds(ctx.doc, columnsId);
  const index = ids.indexOf(columnId);
  if (index < 0) return null;
  const neighbour = ids[index > 0 ? index - 1 : 1];
  if (!neighbour) return null;
  const moving = getBlock(ctx.doc, columnId).children;
  const shares = sharesOf(ctx.doc, columnsId);
  const remaining = ids.filter((id) => id !== columnId);

  if (remaining.length < MIN_COLUMNS) {
    // Two columns become none: every block, left to right, after the layout.
    const blocks = ids.flatMap((id) => getBlock(ctx.doc, id).children);
    return composeCommands(ctx, [
      (c) => (blocks.length > 0 ? moveBlocks(c, blocks, columnsId, 'after') : null),
      (c) => removeBlocks(c, [columnsId]),
    ]);
  }

  const nextShares = shares.filter((_, i) => i !== index);
  const into = remaining.indexOf(neighbour);
  nextShares[into] = (nextShares[into] ?? 0) + (shares[index] ?? 0);
  const firstOfNext = index === 0 ? getBlock(ctx.doc, neighbour).children[0] : undefined;
  return composeCommands(ctx, [
    (c) =>
      moving.length === 0
        ? null
        : firstOfNext
          ? moveBlocks(c, moving, firstOfNext, 'before')
          : moveBlocks(c, moving, neighbour, 'inside'),
    (c) => removeBlocks(c, [columnId]),
    (c) => writeShares(c, remaining, nextShares),
    (c) => setProps(c, columnsId, { columnCount: remaining.length }),
  ]);
}
