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
  // A button in each row that runs its actions (open a link, set a value, add a row).
  'button',
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
  // A button holds no value: nothing to filter on.
  button: [],
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

/** The Name property's id: its value is the row's title, and its type is always text. */
export const NAME_PROPERTY_ID = 'name';

/**
 * A status property's groups, as Notion's: every option is in exactly one, and
 * they are always these three, in this order. Their names are the app's to
 * translate, so only the id is stored.
 */
export const STATUS_GROUP_IDS = ['todo', 'in_progress', 'complete'] as const;
export type StatusGroupId = (typeof STATUS_GROUP_IDS)[number];

export interface StatusGroup {
  id: StatusGroupId;
  optionIds: string[];
}

/** How a date property shows its dates; absent, the reader's locale's default. */
export const DATE_FORMATS = [
  'full',
  'short',
  'month_day_year',
  'day_month_year',
  'iso',
  'relative',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const ROLLUP_FUNCTIONS = [
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'earliest',
  'latest',
  /** The related values themselves, listed. */
  'show_original',
  'percent_empty',
  'percent_not_empty',
] as const;
export type RollupFunction = (typeof ROLLUP_FUNCTIONS)[number];

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * The types a view's rows can be grouped by (a table's, a list's, a
 * gallery's or a timeline's sections, a board's sub-groups, a chart's axis):
 * one group per option, person, day, week, month or year, text, checked and
 * not, or range of numbers — a formula's or a rollup's numbers too.
 */
export const GROUPABLE_PROPERTY_TYPES = [
  'select',
  'status',
  'multi_select',
  'person',
  'created_by',
  'last_edited_by',
  'checkbox',
  'date',
  'created_time',
  'last_edited_time',
  'text',
  'url',
  'email',
  'phone',
  'number',
  'formula',
  'rollup',
] as const satisfies readonly DatabasePropertyType[];

export function isGroupableType(type: DatabasePropertyType): boolean {
  return (GROUPABLE_PROPERTY_TYPES as readonly string[]).includes(type);
}

/** How dates are grouped: by the day, the week (from Monday), the month or the year they fall in. */
export const DATE_GROUP_GRANULARITIES = ['day', 'week', 'month', 'year'] as const;
export type DateGroupGranularity = (typeof DATE_GROUP_GRANULARITIES)[number];

/**
 * The most ranges a view's numbers are grouped into (`config.numberGrouping`:
 * from, to and the size of each range), besides those below and above.
 */
export const MAX_NUMBER_GROUPS = 100;

/** How many ranges of `step` from `from` up to `to` make: the last one may be cut short. */
export function numberGroupCount(grouping: { from: number; to: number; step: number }): number {
  const { from, to, step } = grouping;
  if (!(step > 0) || !(to > from)) return 0;
  // A step that divides the span all but exactly (0.3 / 0.1) counts as dividing it.
  return Math.ceil((to - from) / step - 1e-9);
}

/**
 * A number property's groups: `count` ranges of `step` from `from`, the last
 * one ending at `to` — keys `0` to `count - 1` — and the numbers below `from`
 * (`-1`) and from `to` up (`count`) in groups of their own.
 */
export interface NumberRanges {
  from: number;
  to: number;
  step: number;
  count: number;
}

/** The ranges a view's `numberGrouping` makes: at least one, at most `MAX_NUMBER_GROUPS`. */
export function numberRanges(grouping: { from: number; to: number; step: number }): NumberRanges {
  const count = Math.min(MAX_NUMBER_GROUPS, Math.max(1, numberGroupCount(grouping)));
  return { from: grouping.from, to: grouping.to, step: grouping.step, count };
}

/** A number group's bounds: from (included) to (excluded), null where it is open. */
export function numberGroupRange(
  key: string,
  ranges: NumberRanges,
): { from: number | null; to: number | null } {
  const i = Number(key);
  if (i < 0) return { from: null, to: ranges.from };
  if (i >= ranges.count) return { from: ranges.to, to: null };
  const from = ranges.from + i * ranges.step;
  return { from, to: Math.min(ranges.to, from + ranges.step) };
}

/**
 * The config keys that name the groups of a view's rows: they name that
 * property's values, so they go when the view is grouped by another.
 */
export const VIEW_GROUP_CONFIG_KEYS = [
  'numberGrouping',
  'groupOrder',
  'collapsedGroups',
  'hiddenGroups',
] as const;

/** `config` without the keys of its groups, or null when it has none. */
export function withoutGroupKeys<C extends object>(config: C): C | null {
  if (!VIEW_GROUP_CONFIG_KEYS.some((key) => key in config)) return null;
  const out: C = { ...config };
  for (const key of VIEW_GROUP_CONFIG_KEYS) delete (out as Record<string, unknown>)[key];
  return out;
}

/** How a property's rows are grouped: by option, by date, by text or user id, checked, or by number range. */
export type GroupKind =
  | 'option'
  | 'list_option'
  | 'date'
  | 'text'
  | 'people'
  | 'user'
  | 'checkbox'
  | 'number';

export function groupKind(type: DatabasePropertyType): GroupKind | null {
  if (!isGroupableType(type)) return null;
  switch (type) {
    case 'select':
    case 'status':
      return 'option';
    case 'multi_select':
      return 'list_option';
    case 'person':
      return 'people';
    case 'created_by':
    case 'last_edited_by':
      return 'user';
    case 'checkbox':
      return 'checkbox';
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return 'date';
    // A formula's or a rollup's numbers; a value of it that is no number is empty.
    case 'number':
    case 'formula':
    case 'rollup':
      return 'number';
    default:
      return 'text';
  }
}

