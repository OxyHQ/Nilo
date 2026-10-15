/**
 * Creating a database row: every way rows are made (the rows route, forms,
 * CSV imports, templates) goes through `createRow`, so each gets its
 * `unique_id` numbers.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { PgHandle } from '../../db/client.js';
import { type DatabaseSchema, databases } from '../../db/schema/databases.js';
import { pages } from '../../db/schema/pages.js';
import { createPage, type CreatePageInput, type PageRow } from '../../repositories/pages.js';

/** Take `count` row numbers of a database at once; returns the first. */
async function takeRowNumbers(db: PgHandle, databaseId: string, count: number): Promise<number> {
  const [row] = await db
    .update(databases)
    .set({ nextRowNumber: sql`${databases.nextRowNumber} + ${count}` })
    .where(eq(databases.id, databaseId))
    .returning({ next: databases.nextRowNumber });
  return (row?.next ?? count + 1) - count;
}

const uniqueIdProperties = (schema: DatabaseSchema) =>
  schema.properties.filter((p) => p.type === 'unique_id');

/** A row of `database`, with the next number for each of its ID properties. */
export async function createRow(
  db: PgHandle,
  database: { id: string; propertiesSchema: DatabaseSchema },
  input: Omit<CreatePageInput, 'databaseId'>,
): Promise<PageRow> {
  const ids = uniqueIdProperties(database.propertiesSchema);
  const properties = { ...(input.properties ?? {}) };
  if (ids.length > 0) {
    const number = await takeRowNumbers(db, database.id, 1);
    for (const property of ids) properties[property.id] = { number };
  }
  return createPage(db, { ...input, databaseId: database.id, properties });
}

/**
 * Number the rows of a database for a new ID property, oldest first, and
 * move the database's counter past them.
 */
export async function numberExistingRows(
  db: PgHandle,
  databaseId: string,
  propertyId: string,
): Promise<void> {
  const rows = await db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.databaseId, databaseId)))
    .orderBy(asc(pages.createdAt), asc(pages.id));
  const [current] = await db
    .select({ next: databases.nextRowNumber })
    .from(databases)
    .where(eq(databases.id, databaseId));
  let number = current?.next ?? 1;
  for (const row of rows) {
    await db
      .update(pages)
      .set({
        properties: sql`${pages.properties} || ${JSON.stringify({ [propertyId]: { number } })}::jsonb`,
      })
      .where(eq(pages.id, row.id));
    number += 1;
  }
  await db.update(databases).set({ nextRowNumber: number }).where(eq(databases.id, databaseId));
}
