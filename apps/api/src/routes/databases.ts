import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { isLiveEntityId } from '@oxy.so/db';
import {
  acceptsCalculation,
  CALCULATION_FUNCTIONS,
  CHART_AGGREGATES,
  CHART_TYPES,
  MAX_NUMBER_GROUPS,
  numberGroupCount,
  DATE_GROUP_GRANULARITIES,
  isChartMeasurable,
  MAX_BUTTON_ACTIONS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  OPEN_ROW_MODES,
  viewIsEditable,
} from '@oxy.so/nilo-contracts';
import { z } from 'zod';
import { getDb, type PgHandle } from '../db/client.js';
import {
  DATABASE_PROPERTY_TYPES,
  DATABASE_VIEW_TYPES,
  DATE_FORMATS,
  DEFAULT_VIEW_PAGE_SIZE,
  EMPTY_FILTER_GROUP,
  ROLLUP_FUNCTIONS,
  SELECT_COLORS,
  STATUS_GROUP_IDS,
  type DatabaseProperty,
  type DatabasePropertyType,
  type DatabaseSchema,
  type DatabaseViewType,
  type Filter,
  type PropertyConfig,
  type SelectOption,
  type ViewConfig,
  type ViewGroupBy,
  type ViewNumberGrouping,
  type ViewSort,
} from '../db/schema/databases.js';
import type { PageRow } from '../repositories/pages.js';
import {
  countViews,
  deleteDatabase,
  deleteDatabaseView,
  deleteViewsByDatabase,
  demoteOtherDefaultViews,
  findDatabaseById,
  findDatabaseWorkspaceId,
  findDefaultView,
  findFirstViewByOrder,
  findViewById,
  insertDatabase,
  insertDatabaseView,
  listDatabasesByWorkspace,
  listViewsByDatabase,
  lockViewsOfDatabase,
  nextViewOrder,
  updateDatabase,
  updateDatabaseView,
  writeDatabaseSchema,
  type DatabaseRecord,
  type DatabaseViewRecord,
} from '../repositories/databases.js';
import {
  createPage,
  deleteDatabaseRows,
  findPageById,
  findPagesByIds,
  listDatabaseRows,
  nextDatabaseRowOrder,
  removePropertyFromDatabaseRows,
  writePropertyOfRows,
} from '../repositories/pages.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireWorkspaceMember } from '../middleware/workspace.js';
import { log } from '../lib/logger.js';
import { checkWorkspaceAccess } from '../lib/workspace-access.js';
import { duplicateBlocksToPage } from '../repositories/blocks.js';
import { notifyAssigned } from '../lib/databases/assignments.js';
import { projectNow } from '../lib/page-projection.js';
import {
  createDatabaseWithRows,
  createDefaultViewForDatabase,
  normalizeIncomingProperties,
} from '../lib/databases/create.js';
import { csvToDatabase, databaseToCsv } from '../lib/databases/csv.js';
import { createRow, numberExistingRows } from '../lib/databases/rows.js';
import {
  checkDatabaseAccess,
  checkPageAccess,
  baseRole,
  resolveDatabaseRole,
  visiblePagesOf,
} from '../lib/page-access.js';
import { listDatabasePeople } from '../lib/databases/people.js';
import { loadMemberProfiles } from '../lib/member-profiles.js';
import { hasRole } from '../db/schema/workspaces.js';
import {
  buildDefaultSchema,
  defaultStatusConfig,
  NAME_PROPERTY_ID,
  normalizeStatusGroups,
} from '../lib/databases/schema-defaults.js';
import { convertValues, isComputedType } from '../lib/databases/property-conversion.js';
import {
  buttonActionsRefusal,
  filterRefusal,
  type Refusal,
  viewSettingsRefusal,
} from '../lib/databases/refusals.js';
import { invalidReference } from '../lib/databases/property-references.js';
import {
  evaluateFilter,
  filterGroupSchema,
  filterPropertyIds,
  readsComputed,
} from '../lib/databases/filters.js';
import { compareBySorts } from '../lib/databases/sorts.js';
import {
  accessorFor,
  compileView,
  decodeRowsCursor,
  encodeRowsCursor,
  listViewGroups,
  listViewRows,
  numberBoundsInSql,
} from '../lib/databases/view-query.js';
import {
  countGroups,
  groupRows,
  type GroupKey,
  type GroupSpec,
  isTimeZone,
  numberBounds,
  resolveGroupSpec,
  rowGrouping,
  shownRows,
  summarizeGroups,
} from '../lib/databases/groups.js';
import {
  calculableInSql,
  calculate,
  calculateGroups,
  calculationsInSql,
  type CalculationValue,
  groupCalculationsInSql,
} from '../lib/databases/calculations.js';
import { formulaCellValue, type FormulaValue } from '../lib/databases/formula.js';
import { rowFormulaContext } from '../lib/databases/row-values.js';
import { linkTwoWay, syncRelations, unlinkTwoWay } from '../lib/databases/relations.js';
import { resolveRollups } from '../lib/databases/rollups.js';
import {
  configAfterRegroup,
  schemaWithoutProperty,
  viewAfterRetype,
  viewWithoutProperty,
} from '../lib/databases/property-removal.js';
import {
  keepNoteColors,
  systemDatabaseDeleteError,
  systemPropertyChangeError,
} from '../lib/databases/system.js';
import { placeOrRefuse } from '../lib/placement.js';
import { findBlockById } from '../repositories/blocks.js';
import { findMembership } from '../repositories/workspaces.js';
import { announceChange } from '../collab/live-rooms.js';

const router = Router();

router.use(authenticateToken);

/**
 * The id shape a row can actually have.
 *
 * Replaces a 24-hex ObjectId regex. `isLiveEntityId` is the one place either
 * shape is spelled out: a uuid v7 for every row created on Postgres, and a
 * 24-char ObjectId hex for every row a backfill copied over verbatim — both are
 * live simultaneously, so neither may be rejected. A 24-hex regex here would
 * 400 every id the schema now generates.
 *
 * It exists to turn malformed input into a 400 and nothing else; it is never a
 * precondition on a query, which already answers "no such row" for free.
 */
const entityIdSchema = z.string().refine(isLiveEntityId, 'Invalid id');

const propertyTypeSchema = z.enum(
  DATABASE_PROPERTY_TYPES as readonly [DatabasePropertyType, ...DatabasePropertyType[]],
);

const viewTypeSchema = z.enum(
  DATABASE_VIEW_TYPES as readonly [DatabaseViewType, ...DatabaseViewType[]],
);

const selectColorSchema = z.enum(
  SELECT_COLORS as readonly [SelectOption['color'], ...SelectOption['color'][]],
);

const selectOptionSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  color: selectColorSchema.optional(),
});

/** A link a button opens: the web or an email, nothing a browser would run. */
const BUTTON_LINK = /^(https?:\/\/|mailto:)/iu;

const buttonActionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('open_url'),
      url: z
        .string()
        .trim()
        .max(2000)
        .refine((url) => BUTTON_LINK.test(url), 'Only http, https and mailto links'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('set_property'),
      propertyId: z.string().min(1).max(200),
      /** The value, in the shape its property's type stores (checked when the button is saved). */
      value: z.unknown(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('create_row'),
      /** Absent: this database. */
      databaseId: entityIdSchema.optional(),
      title: z.string().max(2000).optional(),
    })
    .strict(),
]);

const propertyConfigSchema = z
  .object({
    options: z.array(selectOptionSchema).optional(),
    groups: z
      .array(
        z.object({
          id: z.enum(STATUS_GROUP_IDS),
          optionIds: z.array(z.string()).max(500),
        }),
      )
      .max(STATUS_GROUP_IDS.length)
      .optional(),
    format: z
      .union([
        z.literal('number'),
        z.literal('number_with_commas'),
        z.literal('percent'),
        z.literal('currency:USD'),
        z.literal('currency:EUR'),
        z.literal('currency:GBP'),
        z.literal('currency:JPY'),
      ])
      .optional(),
    precision: z.number().int().min(0).max(10).optional(),
    includeTime: z.boolean().optional(),
    dateFormat: z.enum(DATE_FORMATS).optional(),
    targetDatabaseId: entityIdSchema.optional(),
    twoWay: z.boolean().optional(),
    relationPropertyId: z.string().optional(),
    targetPropertyId: z.string().optional(),
    function: z.enum(ROLLUP_FUNCTIONS).optional(),
    expression: z.string().max(2000).optional(),
    /** An ID property's prefix: letters and digits (TASK → TASK-12). */
    prefix: z
      .string()
      .regex(/^[A-Za-z0-9]{0,12}$/)
      .optional(),
    /** A button's actions, run in order when it is pressed. */
    actions: z.array(buttonActionSchema).min(1).max(MAX_BUTTON_ACTIONS).optional(),
  })
  .strict();

const propertySchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
  type: propertyTypeSchema,
  config: propertyConfigSchema.optional(),
});

const databaseSchemaSchema = z.object({
  properties: z.array(propertySchema).min(1),
});

const createDatabaseSchema = z.object({
  workspaceId: entityIdSchema,
  name: z.string().max(2000).optional(),
  icon: z.string().max(200).nullable().optional(),
  cover: z.string().max(2000).nullable().optional(),
  schema: databaseSchemaSchema.optional(),
  isInline: z.boolean().optional(),
  parentPageId: entityIdSchema.nullable().optional(),
  /** A database in no page: its teamspace, null for private; absent, the default one. */
  teamspaceId: entityIdSchema.nullable().optional(),
});

