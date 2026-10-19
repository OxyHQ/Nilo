import { acceptsFilterOperator } from '@oxy.so/nilo-contracts';
import { z } from 'zod';
import type {
  DatabaseProperty,
  DatabasePropertyType,
  Filter,
  FilterCondition,
  FilterGroup,
} from '../../db/schema/databases.js';

/**
 * Zod schemas for filter trees. Filters self-reference (groups contain
 * filters, which can be groups), so we accept the wire shape as JSON and
 * validate by hand through a small typed walker — this sidesteps Zod's
 * known issue with `z.lazy` + literal discriminators widening `kind`
 * back to `string | undefined`.
 *
 * The exported `filterGroupSchema` is shaped like a normal Zod schema
 * (it owns `.parse(value)`) so the route layer reads identically to the
 * other validators in the codebase.
 */
function parseFilter(value: unknown, path: string[]): Filter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        path,
        message: 'Filter must be an object',
      },
    ]);
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind === 'condition') {
    if (typeof raw.propertyId !== 'string' || raw.propertyId.length === 0) {
      throw new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: [...path, 'propertyId'],
          message: 'propertyId required',
        },
      ]);
    }
    if (typeof raw.operator !== 'string' || raw.operator.length === 0) {
      throw new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: [...path, 'operator'],
          message: 'operator required',
        },
      ]);
    }
    return {
      kind: 'condition',
      propertyId: raw.propertyId,
      operator: raw.operator,
      value: raw.value,
    };
  }
  if (raw.kind === 'group') {
    if (raw.combinator !== 'and' && raw.combinator !== 'or') {
      throw new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: [...path, 'combinator'],
          message: 'combinator must be "and" or "or"',
        },
      ]);
    }
    if (!Array.isArray(raw.filters)) {
      throw new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: [...path, 'filters'],
          message: 'filters must be an array',
        },
      ]);
    }
    const filters = raw.filters.map((child, i) =>
      parseFilter(child, [...path, 'filters', String(i)]),
    );
    return { kind: 'group', combinator: raw.combinator, filters };
  }
  throw new z.ZodError([
    {
      code: z.ZodIssueCode.custom,
      path: [...path, 'kind'],
      message: 'kind must be "condition" or "group"',
    },
  ]);
}

/**
 * Hand-rolled Zod schema for filter groups — `.parse()` runs the typed
 * walker above and throws `ZodError` for shape mismatches. We wrap it
 * with `z.unknown().transform(...)` so callers can chain `.optional()`
 * etc. exactly like any other Zod schema.
 */
export const filterGroupSchema = z.unknown().transform((raw, ctx): FilterGroup => {
  try {
    const parsed = parseFilter(raw, []);
    if (parsed.kind !== 'group') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kind'],
        message: 'Top-level filter must be a group',
      });
      return { kind: 'group', combinator: 'and', filters: [] };
    }
    return parsed;
  } catch (err) {
    if (err instanceof z.ZodError) {
      for (const issue of err.errors) {
        ctx.addIssue(issue);
      }
    } else {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid filter',
      });
    }
    return { kind: 'group', combinator: 'and', filters: [] };
  }
});

/**
 * The first condition of a filter tree the database cannot evaluate: one on a
 * property it does not have, or with an operator its property's type does not
 * take (`@oxy.so/nilo-contracts` `FILTER_OPERATORS_BY_TYPE`). Null when every
 * condition is sound. The shape is `filterGroupSchema`'s; this needs the schema.
 */
export function invalidCondition(
  filter: Filter,
  propertyById: Map<string, DatabaseProperty>,
): FilterCondition | null {
  if (filter.kind === 'group') {
    for (const child of filter.filters) {
      const invalid = invalidCondition(child, propertyById);
      if (invalid) return invalid;
    }
    return null;
  }
  const property = propertyById.get(filter.propertyId);
  return property && acceptsFilterOperator(property.type, filter.operator) ? null : filter;
}

/**
 * Read property value for filter/sort evaluation. Returns the raw JSON
 * stored on the Page (or null if missing). Server-derived properties are
 * resolved from page fields.
 */
