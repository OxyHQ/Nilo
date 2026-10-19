import { collaboratorColor, collaboratorDecorations, withCommentDecorations } from '../presence';

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
