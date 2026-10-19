import { describe, expect, it } from 'vitest';
import type { DatabaseProperty, Filter } from '../../db/schema/databases.js';
import { evaluateFilter, invalidCondition } from './filters.js';

const PROPERTIES: DatabaseProperty[] = [
  { id: 'name', name: 'Name', type: 'text' },
  { id: 'stage', name: 'Stage', type: 'select' },
  { id: 'state', name: 'State', type: 'status' },
  { id: 'labels', name: 'Labels', type: 'multi_select' },
  { id: 'people', name: 'People', type: 'person' },
  { id: 'related', name: 'Related', type: 'relation' },
  { id: 'done', name: 'Done', type: 'checkbox' },
  { id: 'id', name: 'ID', type: 'unique_id' },
  { id: 'total', name: 'Total', type: 'formula' },
];
const byId = new Map(PROPERTIES.map((p) => [p.id, p]));
const condition = (propertyId: string, operator: string, value?: unknown): Filter => ({
  kind: 'condition',
  propertyId,
  operator,
  value,
});
const passes = (filter: Filter, properties: Record<string, unknown>) =>
  evaluateFilter(filter, { properties, title: 'Row' }, byId);

describe('evaluateFilter on an empty value', () => {
  it.each([
    ['stage', 'is_not'],
    ['state', 'is_not'],
    ['labels', 'does_not_contain'],
    ['people', 'does_not_contain'],
    ['related', 'does_not_contain'],
  ])('%s %s includes the rows with no value, as in Notion', (propertyId, operator) => {
    const filter = condition(propertyId, operator, 'x');
    expect(passes(filter, {})).toBe(true);
    expect(passes(filter, { [propertyId]: null })).toBe(true);
    expect(passes(filter, { stage: { optionId: null }, labels: { optionIds: [] } })).toBe(true);
  });

  it('still leaves them out of the positive operators', () => {
    expect(passes(condition('stage', 'is', 'x'), {})).toBe(false);
    expect(passes(condition('labels', 'contains', 'x'), { labels: { optionIds: [] } })).toBe(false);
  });

  it('and still tests a value that is set', () => {
    expect(passes(condition('stage', 'is_not', 'x'), { stage: { optionId: 'x' } })).toBe(false);
    expect(passes(condition('stage', 'is_not', 'x'), { stage: { optionId: 'y' } })).toBe(true);
    expect(
      passes(condition('labels', 'does_not_contain', 'x'), { labels: { optionIds: ['x'] } }),
    ).toBe(false);
  });

  it('a checkbox never set is not "not checked"', () => {
    expect(passes(condition('done', 'is_not', true), {})).toBe(false);
  });
});

describe('invalidCondition', () => {
  const group = (...filters: Filter[]): Filter => ({ kind: 'group', combinator: 'and', filters });

  it('accepts the operators of each property type', () => {
    expect(
      invalidCondition(
        group(
          condition('name', 'does_not_equal', 'a'),
          condition('id', 'is_empty'),
          condition('total', '>', 3),
          group(condition('labels', 'does_not_contain', 'x')),
        ),
        byId,
      ),
    ).toBeNull();
  });

  it('finds a wrong operator anywhere in the tree', () => {
    const wrong = condition('stage', 'contains', 'x');
    expect(invalidCondition(group(condition('name', 'contains', 'a'), group(wrong)), byId)).toBe(
      wrong,
    );
    expect(invalidCondition(condition('done', 'is_empty'), byId)).not.toBeNull();
  });

  it('refuses a property the database does not have', () => {
    expect(invalidCondition(group(condition('ghost', 'is_empty')), byId)).not.toBeNull();
  });
});
