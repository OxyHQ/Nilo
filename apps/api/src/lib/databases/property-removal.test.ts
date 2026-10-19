import { describe, expect, it } from 'vitest';
import type { DatabaseSchema, Filter } from '../../db/schema/databases.js';
import {
  type PropertyReferencingView,
  schemaWithoutProperty,
  viewWithoutProperty,
} from './property-removal.js';

const on = (propertyId: string): Filter => ({
  kind: 'condition',
  propertyId,
  operator: 'is_empty',
});

const view = (overrides: Partial<PropertyReferencingView> = {}): PropertyReferencingView => ({
  filters: { kind: 'group', combinator: 'and', filters: [] },
  sorts: [],
  groupBy: null,
  hiddenProperties: [],
  frozenProperties: [],
  config: {},
  ...overrides,
});

describe('viewWithoutProperty', () => {
  it('leaves a view that never named the property alone', () => {
    expect(
      viewWithoutProperty(
        view({ sorts: [{ propertyId: 'kept', direction: 'asc' }], hiddenProperties: ['kept'] }),
        'gone',
      ),
    ).toBeNull();
  });

  it('drops it from sorts, filters at any depth, grouping, hidden, frozen and config', () => {
    const patch = viewWithoutProperty(
      view({
        filters: {
          kind: 'group',
          combinator: 'or',
          filters: [
            on('kept'),
            on('gone'),
            { kind: 'group', combinator: 'and', filters: [on('gone')] },
            { kind: 'group', combinator: 'and', filters: [on('gone'), on('kept')] },
          ],
        },
        sorts: [
          { propertyId: 'gone', direction: 'asc' },
          { propertyId: 'kept', direction: 'desc' },
        ],
        groupBy: { propertyId: 'gone' },
        hiddenProperties: ['gone', 'kept'],
        frozenProperties: ['gone'],
        config: {
          datePropertyId: 'gone',
          startPropertyId: 'gone',
          endPropertyId: 'gone',
          coverPropertyId: 'gone',
          coverSource: 'property',
          description: 'kept',
        },
      }),
      'gone',
    );
    expect(patch).toEqual({
      // The group left with nothing goes: an empty group would pass every row of the `or`.
      filters: {
        kind: 'group',
        combinator: 'or',
        filters: [on('kept'), { kind: 'group', combinator: 'and', filters: [on('kept')] }],
      },
      sorts: [{ propertyId: 'kept', direction: 'desc' }],
      groupBy: null,
      hiddenProperties: ['kept'],
      frozenProperties: [],
      config: { coverSource: 'property', description: 'kept' },
    });
  });

  it('keeps the top-level group when every condition goes', () => {
    expect(
      viewWithoutProperty(
        view({ filters: { kind: 'group', combinator: 'or', filters: [on('gone')] } }),
        'gone',
      ),
    ).toEqual({ filters: { kind: 'group', combinator: 'or', filters: [] } });
  });
});

describe('schemaWithoutProperty', () => {
  const schema: DatabaseSchema = {
    properties: [
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'self', name: 'Parent', type: 'relation', config: { targetDatabaseId: 'db' } },
      { id: 'other', name: 'Projects', type: 'relation', config: { targetDatabaseId: 'projects' } },
      { id: 'points', name: 'Points', type: 'number' },
      {
        id: 'by-relation',
        name: 'Sum',
        type: 'rollup',
        config: { relationPropertyId: 'other', targetPropertyId: 'points', function: 'sum' },
      },
      {
        id: 'by-self',
        name: 'Parent points',
        type: 'rollup',
        config: { relationPropertyId: 'self', targetPropertyId: 'points', function: 'sum' },
      },
    ],
  };

  it('unsets a rollup whose relation goes', () => {
    const next = schemaWithoutProperty(schema, 'db', 'other');
    expect(next.properties.map((p) => p.id)).not.toContain('other');
    expect(next.properties.find((p) => p.id === 'by-relation')?.config).toEqual({
      function: 'sum',
    });
  });

  it('unsets a rollup reading the property through a relation to this database only', () => {
    const next = schemaWithoutProperty(schema, 'db', 'points');
    expect(next.properties.find((p) => p.id === 'by-self')?.config).toEqual({
      relationPropertyId: 'self',
      function: 'sum',
    });
    // `points` of `projects` is another property that happens to share the id.
    expect(next.properties.find((p) => p.id === 'by-relation')?.config).toEqual({
      relationPropertyId: 'other',
      targetPropertyId: 'points',
      function: 'sum',
    });
  });
});
