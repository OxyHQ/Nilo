import type {
  ButtonAction,
  CalculationFunction,
  ChartAggregate,
  ChartType,
  DatabasePropertyType,
  DateGroupGranularity,
  OpenRowMode,
} from '@oxy.so/nilo-contracts';
import type { WorkspaceRole } from '../hooks/use-workspaces';
/**
 * Shared types for Databases.
 *
 * Mirrors the backend contract:
 *   - apps/api/src/db/schema/databases.ts (properties, views, filters)
 *   - apps/api/src/routes/databases.ts (the wire shapes it serializes)
 *
 * The property types, with the filter operators each takes, come from
 * `@oxy.so/nilo-contracts` itself. Property `value` shapes are validated at
 * write time on the server. The frontend uses these as a TypeScript-only
 * assertion of the payload it sends — the wire shape stays JSON-clean.
 */

export type {
  ButtonAction,
  CalculationFunction,
  ChartAggregate,
  ChartType,
  DatabasePropertyType,
  DateGroupGranularity,
  OpenRowMode,
} from '@oxy.so/nilo-contracts';

export type SelectColor =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red';

export const SELECT_COLORS: readonly SelectColor[] = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
];

export interface SelectOption {
  id: string;
  name: string;
  color: SelectColor;
  /** A Noted label's own colour, shown as `color` until it is changed in Nilo. */
  noteColor?: string;
}

export type NumberFormat =
  | 'number'
  | 'number_with_commas'
  | 'percent'
  | 'currency:USD'
  | 'currency:EUR'
  | 'currency:GBP'
  | 'currency:JPY';

/** A status property's three groups, always in this order (the API keeps them whole). */
export const STATUS_GROUP_IDS = ['todo', 'in_progress', 'complete'] as const;
export type StatusGroupId = (typeof STATUS_GROUP_IDS)[number];

export interface StatusGroup {
  id: StatusGroupId;
  optionIds: string[];
}

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
  'show_original',
  'percent_empty',
  'percent_not_empty',
] as const;
export type RollupFunction = (typeof ROLLUP_FUNCTIONS)[number];

export interface PropertyConfig {
  options?: SelectOption[];
  /** A status property's groups; absent on one not written since groups existed. */
  groups?: StatusGroup[];
  format?: NumberFormat;
  precision?: number;
  includeTime?: boolean;
  dateFormat?: DateFormat;
  targetDatabaseId?: string;
  twoWay?: boolean;
  /** Server-owned reciprocal property ID. Never included in writes. */
  syncedPropertyId?: string;
  relationPropertyId?: string;
  targetPropertyId?: string;
  function?: RollupFunction;
  expression?: string;
  prefix?: string;
  /** A button's actions, run in order when it is pressed. */
  actions?: ButtonAction[];
}

/** The Name property's id: its value is the row's title, and its type is always text. */
export const NAME_PROPERTY_ID = 'name';

export interface DatabaseProperty {
  id: string;
  name: string;
  type: DatabasePropertyType;
  config?: PropertyConfig;
}

export interface DatabaseSchema {
  properties: DatabaseProperty[];
}

export interface Database {
  id: string;
  workspaceId: string;
  teamspaceId: string | null;
  name: string;
  icon: string | null;
  cover: string | null;
  ownerId: string;
  schema: DatabaseSchema;
  isInline: boolean;
  parentPageId: string | null;
  archived: boolean;
  /** Its properties and own views are not to be changed (423 DATABASE_LOCKED); rows still are. */
  locked?: boolean;
  /**
   * The app that keeps this database (Noted's notes and folders), null for
   * every other one: its own properties cannot be removed or retyped, nor the
   * database deleted (409 SYSTEM_PROPERTY / SYSTEM_DATABASE).
   */
  systemKey: SystemDatabaseKey | null;
  createdAt: string;
  updatedAt: string;
}

export type SystemDatabaseKey = 'notes' | 'note_folders';

export type DatabaseViewType =
  | 'table'
  | 'board'
  | 'gallery'
  | 'list'
  | 'calendar'
  | 'timeline'
  | 'form'
  | 'chart';

export type SortDirection = 'asc' | 'desc';

export interface ViewSort {
  propertyId: string;
  direction: SortDirection;
}

export interface FilterCondition {
  kind: 'condition';
  propertyId: string;
  operator: string;
  value?: unknown;
}

export interface FilterGroup {
  kind: 'group';
  combinator: 'and' | 'or';
  filters: Filter[];
}

export type Filter = FilterCondition | FilterGroup;

