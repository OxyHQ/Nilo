import { EditorStore, emptyDocument, insertBlockAfter } from '@oxy.so/bloom-editor/model';
import {
  type RelativeSelection,
  relativeToSelection,
  selectionToRelative,
  YjsBinding,
} from '@oxy.so/bloom-editor/yjs';
import { NILO_SCHEMA } from '@oxy.so/nilo-contracts/editor';
import * as Y from 'yjs';
import {
  collaboratorColor,
  collaboratorDecorations,
  collaboratorTint,
  redrawOnChange,
  withCommentDecorations,
} from '../presence';

const colors = Object.fromEntries(
  ['blue', 'purple', 'green', 'orange', 'pink', 'red'].map((name) => [
    name,
    { text: `theme-${name}` },
  ]),
);
const nameOf = (id: string) => `Name ${id}`;

it('excludes self and unfocused collaborators, uses the avatar color and name', () => {
  const result = collaboratorDecorations(
    [
      { userId: 'self', blockId: 'self-block' },
      { userId: 'away', blockId: null },
      { userId: 'ana', blockId: 'a' },
    ],
    'self',
    colors,
    nameOf,
  );
  expect([...result]).toEqual([
    ['a', { color: collaboratorColor('ana', colors), label: 'Name ana' }],
  ]);
  expect(Object.values(colors).map((color) => color.text)).toContain(result.get('a')?.color);
});
it('is stable across room ordering and combines coincident carets without duplicate labels', () => {
  const people = [
    { userId: 'zoe', blockId: 'a' },
    { userId: 'ana', blockId: 'a' },
    { userId: 'ana', blockId: 'a' },
  ];
  const first = collaboratorDecorations(people, 'self', colors, nameOf);
  const next = collaboratorDecorations([...people].reverse(), 'self', colors, nameOf, first);
  expect(next.get('a')).toBe(first.get('a'));
  expect(next.get('a')?.label).toBe('Name ana, Name zoe');
  expect(next.get('a')?.color).toBe(collaboratorColor('ana', colors));
});
it('removes departed/moved carets and preserves unchanged decoration references', () => {
  const first = collaboratorDecorations(
    [
      { userId: 'ana', blockId: 'a' },
      { userId: 'zoe', blockId: 'b' },
    ],
    'self',
    colors,
    nameOf,
  );
  const next = collaboratorDecorations(
    [
      { userId: 'ana', blockId: 'a' },
      { userId: 'zoe', blockId: 'c' },
    ],
    'self',
    colors,
    nameOf,
    first,
  );
  expect(next.has('b')).toBe(false);
  expect(next.get('a')).toBe(first.get('a'));
  expect(next.get('c')).toEqual(first.get('b'));
  expect(collaboratorDecorations([], 'self', colors, nameOf, next).size).toBe(0);
});
it('updates the named theme color when the theme changes', () => {
  const dark = Object.fromEntries(
    Object.keys(colors).map((name) => [name, { text: `dark-${name}` }]),
  );
  const people = [{ userId: 'ana', blockId: 'a' }];
  const first = collaboratorDecorations(people, 'self', colors, nameOf);
  const next = collaboratorDecorations(people, 'self', dark, nameOf, first);
  expect(next.get('a')?.color).toBe(collaboratorColor('ana', dark));
  expect(next.get('a')).not.toBe(first.get('a'));
});
it('marks blocks with open comments, a caret winning where both are, kept while unchanged', () => {
  const carets = collaboratorDecorations([{ userId: 'ana', blockId: 'a' }], 'self', colors, nameOf);
  const counts = new Map([
    ['a', 1],
    ['b', 2],
    ['c', 0],
  ]);
  const label = (count: number) => `${count} comments`;
  const first = withCommentDecorations(carets, counts, 'yellow', label);
  expect([...first]).toEqual([
    ['a', carets.get('a')],
    ['b', { color: 'yellow', label: '2 comments' }],
  ]);
  const again = withCommentDecorations(carets, counts, 'yellow', label, first);
  expect(again.get('b')).toBe(first.get('b'));
  const more = withCommentDecorations(carets, new Map([['b', 3]]), 'yellow', label, first);
  expect(more.get('b')).toEqual({ color: 'yellow', label: '3 comments' });
});

