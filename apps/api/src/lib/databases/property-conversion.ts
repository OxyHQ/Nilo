/**
 * Changing a property's type: what becomes of the values its rows hold. Each
 * value is converted when the new type can hold what it says, and cleared
 * otherwise, the same way every time, so no row is left holding a value of
 * the old shape under the new type (which no reader or filter understands).
 *
 * The rules, as Notion's:
 *   - Anything to text, URL, email or phone: the value as people read it
 *     (option names, dates as `YYYY-MM-DD`, checkboxes as Yes / No, file
 *     names; people and related rows have no text of their own and clear).
 *   - Text to number: the number it spells (`1,200.5`); else cleared.
 *     Checkbox to number: 1 or 0.
 *   - To select, multi-select or status: options carried over keep their id;
 *     any other value names options (a multi-select's text splits on commas)
 *     matched by name, ignoring case, and the ones missing are added.
 *   - To date: an ISO date (`2026-10-20…`); else cleared.
 *   - To checkbox: a number other than 0, or Yes / true / 1 / checked / x.
 *   - Person from people only (a created-by or edited-by value too), files
 *     from files only.
 *   - To a computed type (formula, rollup, created or edited time or by, ID):
 *     cleared; the server computes those. To a button: cleared; it holds none.
 *
 * Computed types converted to a stored one keep what they showed: the caller
 * passes their computed values. Pure: the route reads the rows and writes back
 * what this returns.
 */
import { randomUUID } from 'node:crypto';
import {
  SELECT_COLORS,
  type DatabaseProperty,
  type DatabasePropertyType,
  type SelectOption,
} from '../../db/schema/databases.js';

const SELECT_TYPES: ReadonlySet<DatabasePropertyType> = new Set([
  'select',
  'multi_select',
  'status',
]);

const COMPUTED_TYPES: ReadonlySet<DatabasePropertyType> = new Set([
  'formula',
  'rollup',
  'created_time',
  'last_edited_time',
  'created_by',
  'last_edited_by',
  'unique_id',
  // Holds no value at all: it runs its actions.
  'button',
]);

/** Whether the server computes a type's values (or a button: none) rather than storing what clients write. */
export function isComputedType(type: DatabasePropertyType): boolean {
  return COMPUTED_TYPES.has(type);
}

/** The longest a URL, email or phone value may be (`property-values.ts`). */
const MAX_LENGTH: Partial<Record<DatabasePropertyType, number>> = {
  text: 50_000,
  url: 2000,
  email: 320,
  phone: 64,
};

const TRUE_WORDS = new Set(['yes', 'true', '1', 'checked', 'x', '✓']);

type Obj = Record<string, unknown>;

function asObject(value: unknown): Obj | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** The option ids a select, multi-select or status value names. */
function optionIdsOf(value: Obj): string[] {
  if (typeof value.optionId === 'string') return [value.optionId];
  return strings(value.optionIds);
}

/**
 * A value as people read it, or '' when it has no text (people, related rows,
 * an empty value). Shared with rollups' "show original".
 */
export function valueText(property: DatabaseProperty, raw: unknown): string {
  const value = asObject(raw);
  if (!value) return '';
  if (SELECT_TYPES.has(property.type)) {
    const names = new Map((property.config?.options ?? []).map((o) => [o.id, o.name]));
    return optionIdsOf(value)
      .flatMap((id) => names.get(id) ?? [])
      .join(', ');
  }
  if (property.type === 'unique_id' && typeof value.number === 'number') {
    const prefix = property.config?.prefix;
    return prefix ? `${prefix}-${value.number}` : String(value.number);
  }
  if (typeof value.text === 'string') return value.text;
  if (typeof value.number === 'number' && Number.isFinite(value.number))
    return String(value.number);
  if (typeof value.checked === 'boolean') return value.checked ? 'Yes' : 'No';
  if (typeof value.value === 'string') return value.value;
  if (typeof value.start === 'string') {
    const start = value.includeTime ? value.start : value.start.slice(0, 10);
    const end =
      typeof value.end === 'string'
        ? value.includeTime
          ? value.end
          : value.end.slice(0, 10)
        : null;
    return end ? `${start} → ${end}` : start;
  }
  if (Array.isArray(value.files)) {
    return value.files
      .flatMap((f) => {
        const name = asObject(f)?.name;
        return typeof name === 'string' && name ? [name] : [];
      })
      .join(', ');
  }
  return '';
}

/** Whether a value is empty, as rollups' percent empty count it: unchecked is empty. */
export function isEmptyValue(raw: unknown): boolean {
  const value = asObject(raw);
  if (!value) return true;
  if ('checked' in value) return value.checked !== true;
  if ('number' in value) return typeof value.number !== 'number';
  if ('optionId' in value) return typeof value.optionId !== 'string';
  if ('start' in value) return typeof value.start !== 'string';
  for (const key of ['optionIds', 'userIds', 'pageIds', 'files'] as const) {
    if (key in value) return !Array.isArray(value[key]) || value[key].length === 0;
  }
  for (const key of ['text', 'value'] as const) {
    if (key in value) return typeof value[key] !== 'string' || value[key] === '';
  }
  return true;
}

