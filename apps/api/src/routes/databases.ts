import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import { getDb, type PgHandle } from '../db/client.js';
import {
  DATABASE_PROPERTY_TYPES,
  DATABASE_VIEW_TYPES,
  DEFAULT_VIEW_PAGE_SIZE,
  EMPTY_FILTER_GROUP,
  SELECT_COLORS,
  type DatabaseProperty,
  type DatabasePropertyType,
  type DatabaseSchema,
  type DatabaseViewType,
  type Filter,
  type PropertyConfig,
  type SelectOption,
  type ViewConfig,
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
  listDatabaseRows,
  listPages,
  nextDatabaseRowOrder,
  removePropertyFromDatabaseRows,
} from '../repositories/pages.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireWorkspaceMember } from '../middleware/workspace.js';
import { log } from '../lib/logger.js';
import { checkWorkspaceAccess } from '../lib/workspace-access.js';
import { duplicateBlocksToPage } from '../repositories/blocks.js';
import {
  createDatabaseWithRows,
  createDefaultViewForDatabase,
  normalizeIncomingProperties,
} from '../lib/databases/create.js';
import { csvToDatabase, databaseToCsv } from '../lib/databases/csv.js';
import {
  checkDatabaseAccess,
  checkPageAccess,
  databaseHosts,
  rolesForPages,
} from '../lib/page-access.js';
import { listGrantsOfUserInWorkspace } from '../repositories/pagePermissions.js';
import { hasRole } from '../db/schema/workspaces.js';
import { buildDefaultSchema, NAME_PROPERTY_ID } from '../lib/databases/schema-defaults.js';
import { parsePropertyValue, serializeParsedValue } from '../lib/databases/property-values.js';
import {
  evaluateFilter,
  filterGroupSchema,
  filterPropertyIds,
  readsComputed,
} from '../lib/databases/filters.js';
import { compareBySorts } from '../lib/databases/sorts.js';
import { formulaCellValue, type FormulaValue } from '../lib/databases/formula.js';
import { rowFormulaContext } from '../lib/databases/row-values.js';
import { resolveRollup } from '../lib/databases/rollups.js';

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

const propertyConfigSchema = z
  .object({
    options: z.array(selectOptionSchema).optional(),
    format: z
      .union([
        z.literal('number'),
        z.literal('percent'),
        z.literal('currency:USD'),
        z.literal('currency:EUR'),
        z.literal('currency:GBP'),
        z.literal('currency:JPY'),
      ])
      .optional(),
    precision: z.number().int().min(0).max(10).optional(),
    includeTime: z.boolean().optional(),
    targetDatabaseId: entityIdSchema.optional(),
    twoWay: z.boolean().optional(),
    relationPropertyId: z.string().optional(),
    targetPropertyId: z.string().optional(),
    function: z.enum(['count', 'sum', 'avg', 'min', 'max', 'earliest', 'latest']).optional(),
    expression: z.string().max(2000).optional(),
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
});

const updateDatabaseSchema = z
  .object({
    name: z.string().max(2000).optional(),
    icon: z.string().max(200).nullable().optional(),
    cover: z.string().max(2000).nullable().optional(),
    archived: z.boolean().optional(),
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
    groupBy: z.union([z.object({ propertyId: z.string().min(1) }), z.null()]).optional(),
    hiddenProperties: z.array(z.string()).optional(),
    frozenProperties: z.array(z.string()).optional(),
    pageSize: z.number().int().min(1).max(500).optional(),
    config: z
      .object({
        datePropertyId: z.string().optional(),
        startPropertyId: z.string().optional(),
        endPropertyId: z.string().optional(),
        coverSource: z.enum(['property', 'pageCover']).optional(),
        coverPropertyId: z.string().optional(),
        fit: z.enum(['cover', 'contain']).optional(),
      })
      .optional(),
    order: z.number().finite().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });

