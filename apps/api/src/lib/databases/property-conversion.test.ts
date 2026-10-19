import { describe, expect, it } from 'vitest';
import type { DatabaseProperty } from '../../db/schema/databases.js';
import { convertValues, isEmptyValue, valueText } from './property-conversion.js';
import { normalizeStatusGroups } from './schema-defaults.js';

const prop = (type: DatabaseProperty['type'], config?: DatabaseProperty['config']) =>
  ({ id: 'p', name: 'P', type, config }) as DatabaseProperty;

const OPTIONS = [
  { id: 'a', name: 'Alpha', color: 'red' as const },
  { id: 'b', name: 'Beta', color: 'blue' as const },
];

describe('convertValues', () => {
  it('turns any value into the text people read, and clears what has none', () => {
    const { values } = convertValues(prop('multi_select', { options: OPTIONS }), prop('text'), [
      { id: '1', value: { optionIds: ['a', 'b'] } },
      { id: '2', value: { optionIds: [] } },
      { id: '3', value: null },
    ]);
    expect(Object.fromEntries(values)).toEqual({ '1': { text: 'Alpha, Beta' }, '2': null });
    const dates = convertValues(prop('date'), prop('text'), [
      { id: '1', value: { start: '2026-10-20T00:00:00.000Z', end: null, includeTime: false } },
    ]);
    expect(dates.values.get('1')).toEqual({ text: '2026-10-20' });
    const people = convertValues(prop('person'), prop('text'), [
      { id: '1', value: { userIds: ['u'] } },
    ]);
    expect(people.values.get('1')).toBeNull();
  });

  it('reads the number text spells, and clears text that spells none', () => {
    const { values } = convertValues(prop('text'), prop('number'), [
      { id: '1', value: { text: ' 1,200.5 ' } },
      { id: '2', value: { text: '12 apples' } },
      { id: '3', value: { text: '-3e2' } },
    ]);
    expect(Object.fromEntries(values)).toEqual({
      '1': { number: 1200.5 },
      '2': null,
      '3': { number: -300 },
    });
  });

  it('matches options by name, ignoring case, and adds the ones missing, once', () => {
    const { property, values } = convertValues(
      prop('text'),
      prop('multi_select', { options: OPTIONS }),
      [
        { id: '1', value: { text: 'alpha, Gamma' } },
        { id: '2', value: { text: 'gamma' } },
      ],
    );
    const gamma = property.config?.options?.find((o) => o.name === 'Gamma');
    expect(property.config?.options).toHaveLength(3);
    expect(values.get('1')).toEqual({ optionIds: ['a', gamma?.id] });
    expect(values.get('2')).toEqual({ optionIds: [gamma?.id] });
  });

  it('keeps option ids between option types, a multi-select its first', () => {
    const toStatus = convertValues(
      prop('multi_select', { options: OPTIONS }),
      prop('status', { options: OPTIONS }),
      [{ id: '1', value: { optionIds: ['b', 'a'] } }],
    );
    expect(toStatus.values.get('1')).toEqual({ optionId: 'b' });
    const toMulti = convertValues(
      prop('select', { options: OPTIONS }),
      prop('multi_select', { options: OPTIONS }),
      [{ id: '1', value: { optionId: 'a' } }],
    );
    expect(toMulti.values.get('1')).toEqual({ optionIds: ['a'] });
  });

  it('checks what reads as true, and dates only an ISO date', () => {
    const boxes = convertValues(prop('text'), prop('checkbox'), [
      { id: '1', value: { text: 'Yes' } },
      { id: '2', value: { text: 'nope' } },
    ]);
    expect(Object.fromEntries(boxes.values)).toEqual({
      '1': { checked: true },
      '2': { checked: false },
    });
    const dates = convertValues(prop('text'), prop('date'), [
      { id: '1', value: { text: '2026-01-02' } },
      { id: '2', value: { text: '5' } },
    ]);
    expect(Object.fromEntries(dates.values)).toEqual({
      '1': { start: '2026-01-02T00:00:00.000Z', end: null, includeTime: false },
      '2': null,
    });
  });

  it('clears every value of a property becoming a computed one', () => {
    const { values } = convertValues(prop('text'), prop('formula'), [
      { id: '1', value: { text: 'x' } },
      { id: '2', value: null },
    ]);
    expect(Object.fromEntries(values)).toEqual({ '1': null });
  });
});

describe('valueText and isEmptyValue', () => {
  it('read an ID with its prefix and count an unchecked box as empty', () => {
    expect(valueText(prop('unique_id', { prefix: 'T' }), { number: 4 })).toBe('T-4');
    expect(isEmptyValue({ checked: false })).toBe(true);
    expect(isEmptyValue({ text: '' })).toBe(true);
    expect(isEmptyValue({ optionIds: ['a'] })).toBe(false);
    expect(isEmptyValue(undefined)).toBe(true);
  });
});

describe('normalizeStatusGroups', () => {
  it('gives the three groups, each option in one, the ungrouped in To-do', () => {
    const options = [...OPTIONS, { id: 'c', name: 'Gamma', color: 'green' as const }];
    expect(
      normalizeStatusGroups(options, [
        { id: 'complete', optionIds: ['b', 'gone'] },
        { id: 'in_progress', optionIds: ['b', 'c'] },
      ]),
    ).toEqual([
      { id: 'todo', optionIds: ['a'] },
      // In the earlier group of the two that name it.
      { id: 'in_progress', optionIds: ['b', 'c'] },
      { id: 'complete', optionIds: [] },
    ]);
  });
});
