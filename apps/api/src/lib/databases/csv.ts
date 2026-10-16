/**
 * Databases as CSV: reading a CSV into a schema and rows (import, including
 * the CSVs of a Notion export) and writing a database's rows out (export).
 */
import { randomUUID } from 'node:crypto';
import {
  type DatabaseProperty,
  type DatabasePropertyType,
  type DatabaseSchema,
  SELECT_COLORS,
  type SelectOption,
} from '../../db/schema/databases.js';
import { NAME_PROPERTY_ID } from './schema-defaults.js';

/** RFC 4180: quoted fields, doubled quotes, CRLF or LF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // A trailing newline leaves no empty last row.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/**
 * One CSV field. Values a spreadsheet would run as a formula (`=`, `+`, `-`,
 * `@`, tab, CR at the start) get a leading `'`, the OWASP guidance for CSV
 * injection; numbers keep their sign.
 */
function csvField(value: string): string {
  const risky = /^[=+\-@\t\r]/.test(value) && !/^[-+]?\d+(\.\d+)?$/.test(value);
  const safe = risky ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  return `${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}

const TRUE = new Set(['yes', 'true', 'checked', '✓', 'x', 'sí', 'si']);
const FALSE = new Set(['no', 'false', 'unchecked', '']);
const NUMBER = /^-?\d{1,15}([.,]\d+)?$/;
const URL = /^https?:\/\/\S+$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_OPTIONS = 50;

/** A date a Notion export or a person writes: ISO, or "October 15, 2026 [9:30 AM]". */
function parseDate(value: string): { start: string; includeTime: boolean } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const range = trimmed.split(/\s+→\s+/)[0] as string;
  const iso = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(range);
  const written = /^[A-Za-z]+ \d{1,2}, \d{4}( \d{1,2}:\d{2}( ?[AP]M)?)?( \([^)]+\))?$/i.test(range);
  if (!iso && !written) return null;
  const parsed = new Date(written ? range.replace(/ \([^)]+\)$/, '') : range);
  if (Number.isNaN(parsed.getTime())) return null;
  return { start: parsed.toISOString(), includeTime: /\d:\d/.test(range) };
}

const splitMulti = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

/** The property type that fits every non-empty value of a column. */
export function inferColumnType(values: readonly string[]): DatabasePropertyType {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  if (filled.length === 0) return 'text';
  const lower = filled.map((v) => v.toLowerCase());
  if (
    values.every((v) => TRUE.has(v.trim().toLowerCase()) || FALSE.has(v.trim().toLowerCase())) &&
    lower.some((v) => TRUE.has(v))
  )
    return 'checkbox';
  if (filled.every((v) => NUMBER.test(v))) return 'number';
  if (filled.every((v) => parseDate(v))) return 'date';
  if (filled.every((v) => URL.test(v))) return 'url';
  if (filled.every((v) => EMAIL.test(v))) return 'email';
  const distinct = new Set(filled);
  if (filled.some((v) => v.includes(','))) {
    const tokens = new Set(filled.flatMap(splitMulti));
    if (tokens.size <= MAX_OPTIONS && tokens.size < filled.flatMap(splitMulti).length)
      return 'multi_select';
    return 'text';
  }
  if (
    distinct.size <= MAX_OPTIONS &&
    distinct.size < filled.length &&
    filled.every((v) => v.length <= 100)
  )
    return 'select';
  return 'text';
}

const option = (name: string, i: number): SelectOption => ({
  id: randomUUID(),
  name,
  color: SELECT_COLORS[i % SELECT_COLORS.length] as SelectOption['color'],
});

export interface CsvDatabase {
  schema: DatabaseSchema;
  rows: { title: string; properties: Record<string, unknown> }[];
}

/**
 * A CSV with a header row → a schema (the first column is the Name) and the
 * rows' typed property values.
 */
export function csvToDatabase(csv: string): CsvDatabase {
  return tableToDatabase(parseCsv(csv));
}

/**
 * Cells with a header row (a parsed CSV, or the table of a Notion HTML
 * export) → a schema and typed rows, as `csvToDatabase`.
 */
export function tableToDatabase(table: readonly (readonly string[])[]): CsvDatabase {
  const [header = [], ...body] = table;
  if (header.length === 0)
    return {
      schema: { properties: [{ id: NAME_PROPERTY_ID, name: 'Name', type: 'text' }] },
      rows: [],
    };
  const columns = header.map((name, c) => ({
    name: name.trim() || `Column ${c + 1}`,
    values: body.map((r) => r[c] ?? ''),
  }));

  const properties: DatabaseProperty[] = columns.map((column, c) => {
    if (c === 0) return { id: NAME_PROPERTY_ID, name: column.name, type: 'text' };
    const type = inferColumnType(column.values);
    const property: DatabaseProperty = { id: randomUUID(), name: column.name, type };
    if (type === 'select' || type === 'multi_select') {
      const names = [
        ...new Set(
          column.values
            .flatMap((v) => (type === 'select' ? [v.trim()] : splitMulti(v)))
            .filter(Boolean),
        ),
      ];
      property.config = { options: names.map(option) };
    }
    if (type === 'date')
      property.config = { includeTime: column.values.some((v) => parseDate(v)?.includeTime) };
    return property;
  });

  const valueFor = (property: DatabaseProperty, raw: string): unknown => {
    const value = raw.trim();
    const options = property.config?.options ?? [];
    switch (property.type) {
      case 'checkbox':
        return { checked: TRUE.has(value.toLowerCase()) };
      case 'number':
        return { number: value ? Number(value.replace(',', '.')) : null };
      case 'date': {
        const date = parseDate(value);
        return { start: date?.start ?? null, end: null, includeTime: date?.includeTime ?? false };
      }
      case 'url':
      case 'email':
        return { value };
      case 'select':
        return { optionId: options.find((o) => o.name === value)?.id ?? null };
      case 'multi_select':
        return {
          optionIds: splitMulti(value)
            .map((name) => options.find((o) => o.name === name)?.id)
            .filter(Boolean),
        };
      default:
        return { text: value };
    }
  };

  const rows = body
    .filter((r) => r.some((cell) => cell.trim()))
    .map((r) => {
      const values: Record<string, unknown> = {};
      properties.forEach((property, c) => {
        values[property.id] = valueFor(property, r[c] ?? '');
      });
      return { title: (r[0] ?? '').trim(), properties: values };
    });
  return { schema: { properties }, rows };
}

/** Types whose values are computed or point at other records: not written to CSV. */
const NOT_EXPORTED = new Set<DatabasePropertyType>(['formula', 'rollup']);

/** A database's rows → CSV, one column per stored property, values as people read them. */
export function databaseToCsv(
  schema: DatabaseSchema,
  rows: readonly {
    title: string;
    properties: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  }[],
): string {
  const columns = schema.properties.filter((p) => !NOT_EXPORTED.has(p.type));
  const optionName = (property: DatabaseProperty, id: unknown) =>
    property.config?.options?.find((o) => o.id === id)?.name ?? '';
  const cell = (property: DatabaseProperty, row: (typeof rows)[number]): string => {
    const value = (row.properties[property.id] ?? {}) as Record<string, unknown>;
    switch (property.type) {
      case 'text':
        return property.id === NAME_PROPERTY_ID ? row.title : String(value.text ?? '');
      case 'number':
        return typeof value.number === 'number' ? String(value.number) : '';
      case 'unique_id':
        return typeof value.number === 'number'
          ? `${property.config?.prefix ? `${property.config.prefix}-` : ''}${value.number}`
          : '';
      case 'select':
      case 'status':
        return optionName(property, value.optionId);
      case 'multi_select':
        return (Array.isArray(value.optionIds) ? value.optionIds : [])
          .map((id) => optionName(property, id))
          .join(', ');
      case 'date':
        return typeof value.start === 'string'
          ? `${value.start}${typeof value.end === 'string' ? ` → ${value.end}` : ''}`
          : '';
      case 'checkbox':
        return value.checked === true ? 'Yes' : 'No';
      case 'url':
      case 'email':
      case 'phone':
        return String(value.value ?? '');
      case 'person':
        return (Array.isArray(value.userIds) ? value.userIds : []).join(', ');
      case 'files':
        return (
          (Array.isArray(value.files) ? value.files : [])
            // A file in Oxy storage has no lasting link to export: its name stands in.
            .map((f) => {
              const file = f as { url?: string; name?: string };
              return file.url ?? file.name ?? '';
            })
            .join(', ')
        );
      case 'relation':
        return (Array.isArray(value.pageIds) ? value.pageIds : []).join(', ');
      case 'created_time':
        return row.createdAt.toISOString();
      case 'last_edited_time':
        return row.updatedAt.toISOString();
      default:
        return '';
    }
  };
  return toCsv([
    columns.map((p) => p.name),
    ...rows.map((row) => columns.map((p) => cell(p, row))),
  ]);
}