const updateDatabaseSchema = z
  .object({
    name: z.string().max(2000).optional(),
    icon: z.string().max(200).nullable().optional(),
    cover: z.string().max(2000).nullable().optional(),
    archived: z.boolean().optional(),
    /** Lock or unlock its properties and views: the one change a locked database takes to them. */
    locked: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });

const addPropertySchema = propertySchema;

const updatePropertySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    type: propertyTypeSchema.optional(),
    config: propertyConfigSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });

const createRowSchema = z.object({
  title: z.string().max(2000).optional(),
  properties: z.record(z.unknown()).optional(),
  /** A row template of this database to start from (its values, icon, cover and content). */
  templateId: entityIdSchema.optional(),
  /** Create the row as a template ("New template"): never listed among the rows. */
  template: z.boolean().optional(),
});

const granularitySchema = z.enum(DATE_GROUP_GRANULARITIES);

/** A view's grouping (`ViewGroupBy`), or its sub-grouping. */
const groupBySchema = z.union([
  z
    .object({
      propertyId: z.string().min(1),
      granularity: granularitySchema.optional(),
      hideEmpty: z.boolean().optional(),
    })
    .strict(),
  z.null(),
]);

const MAX_VIEW_PROPERTIES = 500;
const uniqueIds = (ids: readonly (string | null)[]) => new Set(ids).size === ids.length;

/** The most groups a view's config names (ordered first, collapsed, hidden). */
const MAX_NAMED_GROUPS = 1000;

/** A list of group keys (`ViewGroupKey`): each once, null for the empty group. */
const groupKeysSchema = z
  .array(z.string().max(2000).nullable())
  .max(MAX_NAMED_GROUPS)
  .refine(uniqueIds, 'Each group once');

/** A number's ranges: of `step`, from `from` up to `to`, at most `MAX_NUMBER_GROUPS` of them. */
const numberGroupingSchema = z
  .object({
    from: z.number().finite(),
    to: z.number().finite(),
    step: z.number().finite().positive(),
  })
  .strict()
  .refine((g) => g.to > g.from, 'A range ends above where it starts')
  .refine(
    (g) => numberGroupCount(g as ViewNumberGrouping) <= MAX_NUMBER_GROUPS,
    `At most ${MAX_NUMBER_GROUPS} ranges`,
  );

/** A view's `config` (`ViewConfig`): a key it does not name is dropped, so each is listed. */
const viewConfigSchema = z.object({
  /** A form's text above its fields. */
  description: z.string().max(5000).optional(),
  datePropertyId: z.string().optional(),
  startPropertyId: z.string().optional(),
  endPropertyId: z.string().optional(),
  coverSource: z.enum(['property', 'pageCover', 'none']).optional(),
  coverPropertyId: z.string().optional(),
  fit: z.enum(['cover', 'contain']).optional(),
  openIn: z.enum(OPEN_ROW_MODES).optional(),
  columnWidths: z
    .record(z.number().int().min(MIN_COLUMN_WIDTH).max(MAX_COLUMN_WIDTH))
    .refine((widths) => Object.keys(widths).length <= MAX_VIEW_PROPERTIES, 'Too many columns')
    .optional(),
  propertyOrder: z
    .array(z.string().min(1).max(200))
    .max(MAX_VIEW_PROPERTIES)
    .refine(uniqueIds, 'Each property once')
    .optional(),
  calculations: z
    .record(z.enum(CALCULATION_FUNCTIONS))
    .refine((fns) => Object.keys(fns).length <= MAX_VIEW_PROPERTIES, 'Too many calculations')
    .optional(),
  chart: z
    .object({
      type: z.enum(CHART_TYPES),
      xAxis: z
        .object({ propertyId: z.string().min(1), granularity: granularitySchema.optional() })
        .strict()
        .optional(),
      yAxis: z
        .object({ aggregate: z.enum(CHART_AGGREGATES), propertyId: z.string().min(1).optional() })
        .strict()
        .optional(),
    })
    .strict()
    .optional(),
  numberGrouping: numberGroupingSchema.optional(),
  groupOrder: groupKeysSchema.optional(),
  collapsedGroups: groupKeysSchema.optional(),
  hiddenGroups: groupKeysSchema.optional(),
});

const updateViewSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    type: viewTypeSchema.optional(),
    isDefault: z.boolean().optional(),
    filters: filterGroupSchema.optional(),
    sorts: z
      .array(
        z.object({
          propertyId: z.string().min(1),
          direction: z.enum(['asc', 'desc']),
        }),
      )
      .optional(),
    groupBy: groupBySchema.optional(),
    subGroupBy: groupBySchema.optional(),
    hiddenProperties: z.array(z.string()).optional(),
    frozenProperties: z.array(z.string()).optional(),
    pageSize: z.number().int().min(1).max(500).optional(),
    config: viewConfigSchema.optional(),
    order: z.number().finite().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });

const createViewSchema = z.object({
  /** A linked view: the `inline_database` block showing this database elsewhere. */
  blockId: entityIdSchema.nullable().optional(),
  name: z.string().min(1).max(200),
  type: viewTypeSchema,
  isDefault: z.boolean().optional(),
  filters: filterGroupSchema.optional(),
  sorts: z
    .array(
      z.object({
        propertyId: z.string().min(1),
        direction: z.enum(['asc', 'desc']),
      }),
    )
    .optional(),
  groupBy: groupBySchema.optional(),
  subGroupBy: groupBySchema.optional(),
  hiddenProperties: z.array(z.string()).optional(),
  frozenProperties: z.array(z.string()).optional(),
  pageSize: z.number().int().min(1).max(500).optional(),
  config: viewConfigSchema.optional(),
  order: z.number().finite().optional(),
});

const listDatabasesQuerySchema = z.object({
  workspaceId: entityIdSchema,
  includeArchived: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});

const listRowsQuerySchema = z.object({
  viewId: entityIdSchema.optional(),
  /** Opaque: the `cursor` of the previous page (`lib/databases/view-query.ts`). */
  cursor: z.string().max(2048).optional(),
  pageSize: z.string().regex(/^\d+$/u).optional(),
  search: z.string().max(200).optional(),
  /**
   * A filter group (JSON) the rows must pass besides the view's own: the dates
   * a calendar or a timeline shows, so it reads those rows and no others.
   */
  filter: z.string().max(8192).optional(),
  /** The reader's IANA time zone: a date with a time is grouped by its day there (UTC if absent). */
  timeZone: z.string().max(64).refine(isTimeZone, 'Unknown time zone').optional(),
});

/** What a view's calculations or chart are computed over: its rows, as searched. */
const viewRowsQuerySchema = z.object({
  search: z.string().max(200).optional(),
  timeZone: z.string().max(64).refine(isTimeZone, 'Unknown time zone').optional(),
});

function handleZodError(err: unknown, res: Response): boolean {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.errors });
    return true;
  }
  return false;
}

/** Sends `refusal` (`lib/databases/refusals.ts`) as a 400; false when there is none. */
function refuse(res: Response, refusal: Refusal | null): boolean {
  if (!refusal) return false;
  res.status(400).json(refusal);
  return true;
}

function assertWorkspace(req: Request, res: Response): string | null {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) {
    res.status(400).json({ error: 'Workspace context required' });
    return null;
  }
  return workspaceId;
}

/**
 * Wire format exposes the property schema as `schema` (mirrors the design
 * doc), even though the stored column is `properties_schema`.
 */
