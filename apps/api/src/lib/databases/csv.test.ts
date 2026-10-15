import { describe, expect, it } from 'vitest';
import { csvToDatabase, databaseToCsv, inferColumnType, parseCsv, toCsv } from './csv.js';

describe('parseCsv / toCsv', () => {
  it('reads quotes, doubled quotes, newlines in fields, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n1,"two\nlines",3\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', 'two\nlines', '3'],
    ]);
  });

  it('round-trips, and defuses spreadsheet formulas but not signed numbers', () => {
    const rows = [['=SUM(A1)', '-5', 'a,"b"', '@cmd']];
    expect(toCsv(rows)).toBe(`'=SUM(A1),-5,"a,""b""",'@cmd\r\n`);
    expect(parseCsv(toCsv([['x', 'y\nz']]))).toEqual([['x', 'y\nz']]);
  });
});

describe('inferColumnType', () => {
  it('picks the type every value fits', () => {
    expect(inferColumnType(['Yes', 'No', ''])).toBe('checkbox');
    expect(inferColumnType(['1', '2.5', ''])).toBe('number');
    expect(inferColumnType(['October 15, 2026', '2026-10-16'])).toBe('date');
    expect(inferColumnType(['https://a.test', 'http://b.test'])).toBe('url');
    expect(inferColumnType(['a@b.test'])).toBe('email');
    expect(inferColumnType(['Todo', 'Done', 'Todo'])).toBe('select');
    expect(inferColumnType(['a, b', 'b', 'c, a'])).toBe('multi_select');
    expect(inferColumnType(['free text', 'more'])).toBe('text');
  });
});

describe('csvToDatabase / databaseToCsv', () => {
  it('turns a CSV into a schema and rows, and back', () => {
    const csv =
      'Name,Status,Points,Done,Tags\nWrite,Todo,3,No,"a, b"\nShip,Done,5,Yes,b\nTest,Todo,1,No,a\n';
    const { schema, rows } = csvToDatabase(csv);
    expect(schema.properties.map((p) => [p.name, p.type])).toEqual([
      ['Name', 'text'],
      ['Status', 'select'],
      ['Points', 'number'],
      ['Done', 'checkbox'],
      ['Tags', 'multi_select'],
    ]);
    expect(rows.map((r) => r.title)).toEqual(['Write', 'Ship', 'Test']);
    const out = databaseToCsv(
      schema,
      rows.map((r) => ({ ...r, createdAt: new Date(0), updatedAt: new Date(0) })),
    );
    expect(parseCsv(out)).toEqual(parseCsv(csv));
  });
});
