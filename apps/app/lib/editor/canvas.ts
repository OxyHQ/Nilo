/**
 * A canvas page (`pages.mode = 'canvas'`): its top-level blocks are notes
 * (`canvas_note`), each holding its own blocks at `x`, `y` with a `width`, on
 * an infinite surface. These are the edits that make and keep one; each is
 * one transaction, so one undo step, and syncs like any other edit.
 */
import {
  appendChild,
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
import { markdownToSnapshot } from './markdown-blocks';

export const NOTE = 'canvas_note';
export const NOTE_WIDTH = 360;
export const MIN_NOTE_WIDTH = 160;
export const MAX_NOTE_WIDTH = 2400;
/** Where a document turned into a canvas starts, and how wide. */
const FIRST_NOTE = { x: 0, y: 0, width: 640 };

export interface NoteFrame {
  x: number;
  y: number;
  width: number;
}

const number = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Where a note sits; defaults for one that says nothing. */
export function frameOf(doc: EditorDocument, id: BlockId): NoteFrame {
  const props = getBlock(doc, id).props;
  return {
    x: number(props.x, 0),
    y: number(props.y, 0),
    width: Math.min(MAX_NOTE_WIDTH, Math.max(MIN_NOTE_WIDTH, number(props.width, NOTE_WIDTH))),
  };
}

export const isNote = (doc: EditorDocument, id: BlockId) => doc.blocks[id]?.type === NOTE;

/** Notes in reading order: top to bottom, then left to right. */
export function notesInReadingOrder(doc: EditorDocument): BlockId[] {
  return doc.root
    .filter((id) => isNote(doc, id))
    .map((id) => ({ id, ...frameOf(doc, id) }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((note) => note.id);
}

/** A new note at `x`, `y` with an empty paragraph, the caret in it. */
export function addNote(ctx: CommandContext, at: { x: number; y: number }): Transaction | null {
  const last = ctx.doc.root[ctx.doc.root.length - 1] ?? null;
  const tx = insertSnapshot(
    ctx.doc,
    [
      {
        type: NOTE,
        props: { x: Math.round(at.x), y: Math.round(at.y), width: NOTE_WIDTH },
        children: [{ type: 'paragraph', text: [] }],
      },
    ],
    last,
    ctx.newId,
    ctx.schema,
  );
  if (!tx) return null;
  const inserted = tx.ops.find((op) => op.kind === 'insert');
  const paragraph =
    inserted?.kind === 'insert' ? inserted.blocks.find((b) => b.type === 'paragraph') : undefined;
  return paragraph
    ? { ...tx, selectionAfter: { kind: 'text', blockId: paragraph.id, start: 0, end: 0 } }
    : tx;
}

/** Put a note somewhere else. */
export function moveNote(
  ctx: CommandContext,
  id: BlockId,
  to: { x: number; y: number },
): Transaction | null {
  if (!isNote(ctx.doc, id)) return null;
  return setProps(ctx, id, { x: Math.round(to.x), y: Math.round(to.y) });
}

/** Make a note wider or narrower, within bounds. */
export function resizeNote(ctx: CommandContext, id: BlockId, width: number): Transaction | null {
  if (!isNote(ctx.doc, id)) return null;
  const bounded = Math.round(Math.min(MAX_NOTE_WIDTH, Math.max(MIN_NOTE_WIDTH, width)));
  return setProps(ctx, id, { width: bounded });
}

/** Take a note off the canvas, with everything in it. */
export function removeNote(ctx: CommandContext, id: BlockId): Transaction | null {
  return isNote(ctx.doc, id) ? removeBlocks(ctx, [id]) : null;
}

/** A paragraph at the end of a note (an empty one included), the caret in it. */
export function appendToNote(ctx: CommandContext, id: BlockId): Transaction | null {
  return isNote(ctx.doc, id) ? appendChild(ctx, id, 'paragraph') : null;
}

/**
 * The page as a canvas: whatever is not in a note yet goes into one at the
 * origin, in order; notes stay where they are. Null when there is nothing to
 * move.
 */
export function toCanvas(ctx: CommandContext): Transaction | null {
  const loose = ctx.doc.root.filter((id) => !isNote(ctx.doc, id));
  if (loose.length === 0) return null;
  let note: BlockId | null = null;
  return composeCommands(ctx, [
    (c) => {
      const tx = insertSnapshot(
        c.doc,
        [{ type: NOTE, props: { ...FIRST_NOTE } }],
        null,
        c.newId,
        c.schema,
      );
      const op = tx?.ops[0];
      note = op?.kind === 'insert' ? (op.blocks[0]?.id ?? null) : null;
      return tx;
    },
    (c) => (note ? moveBlocks(c, loose, note, 'inside') : null),
  ]);
}

/**
 * The page as a document: each note's blocks in its place, notes read top to
 * bottom then left to right, and the notes gone. Null when there are none.
 */
export function toDocument(ctx: CommandContext): Transaction | null {
  const notes = notesInReadingOrder(ctx.doc);
  if (notes.length === 0) return null;
  return composeCommands(ctx, [
    ...notes.map((note) => (c: CommandContext) => {
      const children = getBlock(c.doc, note).children;
      const last = c.doc.root[c.doc.root.length - 1];
      if (children.length === 0 || !last) return null;
      return moveBlocks(c, children, last, 'after');
    }),
    (c) => removeBlocks(c, notes),
  ]);
}

/**
 * Markdown as a new note above the others (a summary of the page), so a
 * canvas shows it. Null for empty Markdown.
 */
export function insertMarkdownAsNote(ctx: CommandContext, markdown: string): Transaction | null {
  const children = markdownToSnapshot(markdown);
  if (children.length === 0) return null;
  const notes = ctx.doc.root.filter((id) => isNote(ctx.doc, id)).map((id) => frameOf(ctx.doc, id));
  const at = notes.length
    ? { x: Math.min(...notes.map((f) => f.x)), y: Math.min(...notes.map((f) => f.y)) - 280 }
    : { x: 0, y: 0 };
  const last = ctx.doc.root[ctx.doc.root.length - 1] ?? null;
  return insertSnapshot(
    ctx.doc,
    [
      {
        type: NOTE,
        props: { x: Math.round(at.x), y: Math.round(at.y), width: NOTE_WIDTH },
        children,
      },
    ],
    last,
    ctx.newId,
    ctx.schema,
  );
}