/** How a view groups its rows (a table's or a list's sections, a board's columns or sub-groups). */
export interface ViewGroupBy {
  propertyId: string;
  /** A date's groups: by day (the default), week, month or year. */
  granularity?: DateGroupGranularity;
  /** The groups no row is in are not shown. */
  hideEmpty?: boolean;
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

export interface ViewConfig {
  description?: string;
  datePropertyId?: string;
  startPropertyId?: string;
  endPropertyId?: string;
  coverSource?: 'property' | 'pageCover' | 'none';
  coverPropertyId?: string;
  fit?: 'cover' | 'contain';
  /** Where the view opens a row; absent, in a side peek. */
  openIn?: OpenRowMode;
  /** A table's column widths, by property id (`name` for the title). */
  columnWidths?: Record<string, number>;
  /** The view's own property order; ids it misses follow in the database's order. */
  propertyOrder?: string[];
  /** A table's footer: what it computes over each property of all the view's rows. */
  calculations?: Record<string, CalculationFunction>;
  chart?: ViewChartConfig;
  /**
   * The groups of the view's rows (`groupBy`, a board's `subGroupBy`): a
   * number's ranges (absent, round ones spanning the rows' numbers), the
   * groups first and in this order, those shown collapsed to every reader,
   * those not shown (nor their rows).
   */
  numberGrouping?: ViewNumberGrouping;
  groupOrder?: ViewGroupKey[];
  collapsedGroups?: ViewGroupKey[];
  hiddenGroups?: ViewGroupKey[];
}

export interface DatabaseView {
  blockId?: string | null;
  id: string;
  databaseId: string;
  name: string;
  type: DatabaseViewType;
  isDefault: boolean;
  filters: FilterGroup;
  sorts: ViewSort[];
  groupBy: ViewGroupBy | null;
  /** A board's sub-groups: its rows of columns. */
  subGroupBy?: ViewGroupBy | null;
  hiddenProperties: string[];
  frozenProperties: string[];
  pageSize: number;
  config: ViewConfig;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Stored property value shapes — what the backend sends back and accepts
 * on write.
 */
export interface TextValue {
  text: string;
  error?: string;
}
export interface NumberValue {
  number: number | null;
}
export interface SelectValue {
  optionId: string | null;
}
export interface MultiSelectValue {
  optionIds: string[];
}
export interface DateValue {
  start: string | null;
  end?: string | null;
  includeTime?: boolean;
}
export interface PersonValue {
  userIds: string[];
}
/** A file is a link (`url`), or a file in its owner's Oxy storage (`fileId`), shown through a link. */
export interface FileEntry {
  name: string;
  url?: string;
  fileId?: string;
}
export interface FilesValue {
  files: FileEntry[];
}
export interface CheckboxValue {
  checked: boolean;
}
export interface ScalarStringValue {
  value: string;
}
export interface RelationValue {
  pageIds: string[];
}

export type PropertyValue =
  | TextValue
  | NumberValue
  | SelectValue
  | MultiSelectValue
  | DateValue
  | PersonValue
  | FilesValue
  | CheckboxValue
  | ScalarStringValue
  | RelationValue
  | null;

export interface DatabaseRow {
  id: string;
  workspaceId: string;
  parentId: string | null;
  databaseId: string | null;
  title: string;
  icon: string | null;
  cover: string | null;
  ownerId: string;
  archived: boolean;
  order: number;
  properties: Record<string, PropertyValue>;
  createdAt: string;
  updatedAt: string;
  /**
   * A grouped view's: the group the row is listed in (an option or user id,
   * `YYYY-MM-DD`, a text, `true`/`false`; null for the empty group). A row
   * with several labels or people is listed in each of their groups.
   */
  groupKey?: string | null;
}

/** A number range's bounds: from (included) to (excluded), null where it is open. */
export interface GroupRange {
  from: number | null;
  to: number | null;
}

/** A grouped view's group, in order, with how many rows it holds. */
export interface RowGroup {
  key: string | null;
  count: number;
  /** A number range's group: its bounds (its key is its index). */
  range?: GroupRange;
}

export interface DatabasesListResponse {
  databases: Database[];
}

export interface DatabaseResponse {
  database: Database;
  views?: DatabaseView[];
}

/** `GET /databases/:id`: the database, its own views and the caller's role on it. */
export interface DatabaseDetail {
  database: Database;
  views: DatabaseView[];
  role: WorkspaceRole;
}

export interface DatabaseRowsResponse {
  rows: DatabaseRow[];
  total: number;
  cursor: string | null;
  view: DatabaseView | null;
  /** A grouped view's groups, in order (every option, even one no row holds). */
  groups?: RowGroup[];
}

/** Each footer calculation's value, by property id. */
export type CalculationValues = Record<
  string,
  { function: CalculationFunction; value: number | null }
>;

/** `GET /databases/:id/views/:viewId/calculations`: each footer calculation's value. */
export interface ViewCalculationsResponse {
  calculations: CalculationValues;
  /** A grouped view's: each group's, in the groups' order. */
  groups?: { key: string | null; calculations: CalculationValues }[];
}

/** `GET /databases/:id/views/:viewId/chart`: a point per group of the chart's axis. */
export interface ViewChartResponse {
  points: { key: string | null; count: number; value: number | null; range?: GroupRange }[];
}

export interface DatabaseRowResponse {
  row: DatabaseRow;
}

export interface DatabaseViewsResponse {
  views: DatabaseView[];
}

export interface DatabaseViewResponse {
  view: DatabaseView;
}
