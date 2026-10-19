/**
 * Database property types and the filter operators each one takes.
 *
 * The API refuses a view whose filter uses an operator its property's type
 * does not take, and the app offers exactly these operators, so the two read
 * one table and cannot drift.
 */

export const DATABASE_PROPERTY_TYPES = [
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'person',
  'files',
  'checkbox',
  'url',
  'email',
  'phone',
  'relation',
  'rollup',
  'created_time',
  'last_edited_time',
  'created_by',
  'last_edited_by',
  'formula',
  // A number every row gets in turn when it is created (with an optional prefix: TASK-12).
  'unique_id',
] as const;
export type DatabasePropertyType = (typeof DATABASE_PROPERTY_TYPES)[number];

const TEXT = [
  'contains',
  'equals',
  'does_not_equal',
  'starts_with',
  'ends_with',
  'is_empty',
  'is_not_empty',
] as const;
const NUMBER = ['=', '!=', '>', '<', '>=', '<=', 'is_empty', 'is_not_empty'] as const;
const OPTION = ['is', 'is_not', 'is_empty', 'is_not_empty'] as const;
const LIST = ['contains', 'does_not_contain', 'is_empty', 'is_not_empty'] as const;
const DATE = [
  'before',
  'after',
  'on_or_before',
  'on_or_after',
  'equals',
  'is_empty',
  'is_not_empty',
  'in_last',
  'in_next',
] as const;
const INSTANT = ['before', 'after', 'on_or_before', 'on_or_after', 'equals'] as const;
const CHECKBOX = ['is', 'is_not'] as const;
const CONTACT = ['contains', 'equals', 'is_empty', 'is_not_empty'] as const;
const EMPTINESS = ['is_empty', 'is_not_empty'] as const;

/**
 * The operators each property type offers. A row's creation and edit times and
 * authors are never empty, so they offer no emptiness test; an ID compares as
 * the number it is.
 */
export const FILTER_OPERATORS_BY_TYPE: Readonly<Record<DatabasePropertyType, readonly string[]>> = {
  text: TEXT,
  number: NUMBER,
  unique_id: NUMBER,
  select: OPTION,
  status: OPTION,
  multi_select: LIST,
  person: LIST,
  relation: LIST,
  date: DATE,
  created_time: INSTANT,
  last_edited_time: INSTANT,
  created_by: ['contains', 'does_not_contain'],
  last_edited_by: ['contains', 'does_not_contain'],
  files: EMPTINESS,
  checkbox: CHECKBOX,
  url: CONTACT,
  email: CONTACT,
  phone: CONTACT,
  rollup: EMPTINESS,
  formula: EMPTINESS,
};

/**
 * Whether a filter on a property of `type` may use `operator`. A formula or a
 * rollup is compared as the text, number, date or checkbox it gives, which its
 * schema does not tell, so it takes any of those types' operators.
 */
export function acceptsFilterOperator(type: DatabasePropertyType, operator: string): boolean {
  if (type === 'formula' || type === 'rollup') {
    return [TEXT, NUMBER, DATE, CHECKBOX].some((operators) =>
      (operators as readonly string[]).includes(operator),
    );
  }
  return FILTER_OPERATORS_BY_TYPE[type].includes(operator);
}
