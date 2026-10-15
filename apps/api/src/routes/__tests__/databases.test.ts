/**
 * Smoke tests for the Phase 4 (Databases) building blocks. Mirrors the
 * shape of the other Phase smoke tests in this folder — exercises the
 * Zod schemas, the filter evaluator, and the formula evaluator without
 * mounting Express.
 */
import { describe, expect, it } from 'vitest';
import { evaluateFilter, filterGroupSchema } from '../../lib/databases/filters.js';
import { compareBySorts } from '../../lib/databases/sorts.js';
import { parsePropertyValue, serializeParsedValue } from '../../lib/databases/property-values.js';
import { evaluateFormulaExpression } from '../../lib/databases/formula.js';
import type { DatabaseProperty } from '../../db/schema/databases.js';

/** Fails the test, rather than passing `null` on, when parsing rejected the input. */
function parsedOrFail(parsed: ReturnType<typeof parsePropertyValue>) {
  if (parsed === null) throw new Error('parsePropertyValue rejected a valid value');
  return parsed;
}

describe('parsePropertyValue', () => {
  it('parses text', () => {
    const parsed = parsePropertyValue('text', { text: 'hi' });
    expect(parsed?.kind).toBe('text');
    expect(serializeParsedValue(parsedOrFail(parsed))).toEqual({ text: 'hi' });
  });

  it('parses checkbox', () => {
    const parsed = parsePropertyValue('checkbox', { checked: true });
    expect(serializeParsedValue(parsedOrFail(parsed))).toEqual({ checked: true });
  });

  it('parses multi_select', () => {
    const parsed = parsePropertyValue('multi_select', { optionIds: ['a', 'b'] });
    expect(serializeParsedValue(parsedOrFail(parsed))).toEqual({ optionIds: ['a', 'b'] });
  });

  it('rejects bad shape', () => {
    expect(() => parsePropertyValue('number', { foo: 1 })).toThrow();
  });

  it('returns null for server-derived types', () => {
    expect(parsePropertyValue('rollup', {})).toBeNull();
    expect(parsePropertyValue('formula', {})).toBeNull();
    expect(parsePropertyValue('created_time', {})).toBeNull();
  });
});

describe('filterGroupSchema', () => {
  it('parses a simple AND group', () => {
    const parsed = filterGroupSchema.parse({
      kind: 'group',
      combinator: 'and',
      filters: [{ kind: 'condition', propertyId: 'p1', operator: 'is', value: 'x' }],
    });
    expect(parsed.combinator).toBe('and');
    expect(parsed.filters.length).toBe(1);
  });

  it('rejects malformed input', () => {
    expect(() => filterGroupSchema.parse({ kind: 'condition', propertyId: 'p1' })).toThrow();
  });
});

