import {
  applyTransaction,
  type BlockSnapshot,
  type CommandContext,
  documentFromSnapshot,
  type EditorDocument,
  getBlock,
  invertTransaction,
  type Transaction,
  validateDocument,
} from '@oxy.so/bloom-editor/model';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import { addColumn, addRow, deleteColumn, deleteRow, tableShape, toggleHeaderRow } from '../table';

let n = 0;
const newId = () => `id${++n}`;
const ctx = (d: EditorDocument): CommandContext => ({ doc: d, schema: NILO_SCHEMA, newId });
const cell = (text: string): BlockSnapshot => ({ type: 'table_cell', text: [{ text }] });
const table = (rows: string[][]): EditorDocument =>
  documentFromSnapshot(
    [
      {
        type: 'table',
        props: { rows: rows.length, cols: rows[0]?.length ?? 1, withHeader: false },
        children: rows.map((row) => ({ type: 'table_row', children: row.map(cell) })),
      },
    ],
    newId,
    NILO_SCHEMA,
  );

/** Apply, checking the result is a valid document the transaction can take back. */
function run(d: EditorDocument, tx: Transaction | null): EditorDocument {
  if (!tx) throw new Error('nothing applied');
  const next = applyTransaction(d, tx);
  expect(validateDocument(next)).toEqual([]);
  expect(applyTransaction(next, invertTransaction(tx))).toEqual(d);
  return next;
}

const tableId = (d: EditorDocument) => d.root[0] as string;
/** The grid as text, row by row. */
const grid = (d: EditorDocument) =>
  getBlock(d, tableId(d)).children.map((rowId) =>
    getBlock(d, rowId).children.map((cellId) =>
      (getBlock(d, cellId).text ?? []).map((s) => s.text).join(''),
    ),
  );
const props = (d: EditorDocument) => getBlock(d, tableId(d)).props;

describe('table edits', () => {
  it('adds a row of empty cells at the end or in place, the caret in its first cell', () => {
    const d = table([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    const tx = addRow(ctx(d), tableId(d));
    const end = run(d, tx);
    expect(grid(end)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['', ''],
    ]);
    expect(props(end)).toMatchObject({ rows: 3, cols: 2 });
    const newRow = getBlock(end, tableId(end)).children[2] as string;
    expect(tx?.selectionAfter).toEqual({
      kind: 'text',
      blockId: getBlock(end, newRow).children[0],
      start: 0,
      end: 0,
    });

    const first = run(d, addRow(ctx(d), tableId(d), 0));
    expect(grid(first)).toEqual([
      ['', ''],
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('adds a column to every row, at the end, first, or between', () => {
    const d = table([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(grid(run(d, addColumn(ctx(d), tableId(d))))).toEqual([
      ['a', 'b', ''],
      ['c', 'd', ''],
    ]);
    expect(grid(run(d, addColumn(ctx(d), tableId(d), 0)))).toEqual([
      ['', 'a', 'b'],
      ['', 'c', 'd'],
    ]);
    const between = run(d, addColumn(ctx(d), tableId(d), 1));
    expect(grid(between)).toEqual([
      ['a', '', 'b'],
      ['c', '', 'd'],
    ]);
    expect(props(between)).toMatchObject({ rows: 2, cols: 3 });
  });

  it('deletes a row or a column, and never the last one', () => {
    const d = table([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    const rows = getBlock(d, tableId(d)).children;
    const withoutRow = run(d, deleteRow(ctx(d), tableId(d), rows[0] as string));
    expect(grid(withoutRow)).toEqual([['c', 'd']]);
    expect(props(withoutRow)).toMatchObject({ rows: 1, cols: 2 });
    const lastRow = getBlock(withoutRow, tableId(withoutRow)).children[0] as string;
    expect(deleteRow(ctx(withoutRow), tableId(withoutRow), lastRow)).toBeNull();

    const withoutColumn = run(d, deleteColumn(ctx(d), tableId(d), 0));
    expect(grid(withoutColumn)).toEqual([['b'], ['d']]);
    expect(props(withoutColumn)).toMatchObject({ rows: 2, cols: 1 });
    expect(deleteColumn(ctx(withoutColumn), tableId(withoutColumn), 0)).toBeNull();
    expect(deleteColumn(ctx(d), tableId(d), 5)).toBeNull();
  });

  it('refuses to delete a row of another table', () => {
    const d = table([['a'], ['b']]);
    const other = table([['x'], ['y']]);
    const foreign = getBlock(other, tableId(other)).children[0] as string;
    expect(deleteRow(ctx(d), tableId(d), foreign)).toBeNull();
  });

  it('turns the header row on and off', () => {
    const d = table([['a'], ['b']]);
    const on = run(d, toggleHeaderRow(ctx(d), tableId(d)));
    expect(props(on).withHeader).toBe(true);
    expect(props(run(on, toggleHeaderRow(ctx(on), tableId(on)))).withHeader).toBe(false);
  });

  it('counts its shape from its blocks when the stated one is behind', () => {
    const d = documentFromSnapshot(
      [
        {
          type: 'table',
          props: { rows: 1, cols: 1 },
          children: [{ type: 'table_row', children: [cell('a'), cell('b'), cell('c')] }],
        },
      ],
      newId,
      NILO_SCHEMA,
    );
    expect(tableShape(d, tableId(d))).toEqual({ rows: 1, cols: 3 });
    expect(grid(run(d, addRow(ctx(d), tableId(d))))).toEqual([
      ['a', 'b', 'c'],
      ['', '', ''],
    ]);
  });
});
