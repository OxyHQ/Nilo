import { describe, expect, it } from 'vitest';
import type { DatabaseProperty } from '../../db/schema/databases.js';
import {
  compareGroupKeys,
  defaultNumberRanges,
  groupRows,
  numberGroupKey,
  resolveGroupSpec,
  rowGrouping,
  shownRows,
  summarizeGroups,
} from './groups.js';

const points: DatabaseProperty = { id: 'points', name: 'Points', type: 'number' };
const stage: DatabaseProperty = {
  id: 'stage',
  name: 'Stage',
  type: 'select',
  config: {
    options: [
      { id: 'todo', name: 'To do', color: 'gray' },
      { id: 'doing', name: 'Doing', color: 'blue' },
      { id: 'done', name: 'Done', color: 'green' },
    ],
  },
};
const byId = new Map([points, stage].map((p) => [p.id, p]));
const row = (id: string, properties: Record<string, unknown>) => ({ id, title: id, properties });

describe('number ranges', () => {
  it('span the rows’ numbers in about ten round steps when the view sets none', () => {
    expect(defaultNumberRanges({ min: -2, max: 25 })).toEqual({
      from: -5,
      to: 30,
      step: 5,
      count: 7,
    });
    expect(defaultNumberRanges({ min: 0.31, max: 0.35 })).toMatchObject({ step: 0.005 });
    // One number: a range around it; none at all: tens up to a hundred.
    expect(defaultNumberRanges({ min: 7, max: 7 })).toEqual({ from: 7, to: 8, step: 1, count: 1 });
    expect(defaultNumberRanges({ min: null, max: null })).toEqual({
      from: 0,
      to: 100,
      step: 10,
      count: 10,
    });
    for (const [min, max] of [
      [0.1, 0.3],
      [-1, 1e20],
      [1e-7, 2.5],
      [-0.5, -0.5],
    ] as const) {
      const ranges = defaultNumberRanges({ min, max });
      // Every number falls in a range, none below or above them.
      for (const n of [min, max]) {
        const key = Number(numberGroupKey(n, ranges));
        expect(key).toBeGreaterThanOrEqual(0);
        expect(key).toBeLessThan(ranges.count);
      }
      expect(ranges.count).toBeLessThanOrEqual(12);
    }
  });

  it('put a number in its range, those below and above apart, and a range cut short at the end', () => {
    const spec = resolveGroupSpec({ propertyId: 'points' }, byId, 'UTC', {
      numberGrouping: { from: 0, to: 12, step: 5 },
    });
    expect(spec?.numbers).toEqual({ from: 0, to: 12, step: 5, count: 3 });
    const ranges = spec?.numbers ?? defaultNumberRanges({ min: null, max: null });
    expect([-1, 0, 4.99, 5, 11.9, 12, 99].map((n) => numberGroupKey(n, ranges))).toEqual([
      '-1',
      '0',
      '0',
      '1',
      '2',
      '3',
      '3',
    ]);
    if (!spec) return;
    const summary = summarizeGroups(new Map([['-1', 1]]), spec);
    expect(summary.map((g) => [g.key, g.range])).toEqual([
      ['-1', { from: null, to: 0 }],
      ['0', { from: 0, to: 5 }],
      ['1', { from: 5, to: 10 }],
      ['2', { from: 10, to: 12 }],
    ]);
  });
});

describe('a view’s own group order and hidden groups', () => {
  it('lists its ordered groups first, the others after in theirs, and leaves out the hidden', () => {
    const spec = resolveGroupSpec({ propertyId: 'stage' }, byId, 'UTC', {
      groupOrder: [null, 'done'],
      hiddenGroups: ['doing'],
    });
    if (!spec) throw new Error('stage groups');
    expect(['todo', 'doing', 'done', null].sort(compareGroupKeys(spec))).toEqual([
      null,
      'done',
      'todo',
      'doing',
    ]);
    const rows = [
      row('a', { stage: { optionId: 'todo' } }),
      row('b', { stage: { optionId: 'doing' } }),
      row('c', {}),
    ];
    expect(groupRows(rows, spec).map((e) => [e.key, e.row.id])).toEqual([
      [null, 'c'],
      ['todo', 'a'],
    ]);
    expect(shownRows(rows, spec).map((r) => r.id)).toEqual(['a', 'c']);
    // The empty group only when a row is in it.
    expect(summarizeGroups(new Map(), spec).map((g) => g.key)).toEqual(['done', 'todo']);
  });

  it('are those of a table’s, a list’s, a gallery’s or a timeline’s groups, a board’s sub-groups', () => {
    const groupBy = { propertyId: 'stage' };
    const subGroupBy = { propertyId: 'points' };
    for (const type of ['table', 'list', 'gallery', 'timeline'] as const) {
      expect(rowGrouping({ type, groupBy, subGroupBy })).toBe(groupBy);
    }
    expect(rowGrouping({ type: 'board', groupBy, subGroupBy })).toBe(subGroupBy);
    expect(rowGrouping({ type: 'calendar', groupBy })).toBeNull();
    expect(rowGrouping({ type: 'chart', groupBy })).toBeNull();
  });
});
