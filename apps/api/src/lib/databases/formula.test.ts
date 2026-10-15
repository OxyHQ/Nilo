import { describe, expect, it } from 'vitest';
import { evaluateFormula, type FormulaValue } from './formula.js';

const row: Record<string, FormulaValue> = {
  Name: 'Write spec',
  Points: 3,
  Done: false,
  Tags: ['a', 'b'],
  Due: new Date('2026-10-20T00:00:00Z'),
  Empty: '',
};
const ctx = {
  prop: (name: string) => {
    if (!(name in row)) throw new Error(`no ${name}`);
    return row[name] as FormulaValue;
  },
  now: () => new Date('2026-10-15T12:00:00Z'),
};
const value = (expression: string) => evaluateFormula(expression, ctx).value;
const error = (expression: string) => evaluateFormula(expression, ctx).error;

describe('evaluateFormula', () => {
  it('does arithmetic with precedence, and powers to the right', () => {
    expect(value('=1 + 2 * 3')).toBe(7);
    expect(value('(1 + 2) * 3')).toBe(9);
    expect(value('2 ^ 3 ^ 2')).toBe(512);
    expect(value('-2 ^ 2')).toBe(-4);
    expect(value('10 % 4')).toBe(2);
  });

  it('reads properties and joins text with +', () => {
    expect(value('prop("Points") * 2')).toBe(6);
    expect(value('"Task: " + prop("Name")')).toBe('Task: Write spec');
    expect(value('length(prop("Tags"))')).toBe(2);
    expect(value('join(prop("Tags"), " / ")')).toBe('a / b');
    expect(value('contains(prop("Tags"), "b")')).toBe(true);
  });

  it('decides with if, ifs, and, or, not and comparisons', () => {
    expect(value('if(prop("Done"), "✓", "…")')).toBe('…');
    expect(value('ifs(prop("Points") > 5, "big", prop("Points") > 1, "medium", "small")')).toBe(
      'medium',
    );
    expect(value('not prop("Done") and prop("Points") >= 3')).toBe(true);
    expect(value('empty(prop("Empty")) or false')).toBe(true);
    expect(value('prop("Name") == "Write spec"')).toBe(true);
  });

  it('works with dates', () => {
    expect(value('dateBetween(prop("Due"), now(), "days")')).toBe(4);
    expect(value('formatDate(dateAdd(prop("Due"), 1, "months"))')).toBe('2026-11-20');
    expect(value('formatDate(today(), "DD/MM/YYYY")')).toBe('15/10/2026');
    expect(value('year(prop("Due"))')).toBe(2026);
  });

  it('rounds and aggregates', () => {
    expect(value('round(10 / 3, 2)')).toBe(3.33);
    expect(value('max(1, 7, 3) + min(4, 2)')).toBe(9);
    expect(value('sum(1, 2, 3)')).toBe(6);
  });

  it('explains what is wrong instead of failing', () => {
    expect(error('1 / 0')).toBe('Division by zero');
    expect(error('foo(1)')).toBe('Unknown function "foo"');
    expect(error('1 +')).toBe('The formula ends too soon');
    expect(error('"open')).toBe('A text literal is not closed');
    expect(error('if(1, 2)')).toBe('if() takes 3 arguments');
    expect(error('prop("Name") * 2')).toBe('Multiplying needs a number');
    expect(error('('.repeat(200))).toBe('The formula is nested too deeply');
  });

  it('never runs JavaScript', () => {
    expect(error('constructor.constructor("return 1")()')).not.toBeNull();
    expect(error('constructor(1)')).toBe('Unknown function "constructor"');
    expect(error('toString()')).toBe('Unknown function "toString"');
    expect(error('__proto__(1)')).toBe('Unknown function "__proto__"');
  });
});
