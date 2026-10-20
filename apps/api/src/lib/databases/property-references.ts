/**
 * What a row's values name must exist: a select's or a status's option, a
 * multi-select's options, a person property's people of the workspace (its
 * members, and its guests, who hold a page of it) and a relation's rows of its
 * target database. A value that names anything else is refused, so a client
 * never stores an id no reader can show.
 *
 * Only what a write adds is checked. An id the row already held stays valid
 * after its option is removed, its member leaves or its row is trashed: the
 * client sends the whole list back when it edits one entry of it.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { PgHandle } from '../../db/client.js';
import type { DatabaseSchema } from '../../db/schema/databases.js';
import { type PageProperties, pages } from '../../db/schema/pages.js';
import { listUsersWithGrantsInWorkspace } from '../../repositories/pagePermissions.js';
import { listMembershipsForUsers } from '../../repositories/workspaces.js';
import { asObject, stringsAt } from './json-values.js';

export interface InvalidReference {
  propertyId: string;
  error: string;
  code: 'UNKNOWN_OPTION' | 'UNKNOWN_PERSON' | 'UNKNOWN_RELATED_ROW';
}

/** The ids of `field` (a string or a list of strings) in a stored value. */
function idsOf(value: unknown, field: 'optionId' | 'optionIds' | 'userIds' | 'pageIds'): string[] {
  const raw = asObject(value)?.[field];
  return typeof raw === 'string' ? [raw] : stringsAt(value, field);
}

/**
 * The first value of `incoming` (stored shapes, by property id) that names
 * something `database` cannot hold, or null. `previous` is the row as it was;
 * empty for a row being created.
 */
export async function invalidReference(
  handle: PgHandle,
  database: { workspaceId: string; propertiesSchema: DatabaseSchema },
  incoming: Record<string, unknown>,
  previous: PageProperties = {},
): Promise<InvalidReference | null> {
  for (const property of database.propertiesSchema.properties) {
    if (!(property.id in incoming)) continue;
    const field =
      property.type === 'select' || property.type === 'status'
        ? 'optionId'
        : property.type === 'multi_select'
          ? 'optionIds'
          : property.type === 'person'
            ? 'userIds'
            : property.type === 'relation'
              ? 'pageIds'
              : null;
    if (!field) continue;
    const held = new Set(idsOf(previous[property.id], field));
    const added = [...new Set(idsOf(incoming[property.id], field))].filter((id) => !held.has(id));
    if (added.length === 0) continue;

    if (field === 'optionId' || field === 'optionIds') {
      const options = new Set((property.config?.options ?? []).map((o) => o.id));
      if (added.some((id) => !options.has(id))) {
        return {
          propertyId: property.id,
          error: `"${property.name}" has no such option`,
          code: 'UNKNOWN_OPTION',
        };
      }
    } else if (field === 'userIds') {
      const members = new Set(
        (await listMembershipsForUsers(handle, database.workspaceId, added)).map((m) => m.userId),
      );
      const others = added.filter((id) => !members.has(id));
      const guests = await listUsersWithGrantsInWorkspace(handle, database.workspaceId, others);
      if (guests.length < others.length) {
        return {
          propertyId: property.id,
          error: `Only people of the workspace can be set in "${property.name}"`,
          code: 'UNKNOWN_PERSON',
        };
      }
    } else {
      // A relation relates the live rows of its target database, never a template.
      const targetId = property.config?.targetDatabaseId;
      const found = targetId
        ? await handle
            .select({ id: pages.id })
            .from(pages)
            .where(
              and(
                inArray(pages.id, added),
                eq(pages.databaseId, targetId),
                eq(pages.archived, false),
                eq(pages.template, false),
              ),
            )
        : [];
      if (found.length < added.length) {
        return {
          propertyId: property.id,
          error: `"${property.name}" can only relate rows of its database`,
          code: 'UNKNOWN_RELATED_ROW',
        };
      }
    }
  }
  return null;
}