export function readPropertyValue(
  page: {
    properties: Map<string, unknown> | Record<string, unknown> | undefined;
    title?: string;
    ownerId?: string;
    lastEditedBy?: string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
  },
  property: DatabaseProperty,
): unknown {
  // Title mirrors the "name" property.
  if (property.id === 'name' && property.type === 'text') {
    return { text: page.title ?? '' };
  }

  switch (property.type) {
    case 'created_time':
      return { start: page.createdAt ? new Date(page.createdAt).toISOString() : null };
    case 'last_edited_time':
      return { start: page.updatedAt ? new Date(page.updatedAt).toISOString() : null };
    case 'created_by':
      return { userIds: page.ownerId ? [page.ownerId] : [] };
    case 'last_edited_by': {
      const editor = page.lastEditedBy ?? page.ownerId;
      return { userIds: editor ? [editor] : [] };
    }
    default:
      break;
  }

  if (!page.properties) return null;
  if (page.properties instanceof Map) {
    return page.properties.get(property.id) ?? null;
  }
  const obj = page.properties as Record<string, unknown>;
  return obj[property.id] ?? null;
}

/**
 * Evaluate a filter tree against a single row. Returns true if the row
 * should be included.
 *
 * Empty groups (no children) are treated as passing — Notion's behaviour.
 */
export function evaluateFilter(
  filter: Filter,
  row: Parameters<typeof readPropertyValue>[0],
  propertyById: Map<string, DatabaseProperty>,
): boolean {
  if (filter.kind === 'group') {
    if (filter.filters.length === 0) return true;
    if (filter.combinator === 'and') {
      return filter.filters.every((child) => evaluateFilter(child, row, propertyById));
    }
    return filter.filters.some((child) => evaluateFilter(child, row, propertyById));
  }

  const prop = propertyById.get(filter.propertyId);
  if (!prop) return true; // Unknown property — don't filter out the row.
  const value = readPropertyValue(row, prop);
  return evaluateCondition(filter.operator, value, filter.value, valueType(prop, value));
}

/**
 * The type a value is compared as. A formula or rollup holds a number, a
 * checkbox, a date or text depending on its result; everything else is its
 * property's type.
 */
export function valueType(property: DatabaseProperty, value: unknown): DatabasePropertyType {
  if (property.type === 'unique_id') return 'number';
  if (property.type !== 'formula' && property.type !== 'rollup') return property.type;
  const v = (value ?? {}) as Record<string, unknown>;
  if (typeof v.number === 'number') return 'number';
  if (typeof v.checked === 'boolean') return 'checkbox';
  if (typeof v.start === 'string') return 'date';
  return 'text';
}

/** Whether a filter tree or sort list reads a computed property (formula, rollup). */
export function readsComputed(
  propertyIds: readonly string[],
  propertyById: Map<string, DatabaseProperty>,
): boolean {
  return propertyIds.some((id) => {
    const type = propertyById.get(id)?.type;
    return type === 'formula' || type === 'rollup';
  });
}

/** Every property a filter tree refers to. */
export function filterPropertyIds(filter: Filter): string[] {
  return filter.kind === 'group' ? filter.filters.flatMap(filterPropertyIds) : [filter.propertyId];
}

/** `is_empty`: whether a value of `type` holds nothing (a checkbox never does). */
export function isEmpty(value: unknown, type: DatabasePropertyType): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object') return true;
  const v = value as Record<string, unknown>;
  switch (type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return !v.text && !v.value;
    case 'number':
      return v.number === null || v.number === undefined;
    case 'select':
    case 'status':
      return !v.optionId;
    case 'multi_select':
      return !Array.isArray(v.optionIds) || v.optionIds.length === 0;
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return !v.start;
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      return !Array.isArray(v.userIds) || v.userIds.length === 0;
    case 'files':
      return !Array.isArray(v.files) || v.files.length === 0;
    case 'checkbox':
      // Checkbox is never "empty" — false counts as a real value.
      return false;
    case 'relation':
      return !Array.isArray(v.pageIds) || v.pageIds.length === 0;
    default:
      return true;
  }
}

/**
 * Whether a negative operator holds for an empty value, as in Notion: a row
 * with no option "is not" any option, and one with no labels, people or
 * related rows "does not contain" any. A checkbox is never empty but when it
 * was never set, which says nothing of what it is not.
 */