function serializeDatabase(db: DatabaseRecord) {
  return {
    id: db.id,
    workspaceId: db.workspaceId,
    name: db.name,
    icon: db.icon,
    cover: db.cover,
    ownerId: db.ownerId,
    schema: db.propertiesSchema,
    isInline: db.isInline,
    parentPageId: db.parentPageId,
    teamspaceId: db.teamspaceId,
    archived: db.archived,
    locked: db.locked,
    systemKey: db.systemKey,
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

function serializeView(view: DatabaseViewRecord) {
  return {
    id: view.id,
    databaseId: view.databaseId,
    /** A linked view's block; null for the database's own views. */
    blockId: view.blockId,
    name: view.name,
    type: view.type,
    isDefault: view.isDefault,
    filters: view.filters,
    sorts: view.sorts,
    groupBy: view.groupBy,
    /** A board's sub-groups: its rows of columns. */
    subGroupBy: view.subGroupBy,
    hiddenProperties: view.hiddenProperties,
    frozenProperties: view.frozenProperties,
    pageSize: view.pageSize,
    config: view.config,
    order: view.order,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

interface RowSerializationOpts {
  derived: Record<string, unknown>;
}

/**
 * A row is a page. `id` is the only id on the wire; there is no `_id` field,
 * because no row has one.
 */
function serializeRow(row: PageRow, opts?: RowSerializationOpts) {
  const properties: Record<string, unknown> = { ...row.properties };
  if (opts) Object.assign(properties, opts.derived);

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    parentId: row.parentId,
    databaseId: row.databaseId,
    title: row.title,
    icon: row.icon,
    cover: row.cover,
    ownerId: row.ownerId,
    archived: row.archived,
    order: row.order,
    properties,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Server-derived properties (rollup, formula, created_time, etc.) of rows at
 * read time: row id → property id → value, merged by the caller into the row
 * payload. Rollups are read for all the rows at once (`resolveRollups`): those
 * of `rollups` only, when given, the others left empty.
 */
async function resolveDerivedForRows(
  handle: PgHandle,
  rows: readonly PageRow[],
  schema: DatabaseSchema,
  viewerId: string | null,
  rollups?: ReadonlySet<string>,
): Promise<Map<string, Record<string, unknown>>> {
  const values = await resolveRollups(handle, schema, rows, viewerId, rollups);
  return new Map(rows.map((row) => [row.id, deriveRow(row, schema, values.get(row.id))]));
}

/**
 * The rollups a view that reads `reads` (its filter, sorts, grouping, what it
 * computes) needs over every row: those it reads; every one, undefined, when
 * it reads a formula, which may read any of them by name.
 */
function rollupsRead(
  reads: readonly string[],
  propertyById: ReadonlyMap<string, DatabaseProperty>,
): ReadonlySet<string> | undefined {
  const read = reads.flatMap((id) => propertyById.get(id) ?? []);
  if (read.some((p) => p.type === 'formula')) return undefined;
  return new Set(read.filter((p) => p.type === 'rollup').map((p) => p.id));
}

async function resolveDerivedProperties(
  handle: PgHandle,
  row: PageRow,
  schema: DatabaseSchema,
  viewerId: string | null,
): Promise<Record<string, unknown>> {
  return (await resolveDerivedForRows(handle, [row], schema, viewerId)).get(row.id) ?? {};
}

/** One row's derived properties, its rollups already resolved. */
function deriveRow(
  row: PageRow,
  schema: DatabaseSchema,
  rollupValues: ReadonlyMap<string, FormulaValue> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Rollups first: formulas can read them.
  const rollups = new Map<string, FormulaValue>(rollupValues ?? []);
  const formulaContext = rowFormulaContext(row, schema, rollups);
  for (const prop of schema.properties) {
    switch (prop.type) {
      case 'created_time':
        out[prop.id] = {
          start: row.createdAt ? new Date(row.createdAt).toISOString() : null,
        };
        break;
      case 'last_edited_time':
        out[prop.id] = {
          start: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
        };
        break;
      case 'created_by':
        out[prop.id] = { userIds: row.ownerId ? [row.ownerId] : [] };
        break;
      case 'last_edited_by': {
        // Never edited since it was created: its creator.
        const editor = row.lastEditedBy ?? row.ownerId;
        out[prop.id] = { userIds: editor ? [editor] : [] };
        break;
      }
      case 'formula': {
        const { value, error } = formulaContext.evaluate(prop);
        out[prop.id] = formulaCellValue(value, error);
        break;
      }
      case 'rollup': {
        const value = rollups.get(prop.id) ?? null;
        out[prop.id] =
          value === null
            ? { text: '' }
            : typeof value === 'number'
              ? { number: value }
              : { text: value };
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/**
 * Ensure every property has a stable id and option ids. Used at schema
 * creation / property-add time. Mutates and returns the input.
 */
function normalizeSchema(schema: DatabaseSchema): DatabaseSchema {
  const seenIds = new Set<string>();
  for (const prop of schema.properties) {
    if (!prop.id || seenIds.has(prop.id)) {
      prop.id = randomUUID();
    }
    seenIds.add(prop.id);
    if (prop.config?.options) {
      prop.config.options = prop.config.options.map((opt) => ({
        id: opt.id ?? randomUUID(),
        name: opt.name,
        color: opt.color ?? 'default',
        ...(typeof opt.noteColor === 'string' && { noteColor: opt.noteColor }),
      }));
    }
    // A status property's options are each in one of its groups; no other type has them.
    if (prop.type === 'status') {
      prop.config = {
        ...prop.config,
        groups: normalizeStatusGroups(prop.config?.options ?? [], prop.config?.groups),
      };
    } else if (prop.config?.groups) {
      const { groups: _groups, ...rest } = prop.config;
      prop.config = rest;
    }
  }
  return schema;
}

/**
 * A locked database's properties and own views are not to be changed: the
 * refusal is sent and false returned. Its rows stay editable, and unlocking it
 * (`PATCH /databases/:id { locked: false }`) is the change it does take.
 */
function refuseLocked(res: Response, db: { locked: boolean }): boolean {
  if (!db.locked) return false;
  res.status(423).json({
    error: 'This database is locked; unlock it to change its properties and views',
    code: 'DATABASE_LOCKED',
  });
  return true;
}

/**
 * The database `id` names, once the caller may act on it as `role` and, for
 * a change to its properties or own views (`locked`), it is not locked;
 * otherwise the refusal (404, 401/403, 423) is sent and null returned.
 */
async function loadDatabase(
  req: Request,
  res: Response,
  handle: PgHandle,
  id: string,
  { role, locked = false }: { role: 'viewer' | 'editor'; locked?: boolean },
): Promise<DatabaseRecord | null> {
  const db = await findDatabaseById(handle, id);
  if (!db) {
    res.status(404).json({ error: 'Database not found' });
    return null;
  }
  if (!(await checkDatabaseAccess(req, res, handle, db, role))) return null;
  if (locked && refuseLocked(res, db)) return null;
  return db;
}

/**
 * What a new view of `type` starts showing when the request leaves it open: a
 * board grouped by the first status (else select, else checkbox), a calendar
 * and a timeline on the first date property, a gallery of page covers.
 */
function viewDefaults(
  type: DatabaseViewType,
  schema: DatabaseSchema,
  groupBy: ViewGroupBy | null | undefined,
  config: ViewConfig,
): { groupBy: ViewGroupBy | null; config: ViewConfig } {
  const first = (...types: DatabasePropertyType[]) =>
    types.flatMap((t) => schema.properties.find((p) => p.type === t) ?? [])[0];
  const out = { groupBy: groupBy ?? null, config: { ...config } };
  if (type === 'board' && groupBy === undefined) {
    const by = first('status', 'select', 'checkbox');
    if (by) out.groupBy = { propertyId: by.id };
  }
  const date = first('date');
  if (type === 'calendar' && !out.config.datePropertyId && date)
    out.config.datePropertyId = date.id;
  if (type === 'timeline' && !out.config.startPropertyId && date)
    out.config.startPropertyId = date.id;
  if (type === 'gallery' && !out.config.coverSource) out.config.coverSource = 'pageCover';
  // A chart counts the rows of each option of the first status (else select), as bars.
  if (type === 'chart' && !out.config.chart) {
    const by = first('status', 'select', 'multi_select', 'checkbox', 'date');
    out.config.chart = { type: 'bar', ...(by && { xAxis: { propertyId: by.id } }) };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Database CRUD
// ---------------------------------------------------------------------------

/**
 * GET /databases?workspaceId=...
 */
router.get('/', requireWorkspaceMember, async (req: Request, res: Response) => {
  try {
    const query = listDatabasesQuerySchema.parse(req.query);
    const workspaceId = assertWorkspace(req, res);
    if (!workspaceId) return;
    if (query.workspaceId !== workspaceId) {
      res.status(403).json({ error: 'Workspace mismatch' });
      return;
    }

    const handle = getDb();
    const databases = await listDatabasesByWorkspace(handle, {
      workspaceId,
      includeArchived: query.includeArchived,
    });

    // An inline database is listed to those who can open its page; one in
    // no page, to those its place lets in.
    const { roles, viewer } = await visiblePagesOf(handle, workspaceId, req.user?.id ?? '');
    const visible = databases.filter((d) =>
      d.parentPageId
        ? roles.has(d.parentPageId)
        : baseRole(viewer, { teamspaceId: d.teamspaceId, ownerId: d.ownerId }).role !== null,
    );

    res.json({ databases: visible.map((d) => serializeDatabase(d)) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to list databases');
    res.status(500).json({ error: 'Failed to list databases' });
  }
});

/**
 * GET /databases/:id
 * Returns the database + its views (default and saved).
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const handle = getDb();
    const db = await findDatabaseById(handle, params.id);
    if (!db) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    const role = await checkDatabaseAccess(req, res, handle, db, 'viewer');
    if (!role) return;

    const views = await listViewsByDatabase(handle, db.id);

    res.json({
      database: serializeDatabase(db),
      views: views.map((v) => serializeView(v)),
      // The caller's role on the database, so a client never re-derives it.
      role,
    });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to fetch database');
    res.status(500).json({ error: 'Failed to fetch database' });
  }
});

/**
 * POST /databases
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createDatabaseSchema.parse(req.body);
    const workspaceId = body.workspaceId;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const handle = getDb();

    // An inline database needs edit access to its page (which a guest can
    // have); a full-page one, a workspace editor.
    if (body.parentPageId) {
      const parent = await findPageById(handle, body.parentPageId);
      if (!parent) {
        res.status(404).json({ error: 'Parent page not found' });
        return;
      }
      if (parent.workspaceId !== workspaceId) {
        res.status(400).json({ error: 'Parent page is in a different workspace' });
        return;
      }
      if (!(await checkPageAccess(req, res, handle, parent.id, 'editor'))) return;
    }
    const place = body.parentPageId
      ? { teamspaceId: null }
      : await placeOrRefuse(res, handle, workspaceId, userId, body.teamspaceId);
    if (!place) return;

    const propertiesSchema: DatabaseSchema = body.schema
      ? normalizeSchema({
          properties: body.schema.properties.map((p) => ({
            id: p.id ?? randomUUID(),
            name: p.name,
            type: p.type,
            config: p.config as PropertyConfig | undefined,
          })),
        })
      : buildDefaultSchema();
    for (const property of propertiesSchema.properties) {
      if (!(await checkRelationTarget(req, res, handle, { workspaceId }, property))) return;
    }

    const created = await handle.transaction(async (tx) => {
      const db = await insertDatabase(tx, {
        workspaceId,
        name: body.name ?? 'Untitled',
        icon: body.icon ?? null,
        cover: body.cover ?? null,
        ownerId: userId,
        propertiesSchema,
        isInline: body.isInline ?? false,
        parentPageId: body.parentPageId ?? null,
        teamspaceId: place.teamspaceId,
        archived: false,
      });
      // Two-way relations in the schema get their other side.
      let linked = db;
      const twoWayIds = db.propertiesSchema.properties
        .filter((p) => p.type === 'relation' && p.config?.twoWay)
        .map((p) => p.id);
      for (const id of twoWayIds) {
        const property = linked.propertiesSchema.properties.find((p) => p.id === id);
        if (property) linked = (await linkTwoWay(tx, linked, property)) ?? linked;
      }
      await createDefaultViewForDatabase(tx, db.id);
      return { db: linked, views: await listViewsByDatabase(tx, db.id) };
    });

    announceChange({ workspaceId });
    announceSchemaChange(created.db, ...created.db.propertiesSchema.properties);
    res.status(201).json({
      database: serializeDatabase(created.db),
      views: created.views.map((v) => serializeView(v)),
    });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to create database');
    res.status(500).json({ error: 'Failed to create database' });
  }
});

/**
 * PATCH /databases/:id
 * Update name / icon / cover / archived.
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const body = updateDatabaseSchema.parse(req.body);

    const handle = getDb();
    const db = await loadDatabase(req, res, handle, params.id, { role: 'editor' });
    if (!db) return;
    const systemError = body.archived ? systemDatabaseDeleteError(db) : null;
    if (systemError) {
      res.status(409).json({ error: systemError, code: 'SYSTEM_DATABASE' });
      return;
    }

    // `undefined` and `null` are different instructions here: `icon` and
    // `cover` are nullable and an explicit `null` must be written.
    const updated = await updateDatabase(handle, db.id, {
      name: body.name,
      icon: body.icon,
      cover: body.cover,
      archived: body.archived,
      locked: body.locked,
    });
    if (!updated) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }

    announceChange({ workspaceId: db.workspaceId, databaseId: db.id });
    res.json({ database: serializeDatabase(updated) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to update database');
    res.status(500).json({ error: 'Failed to update database' });
  }
});

/**
 * DELETE /databases/:id
 * Soft-delete by default (archived=true). Hard delete requires owner role
 * and cascades to rows + views.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const hard = req.query.hard === 'true';

    const handle = getDb();
    const db = await loadDatabase(req, res, handle, params.id, { role: 'editor' });
    if (!db) return;
    const systemError = systemDatabaseDeleteError(db);
    if (systemError) {
      res.status(409).json({ error: systemError, code: 'SYSTEM_DATABASE' });
      return;
    }

    if (hard) {
      const membership = await findMembership(handle, db.workspaceId, req.user?.id ?? '');
      if (membership?.role !== 'owner') {
        res.status(403).json({ error: 'Hard delete requires workspace owner role' });
        return;
      }
      // Rows, views and the database leave together, so a failure part-way
      // cannot leave rows pointing at a database that no longer exists. Blocks
      // go with their rows through `blocks.pageId ON DELETE CASCADE`, so there
      // is no explicit block delete.
      await handle.transaction(async (tx) => {
        await deleteDatabaseRows(tx, db.id);
        await deleteViewsByDatabase(tx, db.id);
        await deleteDatabase(tx, db.id);
      });
      announceChange({ workspaceId: db.workspaceId, databaseId: db.id });
      res.json({ success: true });
      return;
    }

    const archived = await updateDatabase(handle, db.id, { archived: true });
    if (!archived) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    announceChange({ workspaceId: db.workspaceId, databaseId: db.id });
    res.json({ database: serializeDatabase(archived) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to delete database');
    res.status(500).json({ error: 'Failed to delete database' });
  }
});

// ---------------------------------------------------------------------------
// Properties (schema mutations)
// ---------------------------------------------------------------------------

/**
 * A relation may only point into a database of the same workspace that the
 * caller can read, and a two-way one writes the target's schema and rows, so
 * it needs the caller to edit the target too. Otherwise the refusal is sent
 * and false returned. Anything but a relation to another database passes.
 */
async function checkRelationTarget(
  req: Request,
  res: Response,
  handle: PgHandle,
  source: { id?: string; workspaceId: string },
  property: DatabaseProperty,
): Promise<boolean> {
  const targetId = property.type === 'relation' ? property.config?.targetDatabaseId : undefined;
  if (!targetId || targetId === source.id) return true;
  const target = await findDatabaseById(handle, targetId);
  if (!target || target.archived || target.workspaceId !== source.workspaceId) {
    res.status(400).json({ error: 'The related database is not in this workspace' });
    return false;
  }
  // A two-way relation adds a property to the target: not to a locked one.
  if (property.config?.twoWay && refuseLocked(res, target)) return false;
  const minRole = property.config?.twoWay ? 'editor' : 'viewer';
  const role = await resolveDatabaseRole(handle, req.user?.id ?? '', target);
  if (!role || !hasRole(role, minRole)) {
    res.status(403).json({ error: `Relating to that database requires ${minRole} access to it` });
    return false;
  }
  return true;
}

/** Whoever watches `db`, and the other side of the two-way relations it changed. */
function announceSchemaChange(
  db: DatabaseRecord,
  ...changed: (DatabaseProperty | null | undefined)[]
) {
  announceChange({ databaseId: db.id });
  const others = new Set(
    changed.flatMap((p) =>
      p?.type === 'relation' && p.config?.twoWay && p.config.targetDatabaseId
        ? [p.config.targetDatabaseId]
        : [],
    ),
  );
  others.delete(db.id);
  for (const databaseId of others) announceChange({ databaseId });
}

router.post('/:id/properties', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const body = addPropertySchema.parse(req.body);

    const handle = getDb();
    const db = await loadDatabase(req, res, handle, params.id, { role: 'editor', locked: true });
    if (!db) return;

    const property: DatabaseProperty = {
      id: body.id ?? randomUUID(),
      name: body.name,
      type: body.type,
      // A new status property starts with Notion's three options, one per group.
      config:
        body.type === 'status' && !body.config?.options?.length
          ? { ...(body.config as PropertyConfig | undefined), ...defaultStatusConfig() }
          : (body.config as PropertyConfig | undefined),
    };

    if (db.propertiesSchema.properties.some((p) => p.id === property.id)) {
      res.status(409).json({ error: 'Property id already exists' });
      return;
    }
    if (!(await checkRelationTarget(req, res, handle, db, property))) return;
    if (refuse(res, buttonActionsRefusal(db.propertiesSchema, property))) return;

    db.propertiesSchema.properties.push(property);
    normalizeSchema(db.propertiesSchema);
    const twoWay = property.type === 'relation' && property.config?.twoWay === true;
    const updated = await handle.transaction(async (tx) => {
      // A two-way relation gets its other side in the target database.
      const written = twoWay
        ? await linkTwoWay(tx, db, property)
        : await writeDatabaseSchema(tx, db.id, db.propertiesSchema);
      // A new ID property numbers the rows already there, oldest first.
      if (written && property.type === 'unique_id')
        await numberExistingRows(tx, db.id, property.id);
      return written;
    });
    if (!updated) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }

    announceSchemaChange(db, property);
    res.status(201).json({ database: serializeDatabase(updated) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to add property');
    res.status(500).json({ error: 'Failed to add property' });
  }
});

/**
 * PUT /databases/:id/properties/order { ids } — the order of the properties:
 * those `ids` names first, in that order, then the rest in theirs, so a
 * property added meanwhile is kept, and an id naming none (one removed
 * meanwhile) is passed over.
 */
router.put('/:id/properties/order', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const body = z
      .object({
        ids: z
          .array(z.string().min(1))
          .max(500)
          .refine((ids) => new Set(ids).size === ids.length, 'Each property once'),
      })
      .parse(req.body);
    const handle = getDb();
    const db = await loadDatabase(req, res, handle, params.id, { role: 'editor', locked: true });
    if (!db) return;

    const rank = new Map(body.ids.map((id, i) => [id, i]));
    const properties = db.propertiesSchema.properties
      .map((property, i) => ({ property, key: rank.get(property.id) ?? body.ids.length + i }))
      .sort((a, b) => a.key - b.key)
      .map(({ property }) => property);
    const updated = await writeDatabaseSchema(handle, db.id, {
      ...db.propertiesSchema,
      properties,
    });
    if (!updated) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    announceChange({ databaseId: db.id });
    res.json({ database: serializeDatabase(updated) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to reorder properties');
    res.status(500).json({ error: 'Failed to reorder properties' });
  }
});

router.patch('/:id/properties/:propertyId', async (req: Request, res: Response) => {
  try {
    const params = z
      .object({ id: entityIdSchema, propertyId: z.string().min(1) })
      .parse(req.params);
    const body = updatePropertySchema.parse(req.body);

    const handle = getDb();
    const db = await loadDatabase(req, res, handle, params.id, { role: 'editor', locked: true });
    if (!db) return;

    const idx = db.propertiesSchema.properties.findIndex((p) => p.id === params.propertyId);
    if (idx === -1) {
      res.status(404).json({ error: 'Property not found' });
      return;
    }
    const current = db.propertiesSchema.properties[idx];
    // The Name is the rows' titles: always text.
    if (current.id === NAME_PROPERTY_ID && body.type !== undefined && body.type !== current.type) {
      res.status(400).json({ error: 'The Name property is always text' });
      return;
    }
    const next: DatabaseProperty = {
      id: current.id,
      name: body.name ?? current.name,
      type: body.type ?? current.type,
      config: body.config !== undefined ? (body.config as PropertyConfig) : current.config,
    };
    const systemError = systemPropertyChangeError(db, current, next);
    if (systemError) {
      res.status(409).json({ error: systemError, code: 'SYSTEM_PROPERTY' });
      return;
    }
    keepNoteColors(current, next);
    // Two-way links are the server's: kept, made or undone as the property changes.
    const wasTwoWay = current.type === 'relation' && current.config?.twoWay === true;
    const isTwoWay = next.type === 'relation' && next.config?.twoWay === true;
    const sameTarget = current.config?.targetDatabaseId === next.config?.targetDatabaseId;
    const relinks = current.type !== 'relation' || !sameTarget || (isTwoWay && !wasTwoWay);
    if (relinks && !(await checkRelationTarget(req, res, handle, db, next))) return;
    if (refuse(res, buttonActionsRefusal(db.propertiesSchema, next))) return;
    if (wasTwoWay && isTwoWay && sameTarget) {
      next.config = { ...next.config, syncedPropertyId: current.config?.syncedPropertyId };
    }
    const retyped = next.type !== current.type;
    const schemaBefore = structuredClone(db.propertiesSchema);
    db.propertiesSchema.properties[idx] = next;
    normalizeSchema(db.propertiesSchema);
    const updated = await handle.transaction(async (tx) => {
      if (wasTwoWay && !(isTwoWay && sameTarget)) await unlinkTwoWay(tx, db, current);
      // A new type: every row's value converted or cleared (`property-conversion.ts`),
      // a computed one's from what it showed, and the views' filters on it go.
      if (retyped) {
        const rows = await listDatabaseRows(tx, db.id);
        const computed = isComputedType(current.type);
        const derived = computed
          ? await resolveDerivedForRows(tx, rows, schemaBefore, req.user?.id ?? null)
          : null;
        const conversion = convertValues(
          current,
          db.propertiesSchema.properties[idx],
          rows.map((row) => ({
            id: row.id,
            // An ID is stored, though no client writes it.
            value: derived?.get(row.id)?.[current.id] ?? row.properties[current.id],
            stored: row.properties[current.id],
          })),
        );
        db.propertiesSchema.properties[idx] = conversion.property;
        normalizeSchema(db.propertiesSchema);
        await writePropertyOfRows(tx, db.id, current.id, conversion.values);
        if (next.type === 'unique_id') await numberExistingRows(tx, db.id, current.id);
        for (const view of await lockViewsOfDatabase(tx, db.id)) {
          const patch = viewAfterRetype(view, current.id, next.type);
          if (patch) await updateDatabaseView(tx, view.id, patch);
        }
      }
      const written = db.propertiesSchema.properties[idx];
      if (isTwoWay && !(wasTwoWay && sameTarget)) return linkTwoWay(tx, db, written);
      return writeDatabaseSchema(tx, db.id, db.propertiesSchema);
    });
    if (!updated) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }

    announceSchemaChange(db, current, next);
    res.json({ database: serializeDatabase(updated) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to update property');
    res.status(500).json({ error: 'Failed to update property' });
  }
});

/** Every view of `databaseId` that names `propertyId`, rewritten without it. */
async function removePropertyFromViews(
  tx: PgHandle,
  databaseId: string,
  propertyId: string,
): Promise<void> {
  for (const view of await lockViewsOfDatabase(tx, databaseId)) {
    const patch = viewWithoutProperty(view, propertyId);
    if (patch) await updateDatabaseView(tx, view.id, patch);
  }
}

router.delete('/:id/properties/:propertyId', async (req: Request, res: Response) => {
  try {
    const params = z
      .object({ id: entityIdSchema, propertyId: z.string().min(1) })
      .parse(req.params);

    const handle = getDb();
    const db = await loadDatabase(req, res, handle, params.id, { role: 'editor', locked: true });
    if (!db) return;

    if (params.propertyId === NAME_PROPERTY_ID) {
      res.status(400).json({ error: 'Cannot delete the Name property' });
      return;
    }
    const removed = db.propertiesSchema.properties.find((p) => p.id === params.propertyId);
    const systemError = removed ? systemPropertyChangeError(db, removed, null) : null;
    if (systemError) {
      res.status(409).json({ error: systemError, code: 'SYSTEM_PROPERTY' });
      return;
    }

    // Dropping the property from the schema and from every row is one
    // logical write: the schema is what tells a reader the key exists, so a
    // failure between the two leaves values no reader can reach and no
    // writer will overwrite. Its views and rollups stop naming it in the
    // same write, so no reader sees a view sorted, filtered or grouped on a
    // property that is gone.
    const updated = await handle.transaction(async (tx) => {
      // A two-way relation's other side goes with it, and from its views.
      const otherSide =
        removed?.type === 'relation' && removed.config?.twoWay
          ? {
              databaseId: removed.config.targetDatabaseId,
              propertyId: removed.config.syncedPropertyId,
            }
          : null;
      if (removed && otherSide) await unlinkTwoWay(tx, db, removed);
      const row = await writeDatabaseSchema(
        tx,
        db.id,
        schemaWithoutProperty(db.propertiesSchema, db.id, params.propertyId),
      );
      if (!row) return null;
      await removePropertyFromDatabaseRows(tx, db.id, params.propertyId);
      await removePropertyFromViews(tx, db.id, params.propertyId);
      if (otherSide?.databaseId && otherSide.propertyId) {
        await removePropertyFromViews(tx, otherSide.databaseId, otherSide.propertyId);
      }
      return row;
    });
    if (!updated) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }

    announceSchemaChange(db, removed);
    res.json({ database: serializeDatabase(updated) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to delete property');
    res.status(500).json({ error: 'Failed to delete property' });
  }
});

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

router.get('/:id/rows', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const query = listRowsQuerySchema.parse(req.query);

    const handle = getDb();
    const db = await loadDatabase(req, res, handle, params.id, { role: 'viewer' });
    if (!db) return;

    // Find the view (or fall back to default if none given).
    let view: DatabaseViewRecord | null = null;
    if (query.viewId) {
      view = await findViewById(handle, query.viewId, db.id);
      if (!view) {
        res.status(404).json({ error: 'View not found' });
        return;
      }
    } else {
      view = await findDefaultView(handle, db.id);
    }

    const propertyById = new Map<string, DatabaseProperty>();
    for (const p of db.propertiesSchema.properties) propertyById.set(p.id, p);

    const pageSize = Math.min(
      500,
      Math.max(1, Number(query.pageSize ?? view?.pageSize ?? DEFAULT_VIEW_PAGE_SIZE)),
    );
    const cursor = query.cursor === undefined ? null : decodeRowsCursor(query.cursor);
    if (query.cursor !== undefined && !cursor) {
      res.status(400).json({ error: 'Invalid cursor' });
      return;
    }

    let narrowed: Filter | undefined;
    if (query.filter !== undefined) {
      let raw: unknown;
      try {
        raw = JSON.parse(query.filter);
      } catch {
        res.status(400).json({ error: 'Invalid filter' });
        return;
      }
      narrowed = filterGroupSchema.parse(raw);
      if (refuse(res, filterRefusal(db.propertiesSchema, narrowed))) return;
    }

    // A view is filtered, sorted and paged in SQL, and only the rows of the
    // page it returns are read. Formulas and rollups are computed, not
    // stored: a view that reads one computes them for every row first, then
    // filters and sorts in JS.
    const ownFilter = view?.filters as Filter | undefined;
    const viewFilter: Filter | undefined = narrowed
      ? {
          kind: 'group',
          combinator: 'and',
          filters: ownFilter ? [ownFilter, narrowed] : [narrowed],
        }
      : ownFilter;
    // A grouped view's rows come group by group, each row in every group it is in.
    const grouping = rowGrouping(view);
    const timeZone = query.timeZone ?? 'UTC';
    const viewReads = [
      ...(viewFilter ? filterPropertyIds(viewFilter) : []),
      ...(view?.sorts ?? []).map((s) => s.propertyId),
      ...(grouping ? [grouping.propertyId] : []),
    ];
    let groupSpec: GroupSpec | null = null;
    let slice: PageRow[];
    let groupKeys: GroupKey[] | null = null;
    let groups: ReturnType<typeof summarizeGroups> | null = null;
    let total: number;
    let nextCursor: string | null;
    let derivedAll: Awaited<ReturnType<typeof resolveDerivedForRows>> | null = null;
    let readRollups: ReadonlySet<string> | undefined;
    if (readsComputed(viewReads, propertyById)) {
      if (cursor && !('offset' in cursor)) {
        res.status(400).json({ error: 'Invalid cursor' });
        return;
      }
      const rowDocs = await listDatabaseRows(handle, db.id, { archived: false, template: false });
      // Over every row, only what the view reads; the page's rows get the rest below.
      readRollups = rollupsRead(viewReads, propertyById);
      derivedAll = await resolveDerivedForRows(
        handle,
        rowDocs,
        db.propertiesSchema,
        req.user?.id ?? null,
        readRollups,
      );
      let filtered = rowDocs.map((row) => ({
        ...row,
        properties: { ...row.properties, ...derivedAll?.get(row.id) },
      }));
      // A number's ranges span every row's, whatever the view shows.
      groupSpec = resolveGroupSpec(grouping, propertyById, timeZone, view?.config, (p) =>
        numberBounds(filtered, p),
      );
      if (query.search) {
        const needle = query.search.toLowerCase();
        filtered = filtered.filter((r) => r.title.toLowerCase().includes(needle));
      }
      if (viewFilter && viewFilter.kind === 'group' && viewFilter.filters.length > 0) {
        filtered = filtered.filter((r) => evaluateFilter(viewFilter, r, propertyById));
      }
      // Rows arrive oldest first; a stable sort keeps that order among the
      // rows the view's sorts do not tell apart, so paging is deterministic.
      if (view?.sorts && view.sorts.length > 0) {
        filtered = [...filtered].sort(compareBySorts(view.sorts, propertyById));
      }
      const offset = cursor && 'offset' in cursor ? cursor.offset : 0;
      const byId = new Map(rowDocs.map((row) => [row.id, row] as const));
      const entries = groupSpec
        ? groupRows(filtered, groupSpec)
        : filtered.map((row) => ({ row, key: null }));
      if (groupSpec) groups = summarizeGroups(countGroups(entries), groupSpec);
      const page = entries.slice(offset, offset + pageSize);
      slice = page.flatMap((e) => byId.get(e.row.id) ?? []);
      if (groupSpec) groupKeys = page.map((e) => e.key);
      // The rows in a group the view shows, each once.
      total = shownRows(filtered, groupSpec).length;
      nextCursor =
        offset + pageSize < entries.length ? encodeRowsCursor({ offset: offset + pageSize }) : null;
    } else {
      groupSpec = await resolveGroupSpec(grouping, propertyById, timeZone, view?.config, (p) =>
        numberBoundsInSql(handle, db.id, p),
      );
      const compiled = compileView(
        db.id,
        { filters: viewFilter, sorts: view?.sorts, search: query.search },
        propertyById,
        groupSpec,
      );
      const [page, counts] = await Promise.all([
        listViewRows(handle, db.id, compiled, { size: pageSize, cursor }),
        groupSpec ? listViewGroups(handle, compiled) : null,
      ]);
      if (!page) {
        res.status(400).json({ error: 'Invalid cursor' });
        return;
      }
      slice = page.rows;
      groupKeys = page.groupKeys;
      if (groupSpec && counts) {
        groups = summarizeGroups(
          new Map([...counts].map(([key, { count }]) => [key, count])),
          groupSpec,
        );
      }
      total = page.total;
      nextCursor = page.cursor;
    }

    const derivedSlice =
      derivedAll && !readRollups
        ? derivedAll
        : await resolveDerivedForRows(handle, slice, db.propertiesSchema, req.user?.id ?? null);
    const serializedRows = slice.map((row, i) => ({
      ...serializeRow(row, { derived: derivedSlice.get(row.id) ?? {} }),
      ...(groupKeys && { groupKey: groupKeys[i] ?? null }),
    }));

    res.json({
      rows: serializedRows,
      total,
      cursor: nextCursor,
      view: view ? serializeView(view) : null,
      // A grouped view's groups in order, with how many rows each holds.
      ...(groups && { groups }),
    });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to list rows');
    res.status(500).json({ error: 'Failed to list rows' });
  }
});

/**
 * GET /databases/:id/rows/:rowId — one row (a template too) with its computed
 * values, whatever view it falls in: for the row's own page.
 */
router.get('/:id/rows/:rowId', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema, rowId: entityIdSchema }).parse(req.params);
    const handle = getDb();
    const db = await loadDatabase(req, res, handle, params.id, { role: 'viewer' });
    if (!db) return;
    const row = await findPageById(handle, params.rowId);
    if (!row || row.databaseId !== db.id || row.archived) {
      res.status(404).json({ error: 'Row not found' });
      return;
    }
    const derived = await resolveDerivedProperties(
      handle,
      row,
      db.propertiesSchema,
      req.user?.id ?? null,
    );
    res.json({ row: serializeRow(row, { derived }) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to read row');
    res.status(500).json({ error: 'Failed to read row' });
  }
});

/**
 * GET /databases/:id/people — who a person property of this database can
 * name (`lib/databases/people.ts`), with their Oxy profiles: what the cell's
 * picker offers. For its editors only, who are the ones setting people; a
 * guest who may only read a page is not handed the workspace's member list.
 */
router.get('/:id/people', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const handle = getDb();
    const db = await loadDatabase(req, res, handle, params.id, { role: 'editor' });
    if (!db) return;
    const people = await listDatabasePeople(handle, db.workspaceId);
    const profiles = await loadMemberProfiles(people.map((p) => p.userId));
    res.json({
      people: people.map((p) => ({ ...p, user: profiles.get(p.userId) ?? null })),
    });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to list database people');
    res.status(500).json({ error: 'Failed to list people' });
  }
});

/** The most rows one batch read names: a relation cell shows a few, a page of them at most. */
const MAX_BATCH_ROWS = 100;

/**
 * POST /databases/:id/rows/batch { ids } — the live rows among `ids` with
 * their computed values, in the order asked: what a relation shows of the rows
 * it points at, read in one request rather than one per row. An id that is not
 * a live row of this database is left out, so a related row trashed or moved
 * reads as unavailable.
 */
router.post('/:id/rows/batch', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const body = z
      .object({ ids: z.array(entityIdSchema).min(1).max(MAX_BATCH_ROWS) })
      .parse(req.body);
    const handle = getDb();
    const db = await loadDatabase(req, res, handle, params.id, { role: 'viewer' });
    if (!db) return;
    const found = await findPagesByIds(handle, [...new Set(body.ids)], { archived: false });
    const byId = new Map(
      found.filter((row) => row.databaseId === db.id && !row.template).map((row) => [row.id, row]),
    );
    const live = [...new Set(body.ids)].flatMap((id) => byId.get(id) ?? []);
    const derived = await resolveDerivedForRows(
      handle,
      live,
      db.propertiesSchema,
      req.user?.id ?? null,
    );
    res.json({
      rows: live.map((row) => serializeRow(row, { derived: derived.get(row.id) ?? {} })),
    });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to read rows');
    res.status(500).json({ error: 'Failed to read rows' });
  }
});

router.post('/:id/rows', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const body = createRowSchema.parse(req.body);

    const handle = getDb();
    const db = await loadDatabase(req, res, handle, params.id, { role: 'editor' });
    if (!db) return;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { stored, nameFromProperty } = normalizeIncomingProperties(
      db.propertiesSchema,
      body.properties ?? {},
    );
    const invalid = await invalidReference(handle, db, stored);
    if (invalid) {
      res.status(400).json(invalid);
      return;
    }

    // Resolve final title: explicit body.title wins, then properties.name,
    // then fall back to "" (the row card will show "Untitled").
    const title =
      typeof body.title === 'string'
        ? body.title
        : nameFromProperty !== null
          ? nameFromProperty
          : '';

    // A template gives its values (the request's win), icon, cover and content.
    const template = body.templateId ? await findPageById(handle, body.templateId) : null;
    if (body.templateId && (!template || template.databaseId !== db.id || !template.template)) {
      res.status(400).json({ error: 'That is not a row template of this database' });
      return;
    }

    // The template's rows, brought up to its latest edits.
    if (template) await projectNow(template.id);
    const row = await handle.transaction(async (tx) => {
      const created = await createRow(tx, db, {
        workspaceId: db.workspaceId,
        parentId: null,
        title:
          template && typeof body.title !== 'string' && nameFromProperty === null
            ? template.title
            : title,
        icon: template?.icon ?? null,
        cover: template?.cover ?? null,
        ownerId: userId,
        archived: false,
        order: await nextDatabaseRowOrder(tx, db.id),
        properties: { ...(template?.properties ?? {}), ...stored },
        template: body.template === true,
      });
      if (template) await duplicateBlocksToPage(tx, template.id, created.id);
      // Its two-way relations show it on their other side (not a template's).
      if (!created.template) await syncRelations(tx, db, created.id, {}, created.properties);
      return created;
    });

    const derived = await resolveDerivedProperties(
      handle,
      row,
      db.propertiesSchema,
      req.user?.id ?? null,
    );

    void notifyAssigned({
      properties: db.propertiesSchema.properties,
      row,
      before: {},
      after: row.properties,
      actorId: userId,
    });
    announceChange({ databaseId: db.id });
    res.status(201).json({ row: serializeRow(row, { derived }) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to create row');
    res.status(500).json({ error: 'Failed to create row' });
  }
});

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/**
 * Who may read or change a set of views. The database's own: read with the
 * database, changed by its editors. A linked block's (an `inline_database`
 * block showing the database in another page): read and changed by those who
 * may read or edit that page, as long as they may open the database — so a
 * linked view of a database you only read is yours to filter, as in Notion.
 */
async function checkViewsAccess(
  req: Request,
  res: Response,
  handle: ReturnType<typeof getDb>,
  db: NonNullable<Awaited<ReturnType<typeof findDatabaseWorkspaceId>>>,
  blockId: string | null,
  write: boolean,
): Promise<boolean> {
  if (blockId === null)
    return (await checkDatabaseAccess(req, res, handle, db, write ? 'editor' : 'viewer')) !== null;
  const block = await findBlockById(handle, blockId);
  if (!block || block.type !== 'inline_database' || block.content.databaseId !== db.id) {
    res.status(404).json({ error: 'Linked view not found' });
    return false;
  }
  if (!(await checkPageAccess(req, res, handle, block.pageId, write ? 'editor' : 'viewer'))) {
    return false;
  }
  return (await checkDatabaseAccess(req, res, handle, db, 'viewer')) !== null;
}

/**
 * Whether the caller may change `db`'s views of `blockId`, the refusal sent
 * otherwise. A linked view is its block's, not the locked database's.
 */
async function checkViewChange(
  req: Request,
  res: Response,
  handle: ReturnType<typeof getDb>,
  db: DatabaseRecord,
  blockId: string | null,
): Promise<boolean> {
  if (!(await checkViewsAccess(req, res, handle, db, blockId, true))) return false;
  return viewIsEditable(db, { blockId }) || !refuseLocked(res, db);
}

/** View `viewId` of database `id`, once the caller may change it (`checkViewChange`); else null. */
async function loadViewForChange(
  req: Request,
  res: Response,
  handle: ReturnType<typeof getDb>,
  id: string,
  viewId: string,
): Promise<{ db: DatabaseRecord; view: DatabaseViewRecord } | null> {
  const db = await findDatabaseById(handle, id);
  if (!db) {
    res.status(404).json({ error: 'Database not found' });
    return null;
  }
  const view = await findViewById(handle, viewId, db.id);
  if (!view) {
    res.status(404).json({ error: 'View not found' });
    return null;
  }
  if (!(await checkViewChange(req, res, handle, db, view.blockId))) return null;
  return { db, view };
}

router.get('/:id/views', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const { blockId } = z.object({ blockId: entityIdSchema.optional() }).parse(req.query);
    const handle = getDb();
    const db = await findDatabaseWorkspaceId(handle, params.id);
    if (!db) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    if (!(await checkViewsAccess(req, res, handle, db, blockId ?? null, false))) return;

    const views = await listViewsByDatabase(handle, db.id, blockId ?? null);
    res.json({ views: views.map((v) => serializeView(v)) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to list views');
    res.status(500).json({ error: 'Failed to list views' });
  }
});

router.post('/:id/views', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const body = createViewSchema.parse(req.body);

    const handle = getDb();
    const db = await findDatabaseById(handle, params.id);
    if (!db) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    const blockId = body.blockId ?? null;
    if (!(await checkViewChange(req, res, handle, db, blockId))) return;
    if (refuse(res, filterRefusal(db.propertiesSchema, body.filters))) return;
    if (refuse(res, viewSettingsRefusal(db.propertiesSchema, body))) return;

    // `??`, not `||`: `order: 0` is a legitimate explicit order.
    const nextOrder = body.order ?? (await nextViewOrder(handle, db.id, blockId));

    const setup = viewDefaults(
      body.type,
      db.propertiesSchema,
      body.groupBy === undefined ? undefined : (body.groupBy as ViewGroupBy | null),
      (body.config ?? {}) as ViewConfig,
    );

    const view = await insertDatabaseView(handle, {
      databaseId: db.id,
      blockId,
      name: body.name,
      type: body.type,
      isDefault: body.isDefault ?? false,
      filters: body.filters ?? EMPTY_FILTER_GROUP,
      sorts: (body.sorts ?? []) as ViewSort[],
      groupBy: setup.groupBy,
      subGroupBy: (body.subGroupBy ?? null) as ViewGroupBy | null,
      hiddenProperties: body.hiddenProperties ?? [],
      frozenProperties: body.frozenProperties ?? [],
      pageSize: body.pageSize ?? DEFAULT_VIEW_PAGE_SIZE,
      config: setup.config,
      order: nextOrder,
    });

    announceChange({ databaseId: db.id });
    res.status(201).json({ view: serializeView(view) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to create view');
    res.status(500).json({ error: 'Failed to create view' });
  }
});

router.patch('/:id/views/:viewId', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema, viewId: entityIdSchema }).parse(req.params);
    const body = updateViewSchema.parse(req.body);

    const handle = getDb();
    const found = await loadViewForChange(req, res, handle, params.id, params.viewId);
    if (!found) return;
    const { db, view } = found;
    if (refuse(res, filterRefusal(db.propertiesSchema, body.filters))) return;
    if (refuse(res, viewSettingsRefusal(db.propertiesSchema, body))) return;

    // Promoting a view and demoting the previous default(s) commit
    // together, so a failure between the two cannot leave the database with
    // no default at all.
    const updated = await handle.transaction(async (tx) => {
      if (body.isDefault) {
        await demoteOtherDefaultViews(tx, db.id, view.id, view.blockId);
      }
      return updateDatabaseView(tx, view.id, {
        name: body.name,
        type: body.type,
        isDefault: body.isDefault,
        filters: body.filters,
        sorts: body.sorts as ViewSort[] | undefined,
        groupBy: body.groupBy as ViewGroupBy | null | undefined,
        subGroupBy: body.subGroupBy as ViewGroupBy | null | undefined,
        hiddenProperties: body.hiddenProperties,
        frozenProperties: body.frozenProperties,
        pageSize: body.pageSize,
        // Grouped by another property, its groups' order, collapsing and ranges go.
        config: configAfterRegroup(view, {
          type: body.type,
          groupBy: body.groupBy as ViewGroupBy | null | undefined,
          subGroupBy: body.subGroupBy as ViewGroupBy | null | undefined,
          config: body.config as ViewConfig | undefined,
        }),
        order: body.order,
      });
    });
    if (!updated) {
      res.status(404).json({ error: 'View not found' });
      return;
    }

    announceChange({ databaseId: db.id });
    res.json({ view: serializeView(updated) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to update view');
    res.status(500).json({ error: 'Failed to update view' });
  }
});

router.delete('/:id/views/:viewId', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema, viewId: entityIdSchema }).parse(req.params);

    const handle = getDb();
    const found = await loadViewForChange(req, res, handle, params.id, params.viewId);
    if (!found) return;
    const { db, view } = found;

    // Don't allow deleting the last view — promote another to default
    // if we're removing the default.
    const total = await countViews(handle, db.id, view.blockId);
    if (total <= 1) {
      res.status(400).json({ error: 'Cannot delete the last view' });
      return;
    }
    // The delete and the promotion commit together: between them the
    // database has no default view, and `GET /:id/rows` resolves its view
    // from exactly that flag.
    await handle.transaction(async (tx) => {
      await deleteDatabaseView(tx, view.id);
      if (!view.isDefault) return;
      const fallback = await findFirstViewByOrder(tx, db.id, view.blockId);
      if (fallback) {
        await updateDatabaseView(tx, fallback.id, { isDefault: true });
      }
    });
    announceChange({ databaseId: db.id });
    res.json({ success: true });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to delete view');
    res.status(500).json({ error: 'Failed to delete view' });
  }
});

