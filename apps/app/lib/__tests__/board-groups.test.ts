import { boardMoveValue, boardSections } from '../board-groups';
import type { DatabaseProperty, DatabaseRow, PropertyValue } from '../types/databases';

const labels = {
  checked: 'Checked',
  unchecked: 'Unchecked',
  unassigned: 'None',
  statusGroup: (id: string) => id,
  reference: (id: string) => `Name ${id}`,
};
const row = (id: string, value: PropertyValue): DatabaseRow => ({
  id,
  workspaceId: 'workspace',
  parentId: null,
  databaseId: 'database',
  title: id,
  icon: null,
  cover: null,
  ownerId: 'owner',
  archived: false,
  order: 0,
  properties: { group: value },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

it.each([
  ['multi_select', 'optionIds'],
  ['person', 'userIds'],
  ['relation', 'pageIds'],
] as const)('groups %s occurrences and moves only the source membership', (type, key) => {
  const property: DatabaseProperty = {
    id: 'group',
    name: 'Group',
    type,
    config: {
      options: [
        { id: 'a', name: 'A', color: 'blue' },
        { id: 'b', name: 'B', color: 'green' },
      ],
    },
  };
  const membership = (ids: string[]): PropertyValue => {
    if (key === 'optionIds') return { optionIds: ids };
    if (key === 'userIds') return { userIds: ids };
    return { pageIds: ids };
  };
  const value = membership(['a', 'b']);
  const item = row('one', value);
  const sections = boardSections(property, [item, item, row('empty', membership([]))], labels);
  const columns = sections.flatMap((section) => section.columns);
  expect(columns.map((column) => column.rows.map((r) => r.id))).toEqual([
    ['one'],
    ['one'],
    ['empty'],
  ]);
  const moved = boardMoveValue(property, value, membership(['a']), membership(['c']));
  expect(moved).toEqual({ [key]: ['b', 'c'] });
  expect(value).toEqual({ [key]: ['a', 'b'] });
  expect(boardMoveValue(property, value, membership(['a']), membership(['b']))).toEqual({
    [key]: ['b'],
  });
  expect(boardMoveValue(property, value, membership(['a']), membership([]))).toEqual({ [key]: [] });
});

it('keeps empty option columns and makes removed option values unassigned', () => {
  const property: DatabaseProperty = {
    id: 'group',
    name: 'Group',
    type: 'select',
    config: { options: [{ id: 'a', name: 'A', color: 'blue' }] },
  };
  const columns = boardSections(property, [row('removed', { optionId: 'gone' })], labels).flatMap(
    (section) => section.columns,
  );
  expect(columns.map((column) => [column.option.name, column.rows.length])).toEqual([
    ['A', 0],
    ['None', 1],
  ]);
});

it('keeps the same person columns across sub-group lanes', () => {
  const property: DatabaseProperty = { id: 'group', name: 'Owner', type: 'person' };
  const columns = boardSections(property, [row('one', { userIds: ['a'] })], {
    ...labels,
    referenceIds: ['a', 'b'],
  }).flatMap((section) => section.columns);
  expect(columns.map((column) => [column.option.name, column.rows.length])).toEqual([
    ['Name a', 1],
    ['Name b', 0],
    ['None', 0],
  ]);
});