const createViewSchema = z.object({
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
  groupBy: z.union([z.object({ propertyId: z.string().min(1) }), z.null()]).optional(),
  hiddenProperties: z.array(z.string()).optional(),
  frozenProperties: z.array(z.string()).optional(),
  pageSize: z.number().int().min(1).max(500).optional(),
  config: z
    .object({
      datePropertyId: z.string().optional(),
      startPropertyId: z.string().optional(),
      endPropertyId: z.string().optional(),
      coverSource: z.enum(['property', 'pageCover']).optional(),
      coverPropertyId: z.string().optional(),
      fit: z.enum(['cover', 'contain']).optional(),
    })
    .optional(),
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
  cursor: z.string().regex(/^\d+$/u).optional(),
  pageSize: z.string().regex(/^\d+$/u).optional(),
  search: z.string().max(200).optional(),
});

function handleZodError(err: unknown, res: Response): boolean {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.errors });
    return true;
  }
  return false;
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
    archived: db.archived,
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

function serializeView(view: DatabaseViewRecord) {
  return {
    id: view.id,
    databaseId: view.databaseId,
    name: view.name,
    type: view.type,
    isDefault: view.isDefault,
    filters: view.filters,
    sorts: view.sorts,
    groupBy: view.groupBy,
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
 * A row is a page. `id` is the only id on the wire — the `_id` this used to
 * emit alongside it was the Mongo primary key under its storage name, and
 * carrying it forward would publish a field no row has.
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
 * Resolve server-derived properties (rollup, formula, created_time, etc.)
 * for a row at read time. Returns a plain key->value map keyed by
 * propertyId. The caller merges this into the row payload sent to the
 * client.
 */
async function resolveDerivedProperties(
  handle: PgHandle,
  row: PageRow,
  schema: DatabaseSchema,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  // Rollups first: formulas can read them.
  const rollups = new Map<string, FormulaValue>();
  for (const prop of schema.properties) {
    if (prop.type === 'rollup') rollups.set(prop.id, await resolveRollup(handle, prop, row));
  }
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
      }));
    }
  }
  return schema;
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

    // An inline database is listed only to those who can open its page.
    const memberRole = req.workspace?.role ?? null;
    let visible = databases;
    if (!memberRole || !hasRole(memberRole, 'admin')) {
      const [all, grants, hosts] = await Promise.all([
        listPages(handle, { workspaceId }),
        listGrantsOfUserInWorkspace(handle, req.user?.id ?? '', workspaceId),
        databaseHosts(handle, workspaceId),
      ]);
      const roles = rolesForPages(all, memberRole, grants, hosts);
      visible = databases.filter((d) => !d.parentPageId || roles.has(d.parentPageId));
    }

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
    const ok = await checkDatabaseAccess(req, res, handle, db, 'viewer');
    if (!ok) return;

    const views = await listViewsByDatabase(handle, db.id);

    res.json({
      database: serializeDatabase(db),
      views: views.map((v) => serializeView(v)),
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
    } else if (!(await checkWorkspaceAccess(req, res, workspaceId, 'editor'))) {
      return;
    }

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
        archived: false,
      });
      await createDefaultViewForDatabase(tx, db.id);
      return { db, views: await listViewsByDatabase(tx, db.id) };
    });

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
    const db = await findDatabaseById(handle, params.id);
    if (!db) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    const ok = await checkDatabaseAccess(req, res, handle, db, 'editor');
    if (!ok) return;

    // `undefined` and `null` are different instructions here: `icon` and
    // `cover` are nullable and an explicit `null` must be written.
    const updated = await updateDatabase(handle, db.id, {
      name: body.name,
      icon: body.icon,
      cover: body.cover,
      archived: body.archived,
    });
    if (!updated) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }

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
    const db = await findDatabaseById(handle, params.id);
    if (!db) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    const ok = await checkDatabaseAccess(req, res, handle, db, 'editor');
    if (!ok) return;

    if (hard) {
      if (req.workspace?.role !== 'owner') {
        res.status(403).json({ error: 'Hard delete requires workspace owner role' });
        return;
      }
      // Rows, views and the database leave together. Under Mongo these were
      // four independent `deleteMany` calls, so a failure part-way left rows
      // pointing at a database that no longer existed. Blocks go with their
      // rows through `blocks.pageId ON DELETE CASCADE`, which is why the
      // route's explicit `Block.deleteMany` has no counterpart.
      await handle.transaction(async (tx) => {
        await deleteDatabaseRows(tx, db.id);
        await deleteViewsByDatabase(tx, db.id);
        await deleteDatabase(tx, db.id);
      });
      res.json({ success: true });
      return;
    }

    const archived = await updateDatabase(handle, db.id, { archived: true });
    if (!archived) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
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

