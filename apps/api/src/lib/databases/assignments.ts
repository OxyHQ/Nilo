/**
 * Telling people they were assigned, as Notion does: someone added them to a
 * person property of a database row. Never the person who did it, only those
 * who can open the row, and never on a template (no one has work there yet).
 * Best effort: the row is saved either way.
 */
import { getDb } from '../../db/client.js';
import type { DatabaseProperty } from '../../db/schema/databases.js';
import type { PageProperties } from '../../db/schema/pages.js';
import { log } from '../logger.js';
import { sendNotification } from '../notification-service.js';
import { resolvePageAccess } from '../page-access.js';

function peopleIn(value: unknown): Set<string> {
  const ids = (value as { userIds?: unknown } | null | undefined)?.userIds;
  return new Set(
    Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
  );
}

/** The people each person property gained between `before` and `after`. */
export function newlyAssigned(
  properties: readonly DatabaseProperty[],
  before: PageProperties,
  after: PageProperties,
): { userId: string; property: DatabaseProperty }[] {
  const out: { userId: string; property: DatabaseProperty }[] = [];
  for (const property of properties) {
    if (property.type !== 'person') continue;
    const had = peopleIn(before[property.id]);
    for (const userId of peopleIn(after[property.id])) {
      if (!had.has(userId)) out.push({ userId, property });
    }
  }
  return out;
}

export async function notifyAssigned(input: {
  properties: readonly DatabaseProperty[];
  row: { id: string; title: string; databaseId: string | null; template: boolean };
  before: PageProperties;
  after: PageProperties;
  actorId: string;
}): Promise<void> {
  if (input.row.template) return;
  for (const { userId, property } of newlyAssigned(input.properties, input.before, input.after)) {
    if (userId === input.actorId) continue;
    try {
      if (!(await resolvePageAccess(getDb(), userId, input.row.id))) continue;
      await sendNotification({
        userId,
        type: 'assigned',
        title: `You were added to ${input.row.title || 'Untitled'}`,
        body: property.name,
        priority: 'normal',
        data: {
          pageId: input.row.id,
          databaseId: input.row.databaseId,
          propertyId: property.id,
          propertyName: property.name,
          authorId: input.actorId,
        },
      });
    } catch (err: unknown) {
      log.general.warn(
        { err, userId, pageId: input.row.id },
        'Failed to tell someone they were assigned',
      );
    }
  }
}
