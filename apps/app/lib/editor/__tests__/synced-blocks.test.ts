import { type BlockSnapshot, documentFromSnapshot, EditorStore } from '@oxy.so/bloom-editor';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import {
  isSyncedOriginal,
  newSyncedOriginal,
  referenceOf,
  originalsWithin,
  pastedSyncedReference,
  syncedClipboard,
  syncedReference,
  syncedSourceFor,
  unsyncReference,
} from '../synced-blocks';

let ids = 0;
const newId = () => {
  ids += 1;
  return `b${ids}`;
};

const storeOf = (snapshot: BlockSnapshot[]) =>
  new EditorStore({
    document: documentFromSnapshot(snapshot, newId, NILO_SCHEMA),
    schema: NILO_SCHEMA,
    newId,
  });

const para = (text: string): BlockSnapshot => ({ type: 'paragraph', text: [{ text }] });
const outline = (store: EditorStore, ids = store.doc.root): unknown[] =>
  ids.map((id) => {
    const block = store.doc.blocks[id];
    const label = block?.text ? block.text.map((s) => s.text).join('') : block?.type;
    return block?.children.length ? [label, outline(store, block.children)] : label;
  });

describe('copy and sync', () => {
  it('wraps a block in a new original where it stood, as one undo step', () => {
    const store = storeOf([para('Before'), para('Me'), para('After')]);
    const me = store.doc.root[1] as string;
    const source = syncedSourceFor(store, 'page-1', me);
    expect(source?.pageId).toBe('page-1');
    expect(outline(store)).toEqual(['Before', ['sync_block', ['Me']], 'After']);
    expect(store.doc.root[1]).toBe(source?.blockId);
    expect(isSyncedOriginal(store.doc.blocks[source?.blockId as string])).toBe(true);
    store.undo();
    expect(outline(store)).toEqual(['Before', 'Me', 'After']);
  });

  it('copies an original as itself, and a reference as its original', () => {
    const store = storeOf([
      newSyncedOriginal(),
      syncedReference({ blockId: 'elsewhere', pageId: 'other-page' }),
    ]);
    const [original, reference] = store.doc.root as [string, string];
    expect(syncedSourceFor(store, 'here', original)).toEqual({ blockId: original, pageId: 'here' });
    expect(syncedSourceFor(store, 'here', reference)).toEqual({
      blockId: 'elsewhere',
      pageId: 'other-page',
    });
    expect(referenceOf(store.doc.blocks[reference])).toEqual({
      blockId: 'elsewhere',
      pageId: 'other-page',
    });
    expect(referenceOf(store.doc.blocks[original])).toBeNull();
  });

  it('leaves a block that is part of its container’s layout alone', () => {
    const store = storeOf([
      {
        type: 'columns',
        props: { columnCount: 2 },
        children: [
          { type: 'column', children: [para('A')] },
          { type: 'column', children: [para('B')] },
        ],
      },
    ]);
    const column = store.doc.blocks[store.doc.root[0] as string]?.children[0] as string;
    expect(syncedSourceFor(store, 'here', column)).toBeNull();
    expect(store.getSnapshot().canUndo).toBe(false);
  });
});

describe('unsync', () => {
  it('puts a copy of the original’s blocks in the reference’s place', () => {
    const source = storeOf([{ type: 'sync_block', children: [para('One'), para('Two')] }]);
    const originalId = source.doc.root[0] as string;
    const host = storeOf([
      para('Top'),
      syncedReference({ blockId: originalId, pageId: 'p' }),
      para('End'),
    ]);
    const reference = host.doc.root[1] as string;
    host.run((c) => unsyncReference(c, reference, source.doc, originalId));
    expect(outline(host)).toEqual(['Top', 'One', 'Two', 'End']);
    // Copies, not the original's blocks.
    for (const id of host.doc.root) expect(source.doc.blocks[id]).toBeUndefined();
  });

  it('removes a reference whose original is gone', () => {
    const host = storeOf([syncedReference({ blockId: 'gone', pageId: 'p' }), para('End')]);
    const empty = storeOf([]);
    host.run((c) => unsyncReference(c, host.doc.root[0] as string, empty.doc, 'gone'));
    expect(outline(host)).toEqual(['End']);
  });
});

it('tells which originals removing blocks would take, inside them too', () => {
  const store = storeOf([
    { type: 'toggle', text: [{ text: 'T' }], children: [newSyncedOriginal()] },
    syncedReference({ blockId: 'x', pageId: 'p' }),
    newSyncedOriginal(),
  ]);
  const [toggle, reference, second] = store.doc.root as [string, string, string];
  const nested = store.doc.blocks[toggle]?.children[0];
  expect(originalsWithin(store.doc, [toggle, reference])).toEqual([nested]);
  expect(originalsWithin(store.doc, [reference])).toEqual([]);
  expect(originalsWithin(store.doc, [second, toggle, 'gone'])).toEqual([second, nested]);
});

describe('pasting what "Copy and sync" copied', () => {
  const linkOf = (ref: { pageId: string; blockId: string }) =>
    `https://nilo.test/p/${ref.pageId}?blockId=${ref.blockId}`;

  it('is a reference to the original when the text is its link', () => {
    const store = storeOf([para('Here')]);
    const target = store.doc.root[0] as string;
    const copied = { blockId: 'orig', pageId: 'other' };
    expect(
      pastedSyncedReference(store.doc, 'page', target, ` ${linkOf(copied)}\n`, copied, linkOf),
    ).toEqual(syncedReference(copied));
  });

  it('is nothing for other text, nothing copied, or inside the original itself', () => {
    const store = storeOf([newSyncedOriginal(), para('Outside')]);
    const [original, outside] = store.doc.root as [string, string];
    const inside = store.doc.blocks[original]?.children[0] as string;
    const copied = { blockId: original, pageId: 'page' };
    const link = linkOf(copied);
    expect(pastedSyncedReference(store.doc, 'page', outside, 'hello', copied, linkOf)).toBeNull();
    expect(pastedSyncedReference(store.doc, 'page', outside, link, null, linkOf)).toBeNull();
    expect(pastedSyncedReference(store.doc, 'page', inside, link, copied, linkOf)).toBeNull();
    expect(pastedSyncedReference(store.doc, 'page', outside, link, copied, linkOf)).toEqual(
      syncedReference(copied),
    );
  });
});

it('keeps what was copied for pasting, and says when it changes', () => {
  const heard = jest.fn();
  const stop = syncedClipboard.subscribe(heard);
  syncedClipboard.set({ blockId: 'a', pageId: 'p' });
  expect(syncedClipboard.get()).toEqual({ blockId: 'a', pageId: 'p' });
  expect(heard).toHaveBeenCalledTimes(1);
  stop();
  syncedClipboard.set(null);
  expect(heard).toHaveBeenCalledTimes(1);
});