router.post('/:id/properties', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const body = addPropertySchema.parse(req.body);

    const handle = getDb();
    const db = await findDatabaseById(handle, params.id);
    if (!db) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    const ok = await checkDatabaseAccess(req, res, handle, db, 'editor');
    if (!ok) return;

    const property: DatabaseProperty = {
      id: body.id ?? randomUUID(),
      name: body.name,
      type: body.type,
      config: body.config as PropertyConfig | undefined,
    };

    if (db.propertiesSchema.properties.some((p) => p.id === property.id)) {
      res.status(409).json({ error: 'Property id already exists' });
      return;
    }

    db.propertiesSchema.properties.push(property);
    const updated = await writeDatabaseSchema(handle, db.id, normalizeSchema(db.propertiesSchema));
    if (!updated) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }

    res.status(201).json({ database: serializeDatabase(updated) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to add property');
    res.status(500).json({ error: 'Failed to add property' });
  }
});

router.patch('/:id/properties/:propertyId', async (req: Request, res: Response) => {
  try {
    const params = z
      .object({ id: entityIdSchema, propertyId: z.string().min(1) })
      .parse(req.params);
    const body = updatePropertySchema.parse(req.body);

    const handle = getDb();
    const db = await findDatabaseById(handle, params.id);
    if (!db) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    const ok = await checkDatabaseAccess(req, res, handle, db, 'editor');
    if (!ok) return;

    const idx = db.propertiesSchema.properties.findIndex((p) => p.id === params.propertyId);
    if (idx === -1) {
      res.status(404).json({ error: 'Property not found' });
      return;
    }
    const current = db.propertiesSchema.properties[idx];
    const next: DatabaseProperty = {
      id: current.id,
      name: body.name ?? current.name,
      type: body.type ?? current.type,
      config: body.config !== undefined ? (body.config as PropertyConfig) : current.config,
    };
    db.propertiesSchema.properties[idx] = next;
    const updated = await writeDatabaseSchema(handle, db.id, normalizeSchema(db.propertiesSchema));
    if (!updated) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }

    res.json({ database: serializeDatabase(updated) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to update property');
    res.status(500).json({ error: 'Failed to update property' });
  }
});

router.delete('/:id/properties/:propertyId', async (req: Request, res: Response) => {
  try {
    const params = z
      .object({ id: entityIdSchema, propertyId: z.string().min(1) })
      .parse(req.params);

    const handle = getDb();
    const db = await findDatabaseById(handle, params.id);
    if (!db) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    const ok = await checkDatabaseAccess(req, res, handle, db, 'editor');
    if (!ok) return;

    if (params.propertyId === NAME_PROPERTY_ID) {
      res.status(400).json({ error: 'Cannot delete the Name property' });
      return;
    }
    const propertiesSchema: DatabaseSchema = {
      properties: db.propertiesSchema.properties.filter((p) => p.id !== params.propertyId),
    };

    // Dropping the property from the schema and from every row is one
    // logical write: the schema is what tells a reader the key exists, so a
    // failure between the two leaves values no reader can reach and no
    // writer will overwrite.
    const updated = await handle.transaction(async (tx) => {
      const row = await writeDatabaseSchema(tx, db.id, propertiesSchema);
      if (!row) return null;
      await removePropertyFromDatabaseRows(tx, db.id, params.propertyId);
      return row;
    });
    if (!updated) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }

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
    const db = await findDatabaseById(handle, params.id);
    if (!db) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    const ok = await checkDatabaseAccess(req, res, handle, db, 'viewer');
    if (!ok) return;

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

    // Load all rows for the database. Filter / sort in JS — Phase 4 keeps
    // the typed property layer simple and database sizes are bounded by
    // the soft cap (10k rows in Phase 5 is the design target).
    const rowDocs = await listDatabaseRows(handle, db.id, { archived: false, template: false });

    const propertyById = new Map<string, DatabaseProperty>();
    for (const p of db.propertiesSchema.properties) propertyById.set(p.id, p);

    // Formulas and rollups are computed, not stored: a view that filters or
    // sorts on one needs every row's computed values first.
    const viewReads = [
      ...(view?.filters ? filterPropertyIds(view.filters as Filter) : []),
      ...(view?.sorts ?? []).map((s) => s.propertyId),
    ];
    const rowsWithComputed = readsComputed(viewReads, propertyById)
      ? await Promise.all(
          rowDocs.map(async (row) => ({
            ...row,
            properties: {
              ...row.properties,
              ...(await resolveDerivedProperties(handle, row, db.propertiesSchema)),
            },
          })),
        )
      : rowDocs;

    let filtered = rowsWithComputed;
    if (query.search) {
      const needle = query.search.toLowerCase();
      filtered = filtered.filter((r) => r.title.toLowerCase().includes(needle));
    }
    if (view?.filters && view.filters.filters.length > 0) {
      filtered = filtered.filter((r) => evaluateFilter(view!.filters as Filter, r, propertyById));
    }
    if (view?.sorts && view.sorts.length > 0) {
      const compare = compareBySorts(view.sorts, propertyById);
      filtered = [...filtered].sort(compare);
    } else {
      filtered = [...filtered].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    }

    const pageSize = Math.min(
      500,
      Math.max(1, Number(query.pageSize ?? view?.pageSize ?? DEFAULT_VIEW_PAGE_SIZE)),
    );
    const cursorOffset = Number(query.cursor ?? '0');
    const slice = filtered.slice(cursorOffset, cursorOffset + pageSize);
    const nextCursor =
      cursorOffset + pageSize < filtered.length ? String(cursorOffset + pageSize) : null;

    const serializedRows = await Promise.all(
      slice.map(async (row) => {
        const derived = await resolveDerivedProperties(handle, row, db.propertiesSchema);
        return serializeRow(row, { derived });
      }),
    );

    res.json({
      rows: serializedRows,
      total: filtered.length,
      cursor: nextCursor,
      view: view ? serializeView(view) : null,
    });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to list rows');
    res.status(500).json({ error: 'Failed to list rows' });
  }
});