export function emptyMatches(operator: string, type: DatabasePropertyType): boolean {
  switch (type) {
    case 'select':
    case 'status':
      return operator === 'is_not';
    case 'multi_select':
    case 'person':
    case 'relation':
    case 'created_by':
    case 'last_edited_by':
      return operator === 'does_not_contain';
    default:
      return false;
  }
}

function evaluateCondition(
  operator: string,
  value: unknown,
  filterValue: unknown,
  type: DatabasePropertyType,
): boolean {
  if (operator === 'is_empty') return isEmpty(value, type);
  if (operator === 'is_not_empty') return !isEmpty(value, type);

  // An empty value passes only the negative operators (`emptyMatches`).
  if (isEmpty(value, type)) return emptyMatches(operator, type);

  const obj = (value ?? {}) as Record<string, unknown>;

  switch (type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone': {
      const haystack = String(obj.text ?? obj.value ?? '').toLowerCase();
      const needle = String(filterValue ?? '').toLowerCase();
      switch (operator) {
        case 'equals':
          return haystack === needle;
        case 'does_not_equal':
          return haystack !== needle;
        case 'contains':
          return haystack.includes(needle);
        case 'starts_with':
          return haystack.startsWith(needle);
        case 'ends_with':
          return haystack.endsWith(needle);
        default:
          return false;
      }
    }
    case 'number': {
      const n = obj.number as number | null;
      const target = Number(filterValue);
      if (n === null || n === undefined || Number.isNaN(target)) return false;
      switch (operator) {
        case '=':
          return n === target;
        case '!=':
          return n !== target;
        case '>':
          return n > target;
        case '<':
          return n < target;
        case '>=':
          return n >= target;
        case '<=':
          return n <= target;
        default:
          return false;
      }
    }
    case 'select':
    case 'status': {
      const selected = obj.optionId as string | null;
      switch (operator) {
        case 'is':
          return selected === String(filterValue);
        case 'is_not':
          return selected !== String(filterValue);
        default:
          return false;
      }
    }
    case 'multi_select':
    case 'person':
    case 'created_by':
    case 'last_edited_by':
    case 'relation': {
      const arr =
        (obj.optionIds as string[] | undefined) ??
        (obj.userIds as string[] | undefined) ??
        (obj.pageIds as string[] | undefined) ??
        [];
      const target = String(filterValue ?? '');
      switch (operator) {
        case 'contains':
          return arr.includes(target);
        case 'does_not_contain':
          return !arr.includes(target);
        default:
          return false;
      }
    }
    case 'date':
    case 'created_time':
    case 'last_edited_time': {
      const start = obj.start as string | null;
      if (!start) return false;
      const valueDate = new Date(start).getTime();
      if (operator === 'in_last' || operator === 'in_next') {
        const days = Number(filterValue);
        if (!Number.isFinite(days)) return false;
        const now = Date.now();
        if (operator === 'in_last') {
          const threshold = now - days * 24 * 60 * 60 * 1000;
          return valueDate >= threshold && valueDate <= now;
        }
        const threshold = now + days * 24 * 60 * 60 * 1000;
        return valueDate >= now && valueDate <= threshold;
      }
      const target = filterValue ? new Date(String(filterValue)).getTime() : NaN;
      if (Number.isNaN(target)) return false;
      switch (operator) {
        case 'before':
          return valueDate < target;
        case 'after':
          return valueDate > target;
        case 'on_or_before':
          return valueDate <= target;
        case 'on_or_after':
          return valueDate >= target;
        case 'equals': {
          // Compare day-precision unless the underlying property includes time.
          const includeTime = Boolean(obj.includeTime);
          if (includeTime) return valueDate === target;
          const a = startOfDay(valueDate);
          const b = startOfDay(target);
          return a === b;
        }
        default:
          return false;
      }
    }
    case 'checkbox': {
      const checked = Boolean(obj.checked);
      const target = Boolean(filterValue);
      if (operator === 'is') return checked === target;
      if (operator === 'is_not') return checked !== target;
      return false;
    }
    default:
      return false;
  }
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}
