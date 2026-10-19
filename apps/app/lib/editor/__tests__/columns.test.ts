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
import {
  addColumn,
  columnIds,
  columnShares,
  MAX_COLUMNS,
  MIN_RATIO,
  removeColumn,
  resizeShares,
  setColumnShares,
  sharesOf,
} from '../columns';

let n = 0;
const newId = () => `id${++n}`;
const ctx = (d: EditorDocument): CommandContext => ({ doc: d, schema: NILO_SCHEMA, newId });
const p = (text: string): BlockSnapshot => ({ type: 'paragraph', text: [{ text }] });
const layout = (columns: string[][], ratios?: number[]): EditorDocument =>
  documentFromSnapshot(
    [
      p('before'),
      {
        type: 'columns',
        props: { columnCount: columns.length },
        children: columns.map((texts, i) => ({
          type: 'column',
          props: ratios ? { ratio: ratios[i] } : {},
          children: texts.map(p),
        })),
      },
      p('after'),
    ],
    newId,
    NILO_SCHEMA,
  );

function run(d: EditorDocument, tx: Transaction | null): EditorDocument {
  if (!tx) throw new Error('nothing applied');
  const next = applyTransaction(d, tx);
  expect(validateDocument(next)).toEqual([]);
  expect(applyTransaction(next, invertTransaction(tx))).toEqual(d);
  return next;
}

const columnsId = (d: EditorDocument) => d.root[1] as string;
const text = (d: EditorDocument, id: string) =>
  (getBlock(d, id).text ?? []).map((s) => s.text).join('');
const contents = (d: EditorDocument) =>
  columnIds(d, columnsId(d)).map((id) => getBlock(d, id).children.map((c) => text(d, c)));
const close = (values: number[]) => values.map((v) => Math.round(v * 1000) / 1000);

describe('column shares', () => {
  it('splits evenly without ratios, fills the rest, and scales what does not add up', () => {
    expect(columnShares([undefined, undefined])).toEqual([0.5, 0.5]);
    expect(close(columnShares([0.5, undefined, undefined]))).toEqual([0.5, 0.25, 0.25]);
    expect(close(columnShares([0.6, 0.6]))).toEqual([0.5, 0.5]);
    expect(close(columnShares([1, undefined]))).toEqual([0.667, 0.333]);
    expect(columnShares([])).toEqual([]);
  });

  it('trades width between the two columns at a divider, neither under the minimum', () => {
    expect(close(resizeShares([0.5, 0.5], 0, 0.2))).toEqual([0.7, 0.3]);
    expect(close(resizeShares([0.5, 0.5], 0, 0.9))).toEqual([1 - MIN_RATIO, MIN_RATIO]);
    expect(close(resizeShares([0.25, 0.25, 0.5], 1, -0.5))).toEqual([0.25, MIN_RATIO, 0.65]);
    expect(resizeShares([0.5, 0.5], 1, 0.1)).toEqual([0.5, 0.5]);
  });

  it('stores the shares a drag ended at on every column', () => {
    const d = layout([['a'], ['b']]);
    const next = run(d, setColumnShares(ctx(d), columnsId(d), [0.3, 0.7]));
    expect(columnIds(next, columnsId(next)).map((id) => getBlock(next, id).props.ratio)).toEqual([
      0.3, 0.7,
    ]);
    expect(setColumnShares(ctx(d), columnsId(d), [1])).toBeNull();
  });
});

describe('column edits', () => {
  it('adds an empty column after one, the others making room, the caret in it', () => {
    const d = layout([['a'], ['b']]);
    const tx = addColumn(ctx(d), columnsId(d), 0);
    const next = run(d, tx);
    expect(contents(next)).toEqual([['a'], [''], ['b']]);
    expect(close(sharesOf(next, columnsId(next)))).toEqual([0.333, 0.333, 0.333]);
    expect(getBlock(next, columnsId(next)).props.columnCount).toBe(3);
    const added = columnIds(next, columnsId(next))[1] as string;
    expect(tx?.selectionAfter).toMatchObject({
      kind: 'text',
      blockId: getBlock(next, added).children[0],
    });
  });

  it('adds a column first', () => {
    const d = layout([['a'], ['b']], [0.7, 0.3]);
    const next = run(d, addColumn(ctx(d), columnsId(d), -1));
    expect(contents(next)).toEqual([[''], ['a'], ['b']]);
    expect(close(sharesOf(next, columnsId(next)))).toEqual([0.333, 0.467, 0.2]);
  });

  it('adds no column past the most a layout holds', () => {
    const d = layout(Array.from({ length: MAX_COLUMNS }, (_, i) => [`c${i}`]));
    expect(addColumn(ctx(d), columnsId(d), 0)).toBeNull();
  });

  it('removes a column, its blocks and width going to the one before', () => {
    const d = layout([['a'], ['b1', 'b2'], ['c']], [0.25, 0.25, 0.5]);
    const middle = columnIds(d, columnsId(d))[1] as string;
    const next = run(d, removeColumn(ctx(d), columnsId(d), middle));
    expect(contents(next)).toEqual([['a', 'b1', 'b2'], ['c']]);
    expect(close(sharesOf(next, columnsId(next)))).toEqual([0.5, 0.5]);
    expect(getBlock(next, columnsId(next)).props.columnCount).toBe(2);
  });

  it('removes the first column into the start of the next, keeping the reading order', () => {
    const d = layout([['a1', 'a2'], ['b'], ['c']]);
    const first = columnIds(d, columnsId(d))[0] as string;
    const next = run(d, removeColumn(ctx(d), columnsId(d), first));
    expect(contents(next)).toEqual([['a1', 'a2', 'b'], ['c']]);
  });

  it('unwraps a layout left with one column: its blocks take its place', () => {
    const d = layout([['a1', 'a2'], ['b']]);
    const second = columnIds(d, columnsId(d))[1] as string;
    const next = run(d, removeColumn(ctx(d), columnsId(d), second));
    expect(next.root.map((id) => getBlock(next, id).type)).toEqual([
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
    ]);
    expect(next.root.map((id) => text(next, id))).toEqual(['before', 'a1', 'a2', 'b', 'after']);
  });
});