router.post('/:id/rows', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const body = createRowSchema.parse(req.body);

    const handle = getDb();
    const db = await findDatabaseById(handle, params.id);
    if (!db) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    const ok = await checkDatabaseAccess(req, res, handle, db, 'editor');
    if (!ok) return;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { stored, nameFromProperty } = normalizeIncomingProperties(
      db.propertiesSchema,
      body.properties ?? {},
    );

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

    const row = await handle.transaction(async (tx) => {
      const created = await createPage(tx, {
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
        databaseId: db.id,
        properties: { ...(template?.properties ?? {}), ...stored },
      });
      if (template) await duplicateBlocksToPage(tx, template.id, created.id);
      return created;
    });

    const derived = await resolveDerivedProperties(handle, row, db.propertiesSchema);

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

router.get('/:id/views', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const handle = getDb();
    const db = await findDatabaseWorkspaceId(handle, params.id);
    if (!db) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    const ok = await checkDatabaseAccess(req, res, handle, db, 'viewer');
    if (!ok) return;

    const views = await listViewsByDatabase(handle, db.id);
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
    const db = await findDatabaseWorkspaceId(handle, params.id);
    if (!db) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    const ok = await checkDatabaseAccess(req, res, handle, db, 'editor');
    if (!ok) return;

    // `??`, not `||`: `order: 0` is a legitimate explicit order.
    const nextOrder = body.order ?? (await nextViewOrder(handle, db.id));

    // Convert nullable groupBy { propertyId } into the storage shape.
    const groupByValue: { propertyId: string } | null =
      body.groupBy === undefined
        ? null
        : body.groupBy === null
          ? null
          : { propertyId: body.groupBy.propertyId };

    const view = await insertDatabaseView(handle, {
      databaseId: db.id,
      name: body.name,
      type: body.type,
      isDefault: body.isDefault ?? false,
      filters: body.filters ?? EMPTY_FILTER_GROUP,
      sorts: (body.sorts ?? []) as ViewSort[],
      groupBy: groupByValue,
      hiddenProperties: body.hiddenProperties ?? [],
      frozenProperties: body.frozenProperties ?? [],
      pageSize: body.pageSize ?? DEFAULT_VIEW_PAGE_SIZE,
      config: (body.config ?? {}) as ViewConfig,
      order: nextOrder,
    });

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
    const db = await findDatabaseWorkspaceId(handle, params.id);
    if (!db) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    const ok = await checkDatabaseAccess(req, res, handle, db, 'editor');
    if (!ok) return;

    const view = await findViewById(handle, params.viewId, db.id);
    if (!view) {
      res.status(404).json({ error: 'View not found' });
      return;
    }

    // Promoting a view and demoting the previous default(s) commit
    // together — Mongo demoted first and saved the target afterwards, so a
    // failure between the two left the database with no default at all.
    const updated = await handle.transaction(async (tx) => {
      if (body.isDefault) {
        await demoteOtherDefaultViews(tx, db.id, view.id);
      }
      return updateDatabaseView(tx, view.id, {
        name: body.name,
        type: body.type,
        isDefault: body.isDefault,
        filters: body.filters,
        sorts: body.sorts as ViewSort[] | undefined,
        groupBy:
          body.groupBy === undefined
            ? undefined
            : body.groupBy === null
              ? null
              : { propertyId: body.groupBy.propertyId },
        hiddenProperties: body.hiddenProperties,
        frozenProperties: body.frozenProperties,
        pageSize: body.pageSize,
        config: body.config as ViewConfig | undefined,
        order: body.order,
      });
    });
    if (!updated) {
      res.status(404).json({ error: 'View not found' });
      return;
    }

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
    const db = await findDatabaseWorkspaceId(handle, params.id);
    if (!db) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    const ok = await checkDatabaseAccess(req, res, handle, db, 'editor');
    if (!ok) return;

    const view = await findViewById(handle, params.viewId, db.id);
    if (!view) {
      res.status(404).json({ error: 'View not found' });
      return;
    }

    // Don't allow deleting the last view — promote another to default
    // if we're removing the default.
    const total = await countViews(handle, db.id);
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
      const fallback = await findFirstViewByOrder(tx, db.id);
      if (fallback) {
        await updateDatabaseView(tx, fallback.id, { isDefault: true });
      }
    });
    res.json({ success: true });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to delete view');
    res.status(500).json({ error: 'Failed to delete view' });
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
    const db = await findDatabaseById(handle, params.id);
    if (!db) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    if (!(await checkDatabaseAccess(req, res, handle, db, 'viewer'))) return;
    const templates = await listDatabaseRows(handle, db.id, { archived: false, template: true });
    res.json({ templates: templates.map((t) => serializeRow(t, { derived: {} })) });
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
    const db = await findDatabaseById(handle, params.id);
    if (!db) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    if (!(await checkDatabaseAccess(req, res, handle, db, 'viewer'))) return;
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
    } else if (!(await checkWorkspaceAccess(req, res, body.workspaceId, 'editor'))) {
      return;
    }
    const parsed = csvToDatabase(body.csv);
    const created = await handle.transaction((tx) =>
      createDatabaseWithRows(tx, {
        workspaceId: body.workspaceId,
        name: body.name || 'Imported',
        ownerId: userId,
        schema: parsed.schema,
        isInline: Boolean(body.parentPageId),
        parentPageId: body.parentPageId ?? null,
        rows: parsed.rows,
      }),
    );
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