/**
 * A view's rows with their computed values, read and filtered in JS: what a
 * calculation or a chart over a formula or a rollup (or of a view filtering
 * on one) reads. Of the rollups, only those `reads` needs (`rollupsRead`).
 */
async function computedViewRows(
  handle: PgHandle,
  db: DatabaseRecord,
  filter: Filter,
  search: string | undefined,
  viewerId: string | null,
  reads: readonly string[],
): Promise<{ shown: PageRow[]; every: PageRow[] }> {
  const propertyById = new Map(db.propertiesSchema.properties.map((p) => [p.id, p]));
  const rows = await listDatabaseRows(handle, db.id, { archived: false, template: false });
  const derived = await resolveDerivedForRows(
    handle,
    rows,
    db.propertiesSchema,
    viewerId,
    rollupsRead([...filterPropertyIds(filter), ...reads], propertyById),
  );
  const needle = search?.toLowerCase();
  const every = rows.map((row) => ({
    ...row,
    properties: { ...row.properties, ...derived.get(row.id) },
  }));
  const shown = every
    .filter((row) => !needle || row.title.toLowerCase().includes(needle))
    .filter((row) => filter.kind !== 'group' || evaluateFilter(filter, row, propertyById));
  return { shown, every };
}

/** The database and one of its views, for a reader of the database; else the refusal is sent. */
async function readableView(
  req: Request,
  res: Response,
): Promise<{
  db: DatabaseRecord;
  view: DatabaseViewRecord;
  search?: string;
  timeZone: string;
} | null> {
  const params = z.object({ id: entityIdSchema, viewId: entityIdSchema }).parse(req.params);
  const query = viewRowsQuerySchema.parse(req.query);
  const handle = getDb();
  const db = await loadDatabase(req, res, handle, params.id, { role: 'viewer' });
  if (!db) return null;
  const view = await findViewById(handle, params.viewId, db.id);
  if (!view) {
    res.status(404).json({ error: 'View not found' });
    return null;
  }
  return { db, view, search: query.search, timeZone: query.timeZone ?? 'UTC' };
}

