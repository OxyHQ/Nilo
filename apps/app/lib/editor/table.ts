/**
 * A table block's structure: `table` holds `table_row`s, each holding
 * `table_cell`s, and the table's `rows` and `cols` say how many. These are
 * the edits that change its shape; each is one transaction (one undo step)
 * that keeps `rows` and `cols` in step with the blocks.
 */
import {
  type Block,
  type BlockId,
  type BlockSnapshot,
  type CommandContext,
  childrenOf,
  composeCommands,
  documentFromSnapshot,
  type EditorDocument,
  getBlock,
  type Operation,
  removeBlocks,
  setProps,
  type Transaction,
} from '@oxy.so/bloom-editor/model';

export const TABLE = 'table';
export const ROW = 'table_row';
export const CELL = 'table_cell';

const cell = (): BlockSnapshot => ({ type: CELL, text: [] });

/** How many rows and columns the table has, counted from its blocks. */
export function tableShape(doc: EditorDocument, tableId: BlockId): { rows: number; cols: number } {
  const table = getBlock(doc, tableId);
  const rows = table.children.filter((id) => doc.blocks[id]?.type === ROW);
  const widest = Math.max(0, ...rows.map((id) => getBlock(doc, id).children.length));
  const stated = typeof table.props.cols === 'number' ? table.props.cols : 0;
  return { rows: rows.length, cols: Math.max(1, widest || stated) };
}

/**
 * Insert `snapshots` under `parent` at `index`, as `insertSnapshot` does after
 * a sibling — which cannot place a block first. Returns the new top ids.
 */
function insertAt(
  ctx: CommandContext,
  parent: BlockId,
  index: number,
  snapshots: readonly BlockSnapshot[],
): { tx: Transaction; ids: BlockId[] } | null {
  if (snapshots.length === 0) return null;
  const siblings = childrenOf(ctx.doc, parent);
  const at = Math.max(0, Math.min(index, siblings.length));
  const inserted = documentFromSnapshot(snapshots, ctx.newId, ctx.schema);
  const ops: Operation[] = inserted.root.map((topId, i) => {
    const subtree: Block[] = [];
    const collect = (id: BlockId, p: BlockId) => {
      const block = inserted.blocks[id];
      if (!block) return;
      subtree.push({ ...block, parent: p });
      for (const child of block.children) collect(child, id);
    };
    collect(topId, parent);
    const after = i === 0 ? (at > 0 ? (siblings[at - 1] ?? null) : null) : inserted.root[i - 1];
    return { kind: 'insert', parent, after: after ?? null, blocks: subtree };
  });
  return { tx: { ops, selectionBefore: null }, ids: [...inserted.root] };
}

const caretIn = (id: BlockId | undefined) =>
  id ? { kind: 'text' as const, blockId: id, start: 0, end: 0 } : undefined;

/** A row of empty cells at `index` (the end by default), the caret in its first cell. */
export function addRow(ctx: CommandContext, tableId: BlockId, index?: number): Transaction | null {
  const { rows, cols } = tableShape(ctx.doc, tableId);
  let firstCell: BlockId | undefined;
  return composeCommands(ctx, [
    (c) => {
      const row: BlockSnapshot = { type: ROW, children: Array.from({ length: cols }, cell) };
      const done = insertAt(c, tableId, index ?? rows, [row]);
      if (!done) return null;
      const rowId = done.ids[0];
      const inserted = done.tx.ops[0];
      firstCell =
        inserted?.kind === 'insert'
          ? inserted.blocks.find((block) => block.parent === rowId)?.id
          : undefined;
      return done.tx;
    },
    (c) => ({
      ...setProps(c, tableId, { rows: rows + 1, cols }),
      selectionAfter: caretIn(firstCell),
    }),
  ]);
}

/** An empty cell at `index` (the end by default) in every row. */
export function addColumn(
  ctx: CommandContext,
  tableId: BlockId,
  index?: number,
): Transaction | null {
  const { rows, cols } = tableShape(ctx.doc, tableId);
  const at = index ?? cols;
  const rowIds = getBlock(ctx.doc, tableId).children.filter(
    (id) => ctx.doc.blocks[id]?.type === ROW,
  );
  let firstCell: BlockId | undefined;
  return composeCommands(ctx, [
    ...rowIds.map((rowId, r) => (c: CommandContext) => {
      const done = insertAt(c, rowId, at, [cell()]);
      if (r === 0) firstCell = done?.ids[0];
      return done?.tx ?? null;
    }),
    (c) => ({
      ...setProps(c, tableId, { rows, cols: cols + 1 }),
      selectionAfter: caretIn(firstCell),
    }),
  ]);
}

/** Remove the row `rowId`; a table keeps at least one row. */
export function deleteRow(
  ctx: CommandContext,
  tableId: BlockId,
  rowId: BlockId,
): Transaction | null {
  const { rows, cols } = tableShape(ctx.doc, tableId);
  if (rows <= 1 || ctx.doc.blocks[rowId]?.parent !== tableId) return null;
  return composeCommands(ctx, [
    (c) => removeBlocks(c, [rowId]),
    (c) => setProps(c, tableId, { rows: rows - 1, cols }),
  ]);
}

/** Remove the cell at `index` from every row; a table keeps at least one column. */
export function deleteColumn(
  ctx: CommandContext,
  tableId: BlockId,
  index: number,
): Transaction | null {
  const { rows, cols } = tableShape(ctx.doc, tableId);
  if (cols <= 1 || index < 0 || index >= cols) return null;
  const cells = getBlock(ctx.doc, tableId)
    .children.filter((id) => ctx.doc.blocks[id]?.type === ROW)
    .map((rowId) => getBlock(ctx.doc, rowId).children[index])
    .filter((id): id is BlockId => id !== undefined);
  return composeCommands(ctx, [
    (c) => (cells.length > 0 ? removeBlocks(c, cells) : null),
    (c) => setProps(c, tableId, { rows, cols: cols - 1 }),
  ]);
}

/** Turn the first row into a header, or back. */
export function toggleHeaderRow(ctx: CommandContext, tableId: BlockId): Transaction {
  const table = getBlock(ctx.doc, tableId);
  return setProps(ctx, tableId, { withHeader: table.props.withHeader !== true });
}
