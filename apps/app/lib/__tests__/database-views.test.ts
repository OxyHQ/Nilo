import { runButtonActions } from '../button-actions';
import { formatCalculation } from '../calculations';
import { barLayout, donutArcs, foldSlices, linePath, niceTicks } from '../chart-geometry';
import { uniqueRows } from '../hooks/use-database-rows';
import type { DatabaseProperty, DatabaseRow, DatabaseRowsResponse } from '../types/databases';
import { dateGroupLabel, groupValue, rowSections } from '../view-groups';
import { columnWidth, moveProperty, orderedProperties, placeProperty } from '../view-properties';

jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/api/client', () => ({ __esModule: true, default: {} }));
jest.mock('@/lib/realtime/socket', () => ({}));

const property = (id: string, type: DatabaseProperty['type'] = 'text'): DatabaseProperty => ({
  id,
  name: id,
  type,
});
const database = {
  schema: { properties: ['name', 'a', 'b', 'c'].map((id) => property(id)) },
};
const row = (id: string, groupKey?: string | null): DatabaseRow =>
  ({ id, title: id, properties: {}, ...(groupKey !== undefined && { groupKey }) }) as DatabaseRow;

describe('a view’s property order', () => {
  it('follows the view’s own order, a property it does not name after the rest', () => {
    const ids = (order?: string[]) =>
      orderedProperties(database, { config: order ? { propertyOrder: order } : {} }).map(
        (p) => p.id,
      );
    expect(ids()).toEqual(['name', 'a', 'b', 'c']);
    expect(ids(['c', 'name', 'gone'])).toEqual(['c', 'name', 'a', 'b']);
  });

  it('moves a column among those shown, the hidden ones staying where they were', () => {
    // `b` is hidden: moving `c` left passes over it to land before `a`.
    expect(moveProperty(['name', 'a', 'b', 'c'], ['a', 'c'], 'c', -1)).toEqual([
      'name',
      'c',
      'a',
      'b',
    ]);
    expect(moveProperty(['name', 'a', 'b', 'c'], ['a', 'c'], 'c', 1)).toBeNull();
    expect(placeProperty(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
    expect(placeProperty(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
  });

  it('sizes a column as resized, within bounds, the title wider by default', () => {
    expect(columnWidth({ config: {} }, 'name')).toBe(280);
    expect(columnWidth({ config: {} }, 'a')).toBe(200);
    expect(columnWidth({ config: { columnWidths: { a: 90, b: 5, c: 9000 } } }, 'a')).toBe(90);
    expect(columnWidth({ config: { columnWidths: { b: 5 } } }, 'b')).toBe(60);
    expect(columnWidth({ config: { columnWidths: { c: 9000 } } }, 'c')).toBe(1200);
  });
});

describe('a grouped view’s sections', () => {
  const groups = [
    { key: 'todo', count: 2 },
    { key: 'doing', count: 0 },
    { key: 'done', count: 3 },
    { key: null, count: 1 },
  ];

  it('lists the groups in order with their loaded rows, leaving those not reached yet', () => {
    const rows = [row('1', 'todo'), row('2', 'todo'), row('3', 'done')];
    const partial = rowSections(rows, groups, { complete: false });
    expect(partial.map((s) => [s.key, s.count, s.rows.map((r) => r.id)])).toEqual([
      ['todo', 2, ['1', '2']],
      ['doing', 0, []],
      ['done', 3, ['3']],
    ]);
    const all = rowSections([...rows, row('4', null)], groups, { complete: true });
    expect(all.map((s) => s.key)).toEqual(['todo', 'doing', 'done', null]);
    expect(
      rowSections(rows, groups, { complete: true, hideEmpty: true }).map((s) => s.key),
    ).toEqual(['todo', 'done', null]);
  });

  it('keeps a row once per group it is listed in', () => {
    const page = (rows: DatabaseRow[]) => ({ rows }) as DatabaseRowsResponse;
    const both = [row('x', 'red'), row('x', 'blue')];
    expect(uniqueRows([page(both), page([row('x', 'red')])]).map((r) => r.groupKey)).toEqual([
      'red',
      'blue',
    ]);
    expect(uniqueRows([page([row('y')]), page([row('y')])])).toHaveLength(1);
  });

  it('gives a row added in a group its value, and names a date group by its unit', () => {
    expect(groupValue(property('s', 'select'), 'opt')).toEqual({ optionId: 'opt' });
    expect(groupValue(property('m', 'multi_select'), 'red')).toEqual({ optionIds: ['red'] });
    expect(groupValue(property('c', 'checkbox'), 'false')).toEqual({ checked: false });
    expect(groupValue(property('d', 'date'), '2026-10-01')).toEqual({
      start: '2026-10-01T00:00:00.000Z',
      end: null,
      includeTime: false,
    });
    expect(groupValue(property('s', 'select'), null)).toBeUndefined();
    expect(groupValue(property('by', 'created_by'), 'u1')).toBeUndefined();
    const weekOf = (date: string) => `week of ${date}`;
    expect(dateGroupLabel('2026-10-01', 'month', 'en-US', weekOf)).toBe('October 2026');
    expect(dateGroupLabel('2026-10-05', 'week', 'en-US', weekOf)).toBe('week of Oct 5, 2026');
    expect(dateGroupLabel('2026-01-01', 'year', 'en-US', weekOf)).toBe('2026');
    expect(dateGroupLabel('2026-10-05', 'day', 'en-US', weekOf)).toBe('October 5, 2026');
  });
});

describe('a footer calculation', () => {
  const labels = { days: (n: number) => `${n} days`, hours: (n: number) => `${n} hours` };
  const money: DatabaseProperty = {
    id: 'p',
    name: 'Price',
    type: 'number',
    config: { format: 'currency:USD' },
  };

  it('reads as a count, a percentage, a number in its format, a date or a span', () => {
    expect(formatCalculation('count_all', 1234, property('a'), 'en-US', labels)).toBe('1,234');
    expect(formatCalculation('percent_empty', 12.345, property('a'), 'en-US', labels)).toBe(
      '12.3%',
    );
    expect(formatCalculation('sum', 1500, money, 'en-US', labels)).toBe('$1,500.00');
    expect(formatCalculation('average', 1 / 3, property('n', 'number'), 'en-US', labels)).toBe(
      '0.33',
    );
    expect(
      formatCalculation(
        'earliest',
        Date.UTC(2026, 9, 5),
        { ...property('d', 'date'), config: { dateFormat: 'iso' } },
        'en-US',
        labels,
      ),
    ).toBe('2026-10-05');
    expect(
      formatCalculation('date_range', 4 * 86_400_000, property('d', 'date'), 'en', labels),
    ).toBe('4 days');
    expect(
      formatCalculation('date_range', 3 * 3_600_000, property('d', 'date'), 'en', labels),
    ).toBe('3 hours');
    expect(formatCalculation('min', null, property('n', 'number'), 'en', labels)).toBe('—');
  });
});

describe('a button', () => {
  it('runs its actions in order, the row’s edits in a run written together', async () => {
    const calls: unknown[] = [];
    await runButtonActions(
      [
        { kind: 'set_property', propertyId: 'done', value: { checked: true } },
        { kind: 'set_property', propertyId: 'stage', value: { optionId: 'x' } },
        { kind: 'open_url', url: 'https://example.test' },
        { kind: 'create_row', title: 'Next' },
        { kind: 'create_row', databaseId: 'other' },
      ],
      'db',
      {
        setProperties: async (p) => calls.push(['set', p]),
        openUrl: async (url) => calls.push(['open', url]),
        createRow: async (id, title) => calls.push(['create', id, title]),
      },
    );
    expect(calls).toEqual([
      ['set', { done: { checked: true }, stage: { optionId: 'x' } }],
      ['open', 'https://example.test'],
      ['create', 'db', 'Next'],
      ['create', 'other', undefined],
    ]);
  });

  it('stops at the first action that fails', async () => {
    const open = jest.fn(async () => undefined);
    await expect(
      runButtonActions(
        [{ kind: 'create_row' }, { kind: 'open_url', url: 'https://example.test' }],
        'db',
        {
          setProperties: async () => undefined,
          openUrl: open,
          createRow: async () => {
            throw new Error('no');
          },
        },
      ),
    ).rejects.toThrow('no');
    expect(open).not.toHaveBeenCalled();
  });
});

describe('a chart’s geometry', () => {
  it('rounds its axis and lays bars from the baseline', () => {
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(950, 4)).toEqual([0, 500, 1000]);
    const bars = barLayout([2, 0, 8], { left: 0, top: 0, width: 300, height: 100 }, 8);
    expect(bars.map((b) => Math.round(b.height))).toEqual([25, 0, 100]);
    expect(bars.every((b) => Math.round(b.y + b.height) === 100)).toBe(true);
    expect(linePath([{ x: 0, y: 1 }, null, { x: 2, y: 3 }, { x: 4, y: 5 }])).toBe('M0,1M2,3L4,5');
  });

  it('folds the slices past the palette into one, and draws none for nothing', () => {
    const data = Array.from({ length: 10 }, (_, i) => ({ label: `g${i}`, value: i + 1 }));
    const folded = foldSlices(data, 8, 'Other');
    expect(folded).toHaveLength(8);
    expect(folded.at(-1)).toEqual({ label: 'Other', value: 8 + 9 + 10 });
    const arcs = donutArcs([3, 0, 1], 50, 50, 40, 20);
    expect(arcs[1]).toBeNull();
    expect(arcs.filter(Boolean)).toHaveLength(2);
    expect(donutArcs([0, 0], 50, 50, 40, 20)).toEqual([null, null]);
  });
});