/**
 * GET /databases/:id/views/:viewId/calculations?search=&timeZone= — the
 * view's footer (`config.calculations`) over every row it shows, searched as
 * it is, not only the page loaded:
 * `{ calculations: { [propertyId]: { function, value } } }`
 * (`lib/databases/calculations.ts`). A grouped view's for each of its groups
 * too, in their order: `groups: [{ key, calculations }]`, every group's in
 * one query grouped by its key. In SQL, but for formulas and rollups.
 */
router.get('/:id/views/:viewId/calculations', async (req: Request, res: Response) => {
  try {
    const found = await readableView(req, res);
    if (!found) return;
    const { db, view, search, timeZone } = found;
    const handle = getDb();
    const propertyById = new Map(db.propertiesSchema.properties.map((p) => [p.id, p]));
    const requested = Object.entries(view.config.calculations ?? {}).flatMap(([id, fn]) => {
      const property = propertyById.get(id);
      return property && acceptsCalculation(property.type, fn) ? [{ property, fn }] : [];
    });
    const grouping = rowGrouping(view);
    let values: CalculationValue[] = [];
    let byGroup: { key: GroupKey; values: CalculationValue[] }[] | null = null;
    if (requested.length > 0) {
      const inJs =
        readsComputed(
          [...filterPropertyIds(view.filters), ...(grouping ? [grouping.propertyId] : [])],
          propertyById,
        ) || requested.some(({ property }) => !calculableInSql(property));
      // Every group of the view in its order (an option no row holds, a range of
      // no numbers too), with what its rows come to; one with none, to nothing.
      const inGroups = (spec: GroupSpec, computed: Map<GroupKey, CalculationValue[]>) =>
        summarizeGroups(new Map([...computed.keys()].map((key) => [key, 1])), spec).map(
          ({ key }) => ({
            key,
            values:
              computed.get(key) ?? requested.map(({ property, fn }) => calculate(fn, property, [])),
          }),
        );
      if (inJs) {
        const rows = await computedViewRows(
          handle,
          db,
          view.filters,
          search,
          req.user?.id ?? null,
          [
            ...(grouping ? [grouping.propertyId] : []),
            ...requested.map(({ property }) => property.id),
          ],
        );
        const spec = resolveGroupSpec(grouping, propertyById, timeZone, view.config, (p) =>
          numberBounds(rows.every, p),
        );
        // The footer of the rows the view shows: those in a group it does not hide.
        const shown = shownRows(rows.shown, spec);
        values = requested.map(({ property, fn }) => calculate(fn, property, shown));
        if (spec) byGroup = inGroups(spec, calculateGroups(rows.shown, spec, requested));
      } else {
        const spec = await resolveGroupSpec(grouping, propertyById, timeZone, view.config, (p) =>
          numberBoundsInSql(handle, db.id, p),
        );
        const compiled = compileView(db.id, { filters: view.filters, search }, propertyById, spec);
        const [whole, grouped] = await Promise.all([
          calculationsInSql(handle, compiled, requested),
          spec ? groupCalculationsInSql(handle, compiled, requested) : null,
        ]);
        values = whole;
        if (spec && grouped) byGroup = inGroups(spec, grouped);
      }
    }
    const named = (list: readonly CalculationValue[]) =>
      Object.fromEntries(
        requested.map(({ property, fn }, i) => [
          property.id,
          { function: fn, value: list[i] ?? null },
        ]),
      );
    res.json({
      calculations: named(values),
      ...(byGroup && {
        groups: byGroup.map(({ key, values: list }) => ({ key, calculations: named(list) })),
      }),
    });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to calculate view');
    res.status(500).json({ error: 'Failed to calculate' });
  }
});