describe('selections in the text', () => {
  const tinted = Object.fromEntries(
    Object.keys(colors).map((name) => [
      name,
      { text: `theme-${name}`, background: `tint-${name}` },
    ]),
  );

  function page(text: string) {
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
    store.run((ctx) => insertBlockAfter(ctx, null, 'paragraph', { text: [{ text }] }));
    const blockId = store.doc.root.find((id) => store.doc.blocks[id]?.text?.[0]?.text === text);
    return { store, doc, binding, blockId: blockId as string };
  }

  it('draws a selection and caret where it is now, the edge only when it cannot be placed', () => {
    const { store, doc, binding, blockId } = page('Hello world');
    const selection = selectionToRelative(doc, { blockId, start: 6, end: 11 });
    const locate = (s: RelativeSelection) => relativeToSelection(doc, s);
    const people = [
      { userId: 'ana', blockId, selection },
      { userId: 'zoe', blockId, selection: null },
    ];
    const first = collaboratorDecorations(people, 'self', tinted, nameOf, new Map(), locate);
    expect(first.get(blockId)).toEqual({
      color: collaboratorColor('zoe', tinted),
      label: 'Name zoe, Name ana',
      ranges: [
        {
          start: 6,
          end: 11,
          background: collaboratorTint('ana', tinted),
          caret: { color: collaboratorColor('ana', tinted), label: 'Name ana' },
        },
      ],
    });

    // Someone types before it: it follows the text, a new decoration.
    store.run((ctx) => ({
      ops: [
        {
          kind: 'update',
          id: blockId,
          before: { text: ctx.doc.blocks[blockId]?.text },
          after: { text: [{ text: 'Oh, Hello world' }] },
        },
      ],
    }));
    const moved = collaboratorDecorations(people, 'self', tinted, nameOf, first, locate);
    expect(moved.get(blockId)?.ranges?.[0]).toMatchObject({ start: 10, end: 15 });
    const same = collaboratorDecorations(people, 'self', tinted, nameOf, moved, locate);
    expect(same.get(blockId)).toBe(moved.get(blockId));

    // A caret alone: no shade. A selection that does not resolve: the edge.
    const caret = selectionToRelative(doc, { blockId, start: 2, end: 2 });
    const one = collaboratorDecorations(
      [{ userId: 'ana', blockId, selection: caret }],
      'self',
      tinted,
      nameOf,
      new Map(),
      locate,
    );
    expect(one.get(blockId)?.ranges).toEqual([
      { start: 2, end: 2, caret: { color: collaboratorColor('ana', tinted), label: 'Name ana' } },
    ]);
    expect(one.get(blockId)?.color).toBeUndefined();
    const unplaced = collaboratorDecorations(
      [{ userId: 'ana', blockId, selection }],
      'self',
      tinted,
      nameOf,
      new Map(),
      () => null,
    );
    expect(unplaced.get(blockId)).toEqual({
      color: collaboratorColor('ana', tinted),
      label: 'Name ana',
    });
    binding.dispose();
  });

  it('shades the text of open comments under any collaborator there', () => {
    const caret = { start: 1, end: 3, caret: { color: 'blue', label: 'Ana' } };
    const carets = new Map([['a', { label: 'Ana', ranges: [caret] }]]);
    const label = (count: number) => `${count} comments`;
    const first = withCommentDecorations(
      carets,
      new Map([
        ['a', 1],
        ['b', 1],
      ]),
      'yellow',
      label,
      new Map(),
      [
        { blockId: 'a', start: 4, end: 8 },
        { blockId: 'a', start: 0, end: 2 },
        { blockId: 'b', start: 3, end: 3 },
      ],
      'soft-yellow',
    );
    expect(first.get('a')).toEqual({
      color: 'yellow',
      label: 'Ana',
      ranges: [
        { start: 0, end: 2, background: 'soft-yellow' },
        { start: 4, end: 8, background: 'soft-yellow' },
        caret,
      ],
    });
    // An empty stretch is no highlight.
    expect(first.get('b')).toEqual({ color: 'yellow', label: '1 comments' });
  });
});

it('draws again once per change of the text, after the document has it, not when only the selection moves', async () => {
  let next = 0;
  const store = new EditorStore({
    document: emptyDocument(),
    schema: NILO_SCHEMA,
    newId: () => {
      next += 1;
      return `n${next}`;
    },
  });
  const doc = new Y.Doc();
  const binding = new YjsBinding(store, doc);
  const seen: string[] = [];
  const draw = jest.fn(() => {
    seen.push(
      doc.getMap('blocks').size === Object.keys(store.doc.blocks).length ? 'same' : 'behind',
    );
  });
  const stop = redrawOnChange(store, draw);
  expect(draw).toHaveBeenCalledTimes(1);
  store.run((ctx) => insertBlockAfter(ctx, null, 'paragraph', { text: [{ text: 'A' }] }));
  store.run((ctx) => insertBlockAfter(ctx, null, 'paragraph', { text: [{ text: 'B' }] }));
  expect(draw).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  expect(draw).toHaveBeenCalledTimes(2);
  // The document had the change when it was drawn.
  expect(seen.at(-1)).toBe('same');
  const [first] = store.doc.root as [string];
  store.setSelection({ kind: 'text', blockId: first, start: 0, end: 1 });
  await Promise.resolve();
  expect(draw).toHaveBeenCalledTimes(2);
  store.run((ctx) => insertBlockAfter(ctx, null, 'paragraph', { text: [{ text: 'C' }] }));
  stop();
  await Promise.resolve();
  expect(draw).toHaveBeenCalledTimes(2);
  binding.dispose();
});
