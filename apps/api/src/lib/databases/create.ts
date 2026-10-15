/**
 * Creating databases and rows outside a single request's handler: the
 * default view, incoming property values, and a database with its rows in
 * one go (CSV import).
 */
import type { PgHandle } from '../../db/client.js';
import {
  DEFAULT_VIEW_PAGE_SIZE,
  type DatabaseProperty,
  type DatabaseSchema,
  EMPTY_FILTER_GROUP,
} from '../../db/schema/databases.js';
import {
  type DatabaseRecord,
  insertDatabase,
  insertDatabaseView,
} from '../../repositories/databases.js';
import { nextDatabaseRowOrder } from '../../repositories/pages.js';
import { createRow } from './rows.js';
import { parsePropertyValue, serializeParsedValue } from './property-values.js';
import { NAME_PROPERTY_ID } from './schema-defaults.js';

/**
 * Normalize incoming property values for create/update. Returns a
 * key->stored-shape map. Throws ZodError for invalid shapes.
 *
 * Drops keys that:
 *   - reference an unknown property id
 *   - reference a server-derived property (rollup, formula, created_time,
 *     created_by, last_edited_time, last_edited_by)
 */
export function normalizeIncomingProperties(
  schema: DatabaseSchema,
  incoming: Record<string, unknown>,
): { stored: Record<string, unknown>; nameFromProperty: string | null } {
  const byId = new Map<string, DatabaseProperty>();
  for (const prop of schema.properties) byId.set(prop.id, prop);

  const stored: Record<string, unknown> = {};
  let nameFromProperty: string | null = null;

  for (const [key, raw] of Object.entries(incoming)) {
    const prop = byId.get(key);
    if (!prop) continue;
    const parsed = parsePropertyValue(prop.type, raw);
    if (!parsed) continue;
    const serialized = serializeParsedValue(parsed);
    stored[key] = serialized;
    if (key === NAME_PROPERTY_ID && parsed.kind === 'text') {
      nameFromProperty = parsed.text;
    }
  }

  return { stored, nameFromProperty };
}

/**
 * The view every new database is created with.
 *
 * Takes a handle rather than reaching for the pool: `POST /databases` creates
 * the database and this view in ONE transaction. Under Mongo they were two
 * independent writes, so a failure between them left a database with no views
 * at all — a state the rest of the route refuses to produce (`DELETE
 * /:id/views/:viewId` will not remove the last one). This makes the storage
 * uphold an invariant the code already tried to hold; it does not invent one.
 */
export async function createDefaultViewForDatabase(
  handle: PgHandle,
  databaseId: string,
): Promise<void> {
  await insertDatabaseView(handle, {
    databaseId,
    name: 'All',
    type: 'table',
    isDefault: true,
    filters: EMPTY_FILTER_GROUP,
    sorts: [],
    groupBy: null,
    hiddenProperties: [],
    frozenProperties: [],
    pageSize: DEFAULT_VIEW_PAGE_SIZE,
    config: {},
    order: 0,
  });
}

/**
 * A database with its default view and rows, in the transaction `handle` is
 * in. Row values go through the same validation as `POST /databases/:id/rows`.
 */
export async function createDatabaseWithRows(
  handle: PgHandle,
  input: {
    workspaceId: string;
    name: string;
    ownerId: string;
    schema: DatabaseSchema;
    isInline: boolean;
    parentPageId: string | null;
    rows: readonly { title: string; properties: Record<string, unknown> }[];
  },
): Promise<{ database: DatabaseRecord; rowIds: string[] }> {
  const database = await insertDatabase(handle, {
    workspaceId: input.workspaceId,
    name: input.name,
    icon: null,
    cover: null,
    ownerId: input.ownerId,
    propertiesSchema: input.schema,
    isInline: input.isInline,
    parentPageId: input.parentPageId,
    archived: false,
  });
  await createDefaultViewForDatabase(handle, database.id);
  const rowIds: string[] = [];
  let order = await nextDatabaseRowOrder(handle, database.id);
  for (const row of input.rows) {
    const { stored } = normalizeIncomingProperties(input.schema, row.properties);
    const page = await createRow(handle, database, {
      workspaceId: input.workspaceId,
      parentId: null,
      title: row.title,
      ownerId: input.ownerId,
      order: order++,
      properties: stored,
    });
    rowIds.push(page.id);
  }
  return { database, rowIds };
}