/**
 * GET /databases/:id/views/:viewId/chart?search=&timeZone= — a chart view's
 * points (`config.chart`): one per group of its x-axis property, in the
 * groups' order (`lib/databases/groups.ts`), each the count of its rows or
 * the sum or average of a number of them: `{ points: [{ key, count, value }] }`.
 * Grouped and added up in SQL, but when its filter reads a formula or rollup.
 */
router.get('/:id/views/:viewId/chart', async (req: Request, res: Response) => {
  try {
    const found = await readableView(req, res);
    if (!found) return;
    const { db, view, search, timeZone } = found;
    const handle = getDb();
    const propertyById = new Map(db.propertiesSchema.properties.map((p) => [p.id, p]));
    const chart = view.config.chart;
    const axis = chart?.xAxis ?? null;
    if (!axis || !resolveGroupSpec(axis, propertyById, timeZone)) {
      res.json({ points: [] });
      return;
    }
    const aggregate = chart?.yAxis?.aggregate ?? 'count';
    const measured =
      aggregate !== 'count' && chart?.yAxis?.propertyId
        ? propertyById.get(chart.yAxis.propertyId)
        : undefined;
    const measure = measured && isChartMeasurable(measured.type) ? measured : undefined;

    let byKey: Map<GroupKey, { count: number; sum: number | null; average: number | null }>;
    let spec: GroupSpec | null;
    if (readsComputed([...filterPropertyIds(view.filters), axis.propertyId], propertyById)) {
      const rows = await computedViewRows(handle, db, view.filters, search, req.user?.id ?? null, [
        axis.propertyId,
      ]);
      spec = resolveGroupSpec(axis, propertyById, timeZone, {}, (p) => numberBounds(rows.every, p));
      const totals = new Map<GroupKey, { count: number; numbers: number[] }>();
      for (const { row, key } of spec ? groupRows(rows.shown, spec) : []) {
        const at = totals.get(key) ?? { count: 0, numbers: [] };
        at.count += 1;
        const held = measure
          ? (row.properties[measure.id] as { number?: unknown } | undefined)
          : null;
        if (typeof held?.number === 'number') at.numbers.push(held.number);
        totals.set(key, at);
      }
      byKey = new Map(
        [...totals].map(([key, { count, numbers }]) => {
          const sum = numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) : null;
          return [key, { count, sum, average: sum === null ? null : sum / numbers.length }];
        }),
      );
    } else {
      spec = await resolveGroupSpec(axis, propertyById, timeZone, {}, (p) =>
        numberBoundsInSql(handle, db.id, p),
      );
      const compiled = compileView(db.id, { filters: view.filters, search }, propertyById, spec);
      byKey = await listViewGroups(
        handle,
        compiled,
        measure ? accessorFor(measure).key.expr : undefined,
      );
    }
    if (!spec) {
      res.json({ points: [] });
      return;
    }
    const points = summarizeGroups(
      new Map([...byKey].map(([key, { count }]) => [key, count])),
      spec,
    ).map(({ key, count, range }) => {
      const at = byKey.get(key);
      const value =
        aggregate === 'count' || !measure
          ? count
          : aggregate === 'sum'
            ? (at?.sum ?? 0)
            : (at?.average ?? null);
      return { key, count, value, ...(range && { range }) };
    });
    res.json({ points });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to chart view');
    res.status(500).json({ error: 'Failed to chart view' });
  }
});