/** `1,200.50` → 1200.5; null for anything that does not spell one number. */
function parseNumber(text: string): number | null {
  const cleaned = text.trim().replace(/[,\s]/gu, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/iu.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/u;

export interface ConvertibleRow {
  id: string;
  /** The row's value of the property before the change; a computed one's as computed. */
  value: unknown;
  /** What the row stores, when that is not `value` (a computed property's, usually nothing). */
  stored?: unknown;
}

export interface Conversion {
  /** The property as written: a select-like one with the options its values named. */
  property: DatabaseProperty;
  /** Row id → its new value, `null` to clear it. A row not here keeps its value. */
  values: Map<string, unknown>;
}

/** The rows' values of `from` as values of `to`, which differs from it in type. */
export function convertValues(
  from: DatabaseProperty,
  to: DatabaseProperty,
  rows: readonly ConvertibleRow[],
): Conversion {
  const values = new Map<string, unknown>();
  const property: DatabaseProperty = { ...to, config: { ...(to.config ?? {}) } };
  const clearAll = () => {
    for (const row of rows) {
      const before = 'stored' in row ? row.stored : row.value;
      if (before !== undefined && before !== null) values.set(row.id, null);
    }
    return { property, values };
  };
  if (COMPUTED_TYPES.has(to.type)) return clearAll();

  // A select-like type: values become options of the property, missing ones added.
  const options: SelectOption[] = [...(property.config?.options ?? [])];
  const byId = new Map(options.map((o) => [o.id, o]));
  const byName = new Map(options.map((o) => [o.name.trim().toLowerCase(), o]));
  const optionNamed = (name: string): SelectOption => {
    const key = name.trim().toLowerCase();
    const found = byName.get(key);
    if (found) return found;
    const option: SelectOption = {
      id: randomUUID(),
      name: name.trim().slice(0, 120),
      // The colours in turn, after "default", as an option added by hand.
      color: SELECT_COLORS[1 + (options.length % (SELECT_COLORS.length - 1))],
    };
    options.push(option);
    byId.set(option.id, option);
    byName.set(key, option);
    return option;
  };
  const fromOptions = new Map((from.config?.options ?? []).map((o) => [o.id, o.name]));
  const optionsOf = (value: Obj | null, text: string): string[] => {
    if (value && SELECT_TYPES.has(from.type)) {
      return optionIdsOf(value).flatMap((id) => {
        if (byId.has(id)) return [id];
        const name = fromOptions.get(id);
        return name ? [optionNamed(name).id] : [];
      });
    }
    const names = to.type === 'multi_select' ? text.split(',') : [text];
    return [...new Set(names.filter((n) => n.trim() !== '').map((name) => optionNamed(name).id))];
  };

  for (const row of rows) {
    const before = 'stored' in row ? (row.stored ?? null) : (row.value ?? null);
    if (row.value === undefined || row.value === null) {
      if (before !== null) values.set(row.id, null);
      continue;
    }
    const value = asObject(row.value);
    const text = valueText(from, row.value);
    let next: unknown = null;
    switch (to.type) {
      case 'text':
      case 'url':
      case 'email':
      case 'phone': {
        const max = MAX_LENGTH[to.type] ?? 0;
        if (text !== '' && text.length <= max)
          next = to.type === 'text' ? { text } : { value: text };
        break;
      }
      case 'number': {
        if (value && typeof value.number === 'number' && Number.isFinite(value.number)) {
          next = { number: value.number };
        } else if (value && typeof value.checked === 'boolean') {
          next = { number: value.checked ? 1 : 0 };
        } else {
          const n = parseNumber(text);
          if (n !== null) next = { number: n };
        }
        break;
      }
      case 'select':
      case 'status': {
        const [first] = optionsOf(value, text);
        if (first) next = { optionId: first };
        break;
      }
      case 'multi_select': {
        const ids = optionsOf(value, text);
        if (ids.length > 0) next = { optionIds: ids };
        break;
      }
      case 'date': {
        if (value && typeof value.start === 'string' && !Number.isNaN(Date.parse(value.start))) {
          next = {
            start: new Date(value.start).toISOString(),
            end:
              typeof value.end === 'string' && !Number.isNaN(Date.parse(value.end))
                ? new Date(value.end).toISOString()
                : null,
            includeTime: value.includeTime === true,
          };
        } else if (ISO_DATE.test(text.trim()) && !Number.isNaN(Date.parse(text.trim()))) {
          next = {
            start: new Date(text.trim()).toISOString(),
            end: null,
            includeTime: text.includes('T'),
          };
        }
        break;
      }
      case 'checkbox': {
        if (value && typeof value.checked === 'boolean') next = { checked: value.checked };
        else if (value && typeof value.number === 'number') next = { checked: value.number !== 0 };
        else if (text !== '') next = { checked: TRUE_WORDS.has(text.trim().toLowerCase()) };
        break;
      }
      case 'person': {
        const ids = value ? strings(value.userIds) : [];
        if (ids.length > 0) next = { userIds: ids };
        break;
      }
      case 'files': {
        if (value && Array.isArray(value.files) && value.files.length > 0)
          next = { files: value.files };
        break;
      }
      // A relation's rows are another database's: nothing else names them.
      default:
        break;
    }
    if (JSON.stringify(next) !== JSON.stringify(before)) values.set(row.id, next);
  }
  if (SELECT_TYPES.has(to.type)) {
    property.config = { ...property.config, options };
  }
  return { property, values };
}
