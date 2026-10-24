/**
 * Writing a database row, shared by every route that does: `POST
 * /databases/:id/rows`, `PATCH /pages/:id` and `/calendar`. Each write is the
 * same transaction (the page through `createPage`/`updatePage`, which record
 * its activity, and the other side of its two-way relations), followed by the
 * same notices: an `assigned` notification to whoever a person property newly
 * names, and `database:changed` / `workspace:changed` to the live rooms.
 */
import { announceChange } from '../../collab/live-rooms.js';
import type { PgHandle } from '../../db/client.js';
import type { DatabaseSchema } from '../../db/schema/databases.js';
import type { PageProperties } from '../../db/schema/pages.js';
import { duplicateBlocksToPage } from '../../repositories/blocks.js';
import {
  nextDatabaseRowOrder,
  type PageRow,
  setTreeArchived,
  type UpdatePageInput,
  updatePage,
} from '../../repositories/pages.js';
import { notifyAssigned } from './assignments.js';
import { parsePropertyValue, serializeParsedValue } from './property-values.js';
import { syncRelations } from './relations.js';
import { createRow } from './rows.js';
import { NAME_PROPERTY_ID } from './schema-defaults.js';

interface RowDatabase {
  id: string;
  workspaceId: string;
  propertiesSchema: DatabaseSchema;
}

/** Why a properties write was refused, as `PATCH /pages/:id` answers it (400). */
export interface PropertyWriteRefusal {
  error: string;
  code: 'COMPUTED_PROPERTY' | 'UNKNOWN_PROPERTY';
  propertyId: string;
}

/**
 * A properties write (property id → value) checked against the schema and
 * stored as each type stores it. A key the database does not have, or one the
 * server computes, is refused rather than dropped: answering 200 would have
 * the client show a value that was never stored. Value shapes that do not fit
 * their type throw a `ZodError`. `name` is the Name text, to keep the title.
 */
export function parseRowProperties(
  schema: DatabaseSchema,
  raw: Record<string, unknown>,
): { merge: PageProperties; name: string | null } | { refusal: PropertyWriteRefusal } {
  const byId = new Map(schema.properties.map((p) => [p.id, p]));
  const merge: PageProperties = {};
  let name: string | null = null;
  for (const [key, value] of Object.entries(raw)) {
    const prop = byId.get(key);
    const parsed = prop ? parsePropertyValue(prop.type, value) : null;
    if (!prop || !parsed) {
      return {
        refusal: {
          error: prop ? `"${prop.name}" is computed and cannot be set` : 'Unknown property',
          code: prop ? 'COMPUTED_PROPERTY' : 'UNKNOWN_PROPERTY',
          propertyId: key,
        },
      };
    }
    merge[key] = serializeParsedValue(parsed);
    if (key === NAME_PROPERTY_ID && parsed.kind === 'text') name = parsed.text;
  }
  return { merge, name };
}

/** A new row of `database`, written as one transaction; `rowWritten` follows it. */
export async function insertRow(
  handle: PgHandle,
  database: RowDatabase,
  input: {
    ownerId: string;
    title: string;
    icon?: string | null;
    cover?: string | null;
    properties: PageProperties;
    template?: boolean;
    /** A row template whose blocks the new row starts with. */
    blocksFrom?: string | null;
  },
): Promise<PageRow> {
  return handle.transaction(async (tx) => {
    const created = await createRow(tx, database, {
      workspaceId: database.workspaceId,
      parentId: null,
      title: input.title,
      icon: input.icon ?? null,
      cover: input.cover ?? null,
      ownerId: input.ownerId,
      archived: false,
      order: await nextDatabaseRowOrder(tx, database.id),
      properties: input.properties,
      template: input.template === true,
    });
    if (input.blocksFrom) await duplicateBlocksToPage(tx, input.blocksFrom, created.id);
    // Its two-way relations show it on their other side (not a template's).
    if (!created.template) await syncRelations(tx, database, created.id, {}, created.properties);
    return created;
  });
}

/**
 * `patch` written to `page` as one transaction: into the trash or out of it
 * with its subtree (`movesTrash`), and, for a row whose properties change,
 * the other side of its two-way relations. Undefined when the page is gone.
 */
export async function writePage(
  handle: PgHandle,
  page: PageRow,
  patch: UpdatePageInput,
  options: { rowDatabase: RowDatabase | null; movesTrash: boolean },
): Promise<PageRow | undefined> {
  return handle.transaction(async (tx) => {
    const written = await updatePage(tx, page.id, patch);
    if (written && options.movesTrash) await setTreeArchived(tx, page.id, written.archived);
    if (written && options.rowDatabase && patch.mergeProperties && !written.template) {
      await syncRelations(tx, options.rowDatabase, page.id, page.properties, written.properties);
    }
    return written;
  });
}

/**
 * What follows a committed row write: whoever a person property newly names
 * is told (`assigned`), and the rooms watching its database and workspace are.
 */
export function rowWritten(input: {
  database: RowDatabase;
  row: PageRow;
  before: PageProperties;
  actorId: string;
  /** Whether the properties were part of the write (a rename alone notifies no one). */
  propertiesChanged: boolean;
  /** The workspace room too: the page tree changed (a title, the trash). */
  workspace?: boolean;
}): void {
  if (input.propertiesChanged) {
    void notifyAssigned({
      properties: input.database.propertiesSchema.properties,
      row: input.row,
      before: input.before,
      after: input.row.properties,
      actorId: input.actorId,
    });
  }
  announceChange({
    ...(input.workspace && { workspaceId: input.row.workspaceId }),
    databaseId: input.database.id,
  });
}