/**
 * GET /databases/:id/templates — the database's row templates (rows marked
 * `template`, kept out of the rows themselves).
 */
router.get('/:id/templates', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const handle = getDb();
    const db = await loadDatabase(req, res, handle, params.id, { role: 'viewer' });
    if (!db) return;
    const templates = await listDatabaseRows(handle, db.id, { archived: false, template: true });
    const derived = await resolveDerivedForRows(
      handle,
      templates,
      db.propertiesSchema,
      req.user?.id ?? null,
    );
    res.json({
      templates: templates.map((t) => serializeRow(t, { derived: derived.get(t.id) ?? {} })),
    });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to list row templates');
    res.status(500).json({ error: 'Failed to list row templates' });
  }
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * GET /databases/:id/export?format=csv — the rows as CSV, one column per
 * stored property (formulas and rollups are computed, not stored, and left
 * out), values as people read them.
 */
router.get('/:id/export', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    z.object({ format: z.literal('csv').default('csv') }).parse(req.query);
    const handle = getDb();
    const db = await loadDatabase(req, res, handle, params.id, { role: 'viewer' });
    if (!db) return;
    const rows = await listDatabaseRows(handle, db.id, { archived: false, template: false });
    const name = db.name?.trim() || 'Untitled';
    const ascii =
      name
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9-_]+/gu, '-')
        .replace(/^-+|-+$/g, '') || 'database';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${ascii}.csv"; filename*=UTF-8''${encodeURIComponent(`${name}.csv`)}`,
    );
    // A BOM so spreadsheet apps read the file as UTF-8.
    res.send(`\uFEFF${databaseToCsv(db.propertiesSchema, rows)}`);
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to export database');
    res.status(500).json({ error: 'Failed to export database' });
  }
});

