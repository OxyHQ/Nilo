import { formatNumberValue } from '../number-format';
import { statusGroups } from '../status-groups';
import { movedViews, orderChanges } from '../view-order';
import type { SelectOption } from '../types/databases';

describe('moving a view among its siblings', () => {
  const views = [
    { id: 'a', order: 0 },
    { id: 'b', order: 1 },
    { id: 'c', order: 2 },
  ];

  it('writes the orders that change, and only those', () => {
    const moved = movedViews(views, 'c', 0);
    expect(moved.map((v) => v.id)).toEqual(['c', 'a', 'b']);
    expect(orderChanges(moved)).toEqual([
      { viewId: 'c', order: 0 },
      { viewId: 'a', order: 1 },
      { viewId: 'b', order: 2 },
    ]);
    expect(orderChanges(movedViews(views, 'a', 1))).toEqual([
      { viewId: 'b', order: 0 },
      { viewId: 'a', order: 1 },
    ]);
  });

  it('settles views created with the same order, and stays inside the list', () => {
    const tied = [
      { id: 'a', order: 0 },
      { id: 'b', order: 0 },
    ];
    expect(orderChanges(movedViews(tied, 'b', 5))).toEqual([{ viewId: 'b', order: 1 }]);
    expect(movedViews(tied, 'gone', 0).map((v) => v.id)).toEqual(['a', 'b']);
  });
});

describe('formatNumberValue', () => {
  it('shows a number as its format and precision say', () => {
    expect(formatNumberValue(1234.5, undefined, 'en-US')).toBe('1234.5');
    expect(formatNumberValue(1234.5, { precision: 2 }, 'en-US')).toBe('1234.50');
    expect(formatNumberValue(1234.5, { format: 'number_with_commas' }, 'en-US')).toBe('1,234.5');
    expect(formatNumberValue(1234.5, { format: 'number_with_commas', precision: 0 }, 'en-US')).toBe(
      '1,235',
    );
    expect(formatNumberValue(0.125, { format: 'percent', precision: 1 }, 'en-US')).toBe('12.5%');
    expect(formatNumberValue(3, { format: 'currency:USD' }, 'en-US')).toBe('$3.00');
    expect(formatNumberValue(null, { format: 'percent' }, 'en-US')).toBe('');
  });
});

describe('statusGroups', () => {
  const options: SelectOption[] = [
    { id: 'a', name: 'A', color: 'gray' },
    { id: 'b', name: 'B', color: 'blue' },
    { id: 'c', name: 'C', color: 'green' },
  ];

  it('files every option once, an ungrouped one in To-do, in the options’ order', () => {
    expect(
      statusGroups(options, [
        { id: 'complete', optionIds: ['c', 'b'] },
        { id: 'in_progress', optionIds: ['b'] },
      ]),
    ).toEqual([
      { id: 'todo', optionIds: ['a'] },
      { id: 'in_progress', optionIds: ['b'] },
      { id: 'complete', optionIds: ['c'] },
    ]);
    expect(statusGroups(options, undefined)[0]?.optionIds).toEqual(['a', 'b', 'c']);
  });
});
