import { randomUUID } from 'node:crypto';
import { EditorStore, emptyDocument, insertBlockAfter } from '@oxy.so/bloom-editor/model';
import { relativeToSelection, selectionToRelative, YjsBinding } from '@oxy.so/bloom-editor/yjs';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { readPageSelection } from './page-selection.js';

const BLOCK = '0192f0c4-7d4e-7c2a-9b1e-3f5a6b7c8d9e';

/** A document with one paragraph reading `text`, as an editor writes it. */
function docWith(text: string): { doc: Y.Doc; blockId: string } {
  const doc = new Y.Doc();
  const store = new EditorStore({
    document: emptyDocument(),
    schema: NILO_SCHEMA,
    newId: randomUUID,
  });
  const binding = new YjsBinding(store, doc);
  store.run((ctx) => insertBlockAfter(ctx, null, 'paragraph', { text: [{ text }] }));
  const blockId = store.doc.root.find((id) => store.doc.blocks[id]?.text?.[0]?.text === text);
  binding.dispose();
  return { doc, blockId: blockId as string };
}

describe('readPageSelection', () => {
  it('passes on what Bloom broadcasts, and it still resolves', () => {
    const { doc, blockId } = docWith('Hello world');
    const relative = selectionToRelative(doc, { blockId, start: 6, end: 11 });
    // Through the wire: plain JSON.
    const read = readPageSelection(JSON.parse(JSON.stringify(relative)), blockId);
    expect(read).toEqual(JSON.parse(JSON.stringify(relative)));
    expect(relativeToSelection(doc, read as never)).toEqual({ blockId, start: 6, end: 11 });
    const caret = selectionToRelative(doc, { blockId, start: 0, end: 0 });
    expect(readPageSelection(JSON.parse(JSON.stringify(caret)), blockId)).not.toBeNull();
  });

  it('keeps only the fields of a relative position', () => {
    const position = { type: { client: 1, clock: 2 }, item: { client: 3, clock: 4 }, assoc: -1 };
    expect(readPageSelection({ blockId: BLOCK, start: position, end: position }, BLOCK)).toEqual({
      blockId: BLOCK,
      start: position,
      end: position,
    });
    const named = { tname: 'blocks', assoc: 0 };
    expect(readPageSelection({ blockId: BLOCK, start: named, end: named }, BLOCK)?.start).toEqual(
      named,
    );
  });

  it('refuses anything else', () => {
    const ok = { type: { client: 1, clock: 2 }, assoc: 0 };
    const refused: unknown[] = [
      null,
      'selection',
      [ok, ok],
      { blockId: BLOCK, start: ok },
      { blockId: 'other', start: ok, end: ok },
      { blockId: BLOCK, start: ok, end: ok, extra: true },
      { blockId: BLOCK, start: { ...ok, extra: 'x'.repeat(10_000) }, end: ok },
      { blockId: BLOCK, start: { assoc: 0 }, end: ok },
      { blockId: BLOCK, start: { type: { client: -1, clock: 0 } }, end: ok },
      { blockId: BLOCK, start: { type: { client: 1.5, clock: 0 } }, end: ok },
      { blockId: BLOCK, start: { type: { client: 1, clock: 0, more: 1 } }, end: ok },
      { blockId: BLOCK, start: { tname: 'x'.repeat(65) }, end: ok },
      { blockId: BLOCK, start: { ...ok, assoc: 2 ** 40 }, end: ok },
      { blockId: BLOCK, start: { ...ok, item: 'item' }, end: ok },
    ];
    for (const value of refused) expect(readPageSelection(value, BLOCK)).toBeNull();
    // A selection is in the block focused, never without one.
    expect(readPageSelection({ blockId: BLOCK, start: ok, end: ok }, null)).toBeNull();
  });
});
