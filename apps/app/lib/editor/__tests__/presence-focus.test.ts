import { EditorStore, emptyDocument, insertBlockAfter } from '@oxy.so/bloom-editor/model';
import { relativeToSelection, YjsBinding } from '@oxy.so/bloom-editor/yjs';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import * as Y from 'yjs';
import { SELECTION_BROADCAST_MS, tellFocus } from '../presence-focus';

let clock = 0;
const now = () => clock;

function page() {
  let next = 0;
  const store = new EditorStore({
    document: emptyDocument(),
    schema: NILO_SCHEMA,
    newId: () => {
      next += 1;
      return `b${next}`;
    },
  });
  const doc = new Y.Doc();
  const binding = new YjsBinding(store, doc);
  store.run((ctx) => insertBlockAfter(ctx, null, 'paragraph', { text: [{ text: 'Hello world' }] }));
  const blockId = store.doc.root.find((id) => store.doc.blocks[id]?.text?.length) as string;
  store.setSelection(null);
  return { store, doc, binding, blockId };
}

beforeEach(() => {
  jest.useFakeTimers();
  clock = 0;
});
afterEach(() => jest.useRealTimers());

const advance = (ms: number) => {
  clock += ms;
  jest.advanceTimersByTime(ms);
};

it('tells the block and the selection as positions that resolve in the document', () => {
  const { store, doc, binding, blockId } = page();
  const emit = jest.fn();
  const stop = tellFocus({ emit }, 'page', store, doc, now);
  store.setSelection({ kind: 'text', blockId, start: 6, end: 11 });
  // Never inside the store's change.
  expect(emit).not.toHaveBeenCalled();
  advance(0);
  expect(emit).toHaveBeenCalledTimes(1);
  const [event, payload] = emit.mock.calls[0];
  expect(event).toBe('page:focus');
  expect(payload).toMatchObject({ pageId: 'page', blockId });
  // Through the wire, then read back on another device's copy of the page.
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  expect(relativeToSelection(copy, JSON.parse(JSON.stringify(payload.selection)))).toEqual({
    blockId,
    start: 6,
    end: 11,
  });
  stop();
  binding.dispose();
});

it('tells a moving selection at most every interval, ending where it settled', () => {
  const { store, doc, binding, blockId } = page();
  const emit = jest.fn();
  const stop = tellFocus({ emit }, 'page', store, doc, now);
  store.setSelection({ kind: 'text', blockId, start: 1, end: 1 });
  advance(0);
  for (let at = 2; at <= 6; at += 1) {
    store.setSelection({ kind: 'text', blockId, start: at, end: at });
    advance(20);
  }
  // One at once, the rest waiting out the interval.
  expect(emit).toHaveBeenCalledTimes(1);
  advance(SELECTION_BROADCAST_MS);
  expect(emit).toHaveBeenCalledTimes(2);
  const last = emit.mock.calls[1][1];
  expect(relativeToSelection(doc, last.selection)).toEqual({ blockId, start: 6, end: 6 });
  // Back where it was told: nothing more to say.
  advance(SELECTION_BROADCAST_MS);
  expect(emit).toHaveBeenCalledTimes(2);

  // Leaving the text: no block.
  store.setSelection(null);
  advance(SELECTION_BROADCAST_MS);
  expect(emit).toHaveBeenLastCalledWith('page:focus', {
    pageId: 'page',
    blockId: null,
    selection: null,
  });
  // Stopped: no more, and nothing left waiting.
  store.setSelection({ kind: 'text', blockId, start: 2, end: 2 });
  stop();
  advance(SELECTION_BROADCAST_MS);
  expect(emit).toHaveBeenCalledTimes(3);
  binding.dispose();
});
