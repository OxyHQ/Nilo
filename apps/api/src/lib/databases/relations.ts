/**
 * Two-way relations, as in Notion: a relation property with `twoWay` has a
 * reciprocal relation property in its target database (`syncedPropertyId`,
 * each side naming the other), and whenever a row's relation changes the
 * other side changes with it — in the same transaction. A database related
 * to itself this way is Notion's sub-items: parent ↔ children.
 *
 * The other side is written in SQL over `jsonb` (add or remove one id in
 * `pageIds`), never read-modify-write, so concurrent edits of different rows
 * cannot lose one another's links. Only rows of the target database are
 * touched.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PgHandle } from '../../db/client.js';
import type { DatabaseProperty, DatabaseSchema } from '../../db/schema/databases.js';
import { pages, type PageProperties } from '../../db/schema/pages.js';
import {
  type DatabaseRecord,
  findDatabaseById,
  writeDatabaseSchema,
} from '../../repositories/databases.js';

/** The page ids a relation value points at. */
export function relationIds(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const ids = (value as { pageIds?: unknown }).pageIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

/** A two-way relation property and where its other side is. */
interface TwoWay {
  propertyId: string;
  targetDatabaseId: string;
  syncedPropertyId: string;
}

function twoWayRelations(schema: DatabaseSchema): TwoWay[] {
  return schema.properties.flatMap((p) =>
    p.type === 'relation' &&
    p.config?.twoWay &&
    p.config.targetDatabaseId &&
    p.config.syncedPropertyId
      ? [
          {
            propertyId: p.id,
            targetDatabaseId: p.config.targetDatabaseId,
            syncedPropertyId: p.config.syncedPropertyId,
          },
        ]
      : [],
  );
}

/** Add `rowId` to (or remove it from) `property` of the rows `ids` of `databaseId`. */
async function setLink(
  db: PgHandle,
  change: { databaseId: string; property: string; ids: readonly string[]; rowId: string },
  adding: boolean,
): Promise<void> {
  if (change.ids.length === 0) return;
  const current = sql`coalesce(${pages.properties} -> ${change.property} -> 'pageIds', '[]'::jsonb)`;
  const next = adding
    ? sql`case when ${current} ? ${change.rowId} then ${current} else ${current} || to_jsonb(${change.rowId}::text) end`
    : sql`${current} - ${change.rowId}`;
  await db
    .update(pages)
    .set({
      properties: sql`jsonb_set(coalesce(${pages.properties}, '{}'::jsonb), ARRAY[${change.property}]::text[], jsonb_build_object('pageIds', ${next}))`,
    })
    .where(and(inArray(pages.id, [...change.ids]), eq(pages.databaseId, change.databaseId)));
}

/**
 * Keep the other side of `database`'s two-way relations in step with a
 * row whose properties went from `before` to `after`.
 */
export async function syncRelations(
  db: PgHandle,
  database: { propertiesSchema: DatabaseSchema },
  rowId: string,
  before: PageProperties,
  after: PageProperties,
): Promise<void> {
  for (const relation of twoWayRelations(database.propertiesSchema)) {
    if (!(relation.propertyId in after) && !(relation.propertyId in before)) continue;
    const was = new Set(relationIds(before[relation.propertyId]));
    const now = new Set(relationIds(after[relation.propertyId]));
    const link = {
      databaseId: relation.targetDatabaseId,
      property: relation.syncedPropertyId,
      rowId,
    };
    await setLink(db, { ...link, ids: [...now].filter((id) => !was.has(id)) }, true);
    await setLink(db, { ...link, ids: [...was].filter((id) => !now.has(id)) }, false);
  }
}

/**
 * Make `property` (a relation of `source`, already in its schema) two-way:
 * add its reciprocal property to the target database — or to `source`
 * itself, for sub-items — link the two, and fill the other side from the
 * rows' current values. Writes both schemas; returns `source` as written.
 */
export async function linkTwoWay(
  db: PgHandle,
  source: DatabaseRecord,
  property: DatabaseProperty,
): Promise<DatabaseRecord | null> {
  const targetId = property.config?.targetDatabaseId;
  if (!targetId) return writeDatabaseSchema(db, source.id, source.propertiesSchema);
  const self = targetId === source.id;
  const target = self ? source : await findDatabaseById(db, targetId);
  if (!target) return writeDatabaseSchema(db, source.id, source.propertiesSchema);

  const reciprocal: DatabaseProperty = {
    id: randomUUID(),
    name: self ? `${property.name} (parent)` : source.name || 'Related',
    type: 'relation',
    config: { targetDatabaseId: source.id, twoWay: true, syncedPropertyId: property.id },
  };
  property.config = { ...property.config, twoWay: true, syncedPropertyId: reciprocal.id };
  target.propertiesSchema.properties.push(reciprocal);
  if (!self) await writeDatabaseSchema(db, target.id, target.propertiesSchema);
  const written = await writeDatabaseSchema(db, source.id, source.propertiesSchema);

  // The other side, from what the rows hold now.
  const rows = await db
    .select({ id: pages.id, properties: pages.properties })
    .from(pages)
    .where(eq(pages.databaseId, source.id));
  for (const row of rows) {
    await setLink(
      db,
      {
        databaseId: target.id,
        property: reciprocal.id,
        ids: relationIds(row.properties[property.id]),
        rowId: row.id,
      },
      true,
    );
  }
  return written;
}

/**
 * Undo `linkTwoWay` for `property` of `source`: its reciprocal property goes
 * from the target database's schema and rows. `property` stays (one-way)
 * unless the caller removes it too.
 */
export async function unlinkTwoWay(
  db: PgHandle,
  source: DatabaseRecord,
  property: DatabaseProperty,
): Promise<void> {
  const targetId = property.config?.targetDatabaseId;
  const syncedId = property.config?.syncedPropertyId;
  property.config = { ...property.config, twoWay: false, syncedPropertyId: undefined };
  if (!targetId || !syncedId) return;
  const self = targetId === source.id;
  const target = self ? source : await findDatabaseById(db, targetId);
  if (!target) return;
  target.propertiesSchema.properties = target.propertiesSchema.properties.filter(
    (p) => p.id !== syncedId,
  );
  if (!self) await writeDatabaseSchema(db, target.id, target.propertiesSchema);
  await db
    .update(pages)
    .set({ properties: sql`${pages.properties} - ${syncedId}` })
    .where(eq(pages.databaseId, target.id));
}
