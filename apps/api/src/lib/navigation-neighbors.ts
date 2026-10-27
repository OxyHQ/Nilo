import { createHash } from 'node:crypto';
import type { NavigationNeighbor, NavigationNeighbors } from '@oxy.so/nilo-contracts';
import { isLiveEntityId } from '@oxy.so/db';
import { and, asc, eq, gt, gte, isNull, type SQL } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';
import { databases } from '../db/schema/databases.js';
import { pages } from '../db/schema/pages.js';
import { resolveDatabaseRole, resolvePageAccess } from './page-access.js';

export class NavigationRejected extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Location {
  workspaceId: string;
  parentId: string | null;
  teamspaceId: string | null;
  ownerId: string;
  databaseId: string | null;
}
type Destination = Omit<NavigationNeighbor, 'href' | 'current'>;
const BATCH_SIZE = 32;
const pageFields = { id: pages.id, title: pages.title, icon: pages.icon };
const databaseFields = {
  id: databases.id,
  title: databases.name,
  icon: databases.icon,
  workspaceId: databases.workspaceId,
  parentPageId: databases.parentPageId,
  teamspaceId: databases.teamspaceId,
  ownerId: databases.ownerId,
  readOnly: databases.readOnly,
};

/** Cursor is scoped to the anchor AND its location, so moving it cannot reuse an old list. */
type Position = Pick<NavigationNeighbor, 'id' | 'kind'>;
export function readNavigationCursor(cursor: string | undefined, scope: string): Position | null {
  if (!cursor) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      value &&
      typeof value === 'object' &&
      'scope' in value &&
      value.scope === scope &&
      'after' in value &&
      value.after !== null &&
      typeof value.after === 'object' &&
      'id' in value.after &&
      typeof value.after.id === 'string' &&
      isLiveEntityId(value.after.id) &&
      'kind' in value.after &&
      (value.after.kind === 'page' || value.after.kind === 'database')
    )
      return { id: value.after.id, kind: value.after.kind };
  } catch {
    /* Rejected below, without reflecting client-controlled input. */
  }
  throw new NavigationRejected(400, 'Invalid navigation cursor');
}

function locationFilter(location: Location, kind: 'page' | 'database'): SQL {
  if (kind === 'page' && location.databaseId) return eq(pages.databaseId, location.databaseId);
  const parent = kind === 'page' ? pages.parentId : databases.parentPageId;
  const teamspace = kind === 'page' ? pages.teamspaceId : databases.teamspaceId;
  const owner = kind === 'page' ? pages.ownerId : databases.ownerId;
  if (location.parentId) return eq(parent, location.parentId);
  return and(
    isNull(parent),
    location.teamspaceId ? eq(teamspace, location.teamspaceId) : isNull(teamspace),
    // Private roots belong to the same home, not every private tree in the workspace.
    location.teamspaceId ? undefined : eq(owner, location.ownerId),
  ) as SQL;
}

/**
 * A bounded keyset scan of siblings. Authorization happens before counting a
 * response page; inaccessible candidates never consume its limit or cursor.
 * Uses the existing permission owner, not a second SQL implementation of grants.
 */
export async function navigationNeighbors(
  db: PgHandle,
  userId: string,
  kind: 'page' | 'database',
  id: string,
  limit: number,
  cursor?: string,
): Promise<NavigationNeighbors> {
  let anchor: Destination;
  let location: Location;
  let onlyAnchor = false;
  if (kind === 'page') {
    const access = await resolvePageAccess(db, userId, id);
    if (!access) throw new NavigationRejected(403, 'No access to this page');
    const [page] = await db.select().from(pages).where(eq(pages.id, id));
    if (!page || page.archived || page.template)
      throw new NavigationRejected(404, 'Page not found');
    anchor = { kind, id, title: page.title, icon: page.icon };
    location = { ...page, databaseId: page.databaseId, parentId: page.parentId };
    if (page.databaseId) {
      const [database] = await db.select().from(databases).where(eq(databases.id, page.databaseId));
      // A grant to one row never grants enumeration of the containing database.
      onlyAnchor =
        !database || database.archived || !(await resolveDatabaseRole(db, userId, database));
    }
  } else {
    const [database] = await db.select().from(databases).where(eq(databases.id, id));
    if (!database) throw new NavigationRejected(404, 'Database not found');
    if (!(await resolveDatabaseRole(db, userId, database))) {
      throw new NavigationRejected(403, 'No access to this database');
    }
    if (database.archived) throw new NavigationRejected(404, 'Database not found');
    anchor = { kind, id, title: database.name, icon: database.icon };
    location = { ...database, parentId: database.parentPageId, databaseId: null };
  }
  const scope = createHash('sha256')
    .update(
      JSON.stringify([
        kind,
        id,
        location.workspaceId,
        location.parentId,
        location.teamspaceId,
        location.ownerId,
        location.databaseId,
        userId,
        onlyAnchor,
      ]),
    )
    .digest('base64url');
  let after = readNavigationCursor(cursor, scope);
  const present = (item: Destination): NavigationNeighbor => ({
    ...item,
    href: `/${item.kind === 'page' ? 'p' : 'db'}/${item.id}`,
    current: item.kind === kind && item.id === id,
  });
  if (onlyAnchor) return { items: after ? [] : [present(anchor)], nextCursor: null };
  const authorized: Destination[] = [];
  while (authorized.length <= limit) {
    const pageBatch = await db
      .select(pageFields)
      .from(pages)
      .where(
        and(
          eq(pages.workspaceId, location.workspaceId),
          eq(pages.archived, false),
          eq(pages.template, false),
          location.databaseId ? undefined : isNull(pages.databaseId),
          locationFilter(location, 'page'),
          after
            ? after.kind === 'database'
              ? gte(pages.id, after.id)
              : gt(pages.id, after.id)
            : undefined,
        ),
      )
      .orderBy(asc(pages.id))
      .limit(BATCH_SIZE);
    const databaseBatch = location.databaseId
      ? []
      : await db
          .select(databaseFields)
          .from(databases)
          .where(
            and(
              eq(databases.workspaceId, location.workspaceId),
              eq(databases.archived, false),
              locationFilter(location, 'database'),
              after ? gt(databases.id, after.id) : undefined,
            ),
          )
          .orderBy(asc(databases.id))
          .limit(BATCH_SIZE);
    const candidates = [
      ...pageBatch.map((page) => ({ ...page, kind: 'page' as const })),
      ...databaseBatch.map((database) => ({ ...database, kind: 'database' as const })),
    ]
      .sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0,
      )
      .slice(0, BATCH_SIZE);
    if (candidates.length === 0) break;
    for (const candidate of candidates) {
      after = { id: candidate.id, kind: candidate.kind };
      const allowed =
        candidate.kind === 'page'
          ? await resolvePageAccess(db, userId, candidate.id)
          : await resolveDatabaseRole(db, userId, candidate);
      if (allowed) {
        authorized.push({
          kind: candidate.kind,
          id: candidate.id,
          title: candidate.title,
          icon: candidate.icon,
        });
        if (authorized.length > limit) break;
      }
    }
  }
  const items = authorized.slice(0, limit).map(present);
  const nextCursor =
    authorized.length > limit
      ? Buffer.from(
          JSON.stringify({
            scope,
            after: { id: items[items.length - 1]?.id, kind: items[items.length - 1]?.kind },
          }),
        ).toString('base64url')
      : null;
  return { items, nextCursor };
}
