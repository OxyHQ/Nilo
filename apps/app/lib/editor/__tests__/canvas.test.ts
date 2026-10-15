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
import {
  addNote,
  appendToNote,
  frameOf,
  MAX_NOTE_WIDTH,
  MIN_NOTE_WIDTH,
  moveNote,
  NOTE,
  notesInReadingOrder,
  removeNote,
  resizeNote,
  toCanvas,
  toDocument,
} from '../canvas';
import { NILO_SCHEMA } from '../schema';

let n = 0;
const newId = () => `id${++n}`;
const doc = (snapshot: BlockSnapshot[]) => documentFromSnapshot(snapshot, newId, NILO_SCHEMA);
const ctx = (d: EditorDocument): CommandContext => ({ doc: d, schema: NILO_SCHEMA, newId });
const p = (text: string): BlockSnapshot => ({ type: 'paragraph', text: [{ text }] });
const note = (x: number, y: number, children: BlockSnapshot[]): BlockSnapshot => ({
  type: NOTE,
  props: { x, y, width: 300 },
  children,
});

/** Apply, checking the result is a valid document the transaction can take back. */
function run(d: EditorDocument, tx: Transaction | null): EditorDocument {
  if (!tx) throw new Error('nothing applied');
  const next = applyTransaction(d, tx);
  expect(validateDocument(next)).toEqual([]);
  expect(applyTransaction(next, invertTransaction(tx))).toEqual(d);
  return next;
}

/** `type:text` lines, children indented. */
function outline(d: EditorDocument): string[] {
  const out: string[] = [];
  const visit = (ids: readonly string[], depth: number) => {
    for (const id of ids) {
      const b = getBlock(d, id);
      out.push(`${'  '.repeat(depth)}${b.type}:${(b.text ?? []).map((s) => s.text).join('')}`);
      visit(b.children, depth + 1);
    }
  };
  visit(d.root, 0);
  return out;
}

it('turns a document into one note at the origin, in order', () => {
  const start = doc([p('a'), { type: 'heading_1', text: [{ text: 'b' }] }, p('c')]);
  const next = run(start, toCanvas(ctx(start)));
  expect(outline(next)).toEqual([`${NOTE}:`, '  paragraph:a', '  heading_1:b', '  paragraph:c']);
  expect(frameOf(next, next.root[0] as string)).toEqual({ x: 0, y: 0, width: 640 });
  // Already a canvas: nothing to do.
  expect(toCanvas(ctx(next))).toBeNull();
});

it('turns notes back into a document, read top to bottom then left to right', () => {
  const start = doc([
    note(400, 0, [p('top right')]),
    note(0, 500, [p('bottom')]),
    note(0, 0, [p('top left'), p('second')]),
  ]);
  expect(notesInReadingOrder(start).map((id) => getBlock(start, id).children.length)).toEqual([
    2, 1, 1,
  ]);
  const next = run(start, toDocument(ctx(start)));
  expect(outline(next)).toEqual([
    'paragraph:top left',
    'paragraph:second',
    'paragraph:top right',
    'paragraph:bottom',
  ]);
  expect(toDocument(ctx(next))).toBeNull();
});

it('goes to a canvas and back without losing or reordering anything', () => {
  const start = doc([p('one'), p('two')]);
  const canvas = run(start, toCanvas(ctx(start)));
  const back = run(canvas, toDocument(ctx(canvas)));
  expect(outline(back)).toEqual(['paragraph:one', 'paragraph:two']);
});

it('adds a note where asked, with the caret in its paragraph', () => {
  const start = doc([note(0, 0, [p('first')])]);
  const tx = addNote(ctx(start), { x: 120.4, y: -80.6 });
  const next = run(start, tx);
  const added = next.root[1] as string;
  expect(frameOf(next, added)).toEqual({ x: 120, y: -81, width: 360 });
  const paragraph = getBlock(next, added).children[0] as string;
  expect(tx?.selectionAfter).toEqual({ kind: 'text', blockId: paragraph, start: 0, end: 0 });
});

it('moves and resizes a note, within bounds, and nothing else', () => {
  const start = doc([note(0, 0, [p('a')]), p('loose')]);
  const id = start.root[0] as string;
  const moved = run(start, moveNote(ctx(start), id, { x: -30.2, y: 99.9 }));
  expect(frameOf(moved, id)).toMatchObject({ x: -30, y: 100 });
  expect(frameOf(run(moved, resizeNote(ctx(moved), id, 10)), id).width).toBe(MIN_NOTE_WIDTH);
  expect(frameOf(run(moved, resizeNote(ctx(moved), id, 99_999)), id).width).toBe(MAX_NOTE_WIDTH);
  expect(moveNote(ctx(start), start.root[1] as string, { x: 0, y: 0 })).toBeNull();
});

it('writes at the end of a note, an emptied one included', () => {
  const start = doc([note(0, 0, [])]);
  const id = start.root[0] as string;
  const next = run(start, appendToNote(ctx(start), id));
  expect(outline(next)).toEqual([`${NOTE}:`, '  paragraph:']);
});

it('takes a note off the canvas with what it holds, and nothing that is not a note', () => {
  const start = doc([note(0, 0, [p('a'), p('b')]), p('loose')]);
  const next = run(start, removeNote(ctx(start), start.root[0] as string));
  expect(outline(next)).toEqual(['paragraph:loose']);
  expect(removeNote(ctx(start), start.root[1] as string)).toBeNull();
});
