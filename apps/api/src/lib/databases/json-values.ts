/**
 * Readers of stored property values (`pages.properties`, computed values
 * merged in), which are plain JSON: whatever is not the shape a reader
 * expects reads as nothing, never as an error.
 */

/** `value` as an object to read fields of, or null when it is none. */
export const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

/** The finite number a number value holds, or null. */
export function numberOf(value: unknown): number | null {
  const n = asObject(value)?.number;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** The strings in `value[field]`'s list; none when it is no list. */
export function stringsAt(value: unknown, field: string): string[] {
  const list = asObject(value)?.[field];
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
}

/** JavaScript truthiness of a JSON value, as `view-query.ts`' `truthy` reads it in SQL. */
export function truthy(x: unknown): boolean {
  if (typeof x === 'string') return x !== '';
  if (typeof x === 'number') return x !== 0;
  if (typeof x === 'boolean') return x;
  return typeof x === 'object' && x !== null;
}
