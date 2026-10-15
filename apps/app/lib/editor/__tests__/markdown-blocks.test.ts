import {
  applyTransaction,
  type CommandContext,
  documentFromSnapshot,
  type EditorDocument,
  getBlock,
  invertTransaction,
  type Transaction,
  validateDocument,
} from '@oxy.so/bloom-editor/model';
import {
  blocksToMarkdownText,
  insertMarkdownAfter,
  insertMarkdownAtTop,
  markdownToSnapshot,
  replaceWithMarkdown,
} from '../markdown-blocks';
import { NILO_SCHEMA } from '../schema';

let n = 0;
const newId = () => `id${++n}`;
const doc = (texts: string[]) =>
  documentFromSnapshot(
    texts.map((text) => ({ type: 'paragraph', text: [{ text }] })),
    newId,
    NILO_SCHEMA,
  );
const ctx = (d: EditorDocument): CommandContext => ({ doc: d, schema: NILO_SCHEMA, newId });
function run(d: EditorDocument, tx: Transaction | null): EditorDocument {
  if (!tx) throw new Error('nothing applied');
  const next = applyTransaction(d, tx);
  expect(validateDocument(next)).toEqual([]);
  expect(applyTransaction(next, invertTransaction(tx))).toEqual(d);
  return next;
}
const outline = (d: EditorDocument) =>
  d.root.map((id) => {
    const b = getBlock(d, id);
    return `${b.type}:${(b.text ?? []).map((s) => s.text).join('')}`;
  });

it('reads Markdown as the blocks the API would store, formatting included', () => {
  const snapshot = markdownToSnapshot('# Plan\n\nSome **bold** text\n\n- [x] done\n- [ ] next');
  expect(snapshot.map((b) => b.type)).toEqual(['heading_1', 'paragraph', 'todo', 'todo']);
  expect(snapshot[1]?.text).toEqual([
    { text: 'Some ' },
    { text: 'bold', bold: true },
    { text: ' text' },
  ]);
  expect(snapshot[2]?.props).toMatchObject({ checked: true });
});

it('writes blocks out as Markdown', () => {
  const d = doc(['one', 'two']);
  expect(blocksToMarkdownText(d, d.root).trim().split(/\n+/)).toEqual(['one', 'two']);
});

it('replaces a block with what the Markdown says, as one step', () => {
  const start = doc(['before', 'old', 'after']);
  const next = run(
    start,
    replaceWithMarkdown(ctx(start), start.root[1] as string, 'New\n\n- item'),
  );
  expect(outline(next)).toEqual([
    'paragraph:before',
    'paragraph:New',
    'bulleted_list_item:item',
    'paragraph:after',
  ]);
  expect(replaceWithMarkdown(ctx(start), start.root[1] as string, '   ')).toBeNull();
});

it('inserts below a block, and at the top of the page', () => {
  const start = doc(['a', 'b']);
  const below = run(start, insertMarkdownAfter(ctx(start), start.root[0] as string, 'x'));
  expect(outline(below)).toEqual(['paragraph:a', 'paragraph:x', 'paragraph:b']);
  const top = run(start, insertMarkdownAtTop(ctx(start), '## Summary\n\ntext'));
  expect(outline(top)).toEqual([
    'heading_2:Summary',
    'paragraph:text',
    'paragraph:a',
    'paragraph:b',
  ]);
  const empty = documentFromSnapshot([], newId, NILO_SCHEMA);
  expect(outline(run(empty, insertMarkdownAtTop(ctx(empty), 'only')))).toEqual(['paragraph:only']);
});