describe('evaluateFilter', () => {
  const properties: DatabaseProperty[] = [
    { id: 'name', name: 'Name', type: 'text' },
    { id: 'priority', name: 'Priority', type: 'select', config: { options: [] } },
    { id: 'done', name: 'Done', type: 'checkbox' },
  ];
  const byId = new Map(properties.map((p) => [p.id, p]));

  const row = (
    title: string,
    priority: string | null,
    done: boolean,
  ): {
    properties: Map<string, unknown>;
    title: string;
    ownerId?: string;
    createdAt?: Date;
    updatedAt?: Date;
  } => ({
    title,
    properties: new Map([
      ['priority', { optionId: priority }],
      ['done', { checked: done }],
    ]),
  });

  it('AND combinator', () => {
    const r = row('Task', 'high', true);
    const pass = evaluateFilter(
      {
        kind: 'group',
        combinator: 'and',
        filters: [
          { kind: 'condition', propertyId: 'done', operator: 'is', value: true },
          {
            kind: 'condition',
            propertyId: 'priority',
            operator: 'is',
            value: 'high',
          },
        ],
      },
      r,
      byId,
    );
    expect(pass).toBe(true);
  });

  it('OR combinator', () => {
    const r = row('Task', 'low', true);
    const pass = evaluateFilter(
      {
        kind: 'group',
        combinator: 'or',
        filters: [
          { kind: 'condition', propertyId: 'priority', operator: 'is', value: 'high' },
          { kind: 'condition', propertyId: 'done', operator: 'is', value: true },
        ],
      },
      r,
      byId,
    );
    expect(pass).toBe(true);
  });

  it('Text contains', () => {
    const r = row('Important task', null, false);
    const pass = evaluateFilter(
      {
        kind: 'group',
        combinator: 'and',
        filters: [
          {
            kind: 'condition',
            propertyId: 'name',
            operator: 'contains',
            value: 'IMP',
          },
        ],
      },
      r,
      byId,
    );
    expect(pass).toBe(true);
  });

  it('Empty group passes', () => {
    const r = row('Anything', null, false);
    const pass = evaluateFilter({ kind: 'group', combinator: 'and', filters: [] }, r, byId);
    expect(pass).toBe(true);
  });

  it('filters on when and by whom a row was created and edited', () => {
    const meta: DatabaseProperty[] = [
      { id: 'created', name: 'Created', type: 'created_time' },
      { id: 'edited', name: 'Edited', type: 'last_edited_time' },
      { id: 'creator', name: 'Created by', type: 'created_by' },
      { id: 'editor', name: 'Edited by', type: 'last_edited_by' },
    ];
    const metaById = new Map(meta.map((p) => [p.id, p]));
    const r = {
      title: 'Row',
      properties: {},
      ownerId: 'ana',
      lastEditedBy: 'bo',
      createdAt: new Date('2026-03-01T10:00:00Z'),
      updatedAt: new Date('2026-03-05T10:00:00Z'),
    };
    const passes = (propertyId: string, operator: string, value: unknown) =>
      evaluateFilter(
        {
          kind: 'group',
          combinator: 'and',
          filters: [{ kind: 'condition', propertyId, operator, value }],
        },
        r,
        metaById,
      );
    expect(passes('created', 'before', '2026-03-02')).toBe(true);
    expect(passes('created', 'after', '2026-03-02')).toBe(false);
    expect(passes('created', 'equals', '2026-03-01')).toBe(true);
    expect(passes('edited', 'on_or_after', '2026-03-05')).toBe(true);
    expect(passes('creator', 'contains', 'ana')).toBe(true);
    expect(passes('creator', 'does_not_contain', 'ana')).toBe(false);
    expect(passes('editor', 'contains', 'bo')).toBe(true);
    expect(passes('editor', 'contains', 'ana')).toBe(false);
  });
});

describe('compareBySorts', () => {
  const properties: DatabaseProperty[] = [
    { id: 'name', name: 'Name', type: 'text' },
    { id: 'priority', name: 'Priority', type: 'number' },
  ];
  const byId = new Map(properties.map((p) => [p.id, p]));

  it('sorts by number ascending', () => {
    const rows = [
      {
        title: 'A',
        properties: new Map([['priority', { number: 3 }]]),
      },
      {
        title: 'B',
        properties: new Map([['priority', { number: 1 }]]),
      },
      {
        title: 'C',
        properties: new Map([['priority', { number: 2 }]]),
      },
    ];
    const compare = compareBySorts([{ propertyId: 'priority', direction: 'asc' }], byId);
    rows.sort(compare);
    expect(rows.map((r) => r.title)).toEqual(['B', 'C', 'A']);
  });

  it('sorts by name descending', () => {
    const rows = [
      { title: 'b', properties: new Map() },
      { title: 'a', properties: new Map() },
      { title: 'c', properties: new Map() },
    ];
    const compare = compareBySorts([{ propertyId: 'name', direction: 'desc' }], byId);
    rows.sort(compare);
    expect(rows.map((r) => r.title)).toEqual(['c', 'b', 'a']);
  });
});

describe('evaluateFormulaExpression', () => {
  it('handles simple arithmetic', () => {
    expect(evaluateFormulaExpression('=2+2')).toBe(4);
    expect(evaluateFormulaExpression('=2*3')).toBe(6);
    expect(evaluateFormulaExpression('=(1+2)*4')).toBe(12);
    expect(evaluateFormulaExpression('=10 / 4')).toBe(2.5);
  });

  it('handles string literals', () => {
    expect(evaluateFormulaExpression('="hi"')).toBe('hi');
  });

  it('returns null for unsupported input', () => {
    expect(evaluateFormulaExpression('=prop("name")')).toBeNull();
    expect(evaluateFormulaExpression('')).toBeNull();
  });

  it('handles division by zero gracefully', () => {
    expect(evaluateFormulaExpression('=10/0')).toBeNull();
  });
});
