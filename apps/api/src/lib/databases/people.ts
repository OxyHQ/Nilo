/**
 * Who a person property can name: the people of the database's workspace,
 * its members and its guests (who hold a page of it), as
 * `property-references.ts` checks a write. A picker lists exactly these, so
 * it never offers someone the write would refuse.
 */
import { and, asc, eq, notInArray } from 'drizzle-orm';
import type { PgHandle } from '../../db/client.js';
import { pagePermissions } from '../../db/schema/collab.js';
import { pages } from '../../db/schema/pages.js';
import { listMembers } from '../../repositories/workspaces.js';

export interface DatabasePerson {
  userId: string;
  /** Holds a page of the workspace without being a member of it. */
  guest: boolean;
}

/** The workspace's members, newest first as its member list shows them, then its guests. */
export async function listDatabasePeople(
  handle: PgHandle,
  workspaceId: string,
): Promise<DatabasePerson[]> {
  const members = await listMembers(handle, workspaceId);
  const memberIds = members.map((m) => m.userId);
  const guests = await handle
    .selectDistinct({ userId: pagePermissions.userId })
    .from(pagePermissions)
    .innerJoin(pages, eq(pages.id, pagePermissions.pageId))
    .where(
      and(
        eq(pages.workspaceId, workspaceId),
        memberIds.length > 0 ? notInArray(pagePermissions.userId, memberIds) : undefined,
      ),
    )
    .orderBy(asc(pagePermissions.userId));
  return [
    ...memberIds.map((userId) => ({ userId, guest: false })),
    ...guests.map(({ userId }) => ({ userId, guest: true })),
  ];
}