const importCsvSchema = z.object({
  workspaceId: entityIdSchema,
  /** An inline database in this page; a full-page database when absent. */
  parentPageId: entityIdSchema.nullable().optional(),
  /** A full-page database's place: a teamspace, null for private; absent, the default. */
  teamspaceId: entityIdSchema.nullable().optional(),
  name: z.string().trim().max(500).optional(),
  csv: z
    .string()
    .min(1)
    .max(10 * 1024 * 1024),
});

/**
 * POST /databases/import/csv { workspaceId, parentPageId?, name?, csv }
 *
 * A database from a CSV with a header row: the first column is the Name,
 * the others get the type every value fits (checkbox, number, date, URL,
 * email, select, multi-select, else text).
 */
router.post('/import/csv', async (req: Request, res: Response) => {
  try {
    const body = importCsvSchema.parse(req.body);
    const userId = req.user?.id as string;
    const handle = getDb();
    if (body.parentPageId) {
      const parent = await findPageById(handle, body.parentPageId);
      if (!parent || parent.workspaceId !== body.workspaceId) {
        res.status(400).json({ error: 'The destination is not a page of this workspace' });
        return;
      }
      if (!(await checkPageAccess(req, res, handle, parent.id, 'editor'))) return;
    }
    const place = body.parentPageId
      ? { teamspaceId: null }
      : await placeOrRefuse(res, handle, body.workspaceId, userId, body.teamspaceId);
    if (!place) return;
    const parsed = csvToDatabase(body.csv);
    const created = await handle.transaction((tx) =>
      createDatabaseWithRows(tx, {
        workspaceId: body.workspaceId,
        name: body.name || 'Imported',
        ownerId: userId,
        schema: parsed.schema,
        isInline: Boolean(body.parentPageId),
        parentPageId: body.parentPageId ?? null,
        teamspaceId: place.teamspaceId,
        rows: parsed.rows,
      }),
    );
    announceChange({ workspaceId: body.workspaceId, databaseId: created.database.id });
    res
      .status(201)
      .json({ database: serializeDatabase(created.database), rows: created.rowIds.length });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to import CSV');
    res.status(500).json({ error: 'Failed to import CSV' });
  }
});

export default router;