/** The views whose rows come in sections, one per group (`groupBy`); a board's are its sub-groups. */
export const SECTIONED_VIEWS: ReadonlySet<string> = new Set([
  'table',
  'list',
  'gallery',
  'timeline',
]);

// ---------------------------------------------------------------------------
// Calculations
// ---------------------------------------------------------------------------

/** What a view's footer can compute over a property of all its rows. */
export const CALCULATION_FUNCTIONS = [
  'count_all',
  'count_values',
  'count_unique',
  'count_empty',
  'count_not_empty',
  'percent_empty',
  'percent_not_empty',
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
  'earliest',
  'latest',
  'date_range',
  'checked',
  'unchecked',
  'percent_checked',
] as const;
export type CalculationFunction = (typeof CALCULATION_FUNCTIONS)[number];

const COUNTS = [
  'count_all',
  'count_values',
  'count_unique',
  'count_empty',
  'count_not_empty',
  'percent_empty',
  'percent_not_empty',
] as const;
const EMPTINESS_COUNTS = [
  'count_all',
  'count_empty',
  'count_not_empty',
  'percent_empty',
  'percent_not_empty',
] as const;
const NUMERIC = ['sum', 'average', 'median', 'min', 'max', 'range'] as const;
const DATES = ['earliest', 'latest', 'date_range'] as const;

/**
 * The calculations that make sense for each type: every type counts, numbers
 * add up, dates span, checkboxes tick. A formula or a rollup is counted and,
 * when it gives numbers, added up. A creation or edit time or author is never
 * empty, so it offers no emptiness count; a button holds no value at all.
 */
export const CALCULATIONS_BY_TYPE: Readonly<
  Record<DatabasePropertyType, readonly CalculationFunction[]>
> = {
  text: COUNTS,
  url: COUNTS,
  email: COUNTS,
  phone: COUNTS,
  number: [...COUNTS, ...NUMERIC],
  unique_id: ['count_all', 'count_unique', ...NUMERIC],
  select: COUNTS,
  status: COUNTS,
  multi_select: COUNTS,
  person: COUNTS,
  relation: COUNTS,
  files: COUNTS,
  date: [...COUNTS, ...DATES],
  created_time: ['count_all', 'count_unique', ...DATES],
  last_edited_time: ['count_all', 'count_unique', ...DATES],
  created_by: ['count_all', 'count_unique'],
  last_edited_by: ['count_all', 'count_unique'],
  checkbox: ['count_all', 'checked', 'unchecked', 'percent_checked'],
  formula: [...EMPTINESS_COUNTS, ...NUMERIC],
  rollup: [...EMPTINESS_COUNTS, ...NUMERIC],
  button: ['count_all'],
};

export function acceptsCalculation(type: DatabasePropertyType, fn: string): boolean {
  return (CALCULATIONS_BY_TYPE[type] as readonly string[]).includes(fn);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Where a view opens a row: beside the view, over it, or as its own page. */
export const OPEN_ROW_MODES = ['side_peek', 'center_peek', 'full_page'] as const;
export type OpenRowMode = (typeof OPEN_ROW_MODES)[number];

/** A chart view's chart. */
export const CHART_TYPES = ['bar', 'line', 'donut'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** What a chart measures per group: how many rows, or the sum or average of a number. */
export const CHART_AGGREGATES = ['count', 'sum', 'average'] as const;
export type ChartAggregate = (typeof CHART_AGGREGATES)[number];

/** The types a chart adds up or averages (`yAxis.propertyId`): stored numbers. */
export const CHART_MEASURABLE_TYPES = [
  'number',
  'unique_id',
] as const satisfies readonly DatabasePropertyType[];

export function isChartMeasurable(type: DatabasePropertyType): boolean {
  return (CHART_MEASURABLE_TYPES as readonly string[]).includes(type);
}

/** A number's groups: ranges of `step` from `from` up to `to`, those below and above apart. */
export interface ViewNumberGrouping {
  from: number;
  to: number;
  step: number;
}

/** A group named in a view's config: its key (`RowGroup.key`), null for the empty group. */
export type ViewGroupKey = string | null;

/** A chart view's chart: one point per group of `xAxis`, measuring `yAxis`. */
export interface ViewChartConfig {
  type: ChartType;
  xAxis?: { propertyId: string; granularity?: DateGroupGranularity };
  yAxis?: { aggregate: ChartAggregate; propertyId?: string };
}

/** A table column's narrowest and widest, in points. */
export const MIN_COLUMN_WIDTH = 60;
export const MAX_COLUMN_WIDTH = 1200;

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

/** What a button property does when pressed, in order. */
export const BUTTON_ACTION_KINDS = ['open_url', 'set_property', 'create_row'] as const;
export type ButtonActionKind = (typeof BUTTON_ACTION_KINDS)[number];

export type ButtonAction =
  /** Open a link (http, https or mailto). */
  | { kind: 'open_url'; url: string }
  /** Set one of the row's own properties to `value` (the shape its type stores). */
  | { kind: 'set_property'; propertyId: string; value: unknown }
  /** Add a row to a database (this one when `databaseId` is absent), titled `title`. */
  | { kind: 'create_row'; databaseId?: string; title?: string };

/** The most actions one button runs. */
export const MAX_BUTTON_ACTIONS = 5;
