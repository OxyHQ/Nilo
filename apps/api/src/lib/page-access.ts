/**
 * Who may do what on a page.
 *
 * A workspace's members reach its pages through their workspace role. A page
 * can also be shared with a person directly (`page_permissions`): a member,
 * or a guest who is not a member at all. A grant covers the page and its
 * subtree. A restricted page closes its subtree to members who have no grant
 * reaching it, and cuts off grants from above it.
 *
 * The effective role on a page, walking from the page up to the nearest
 * restricted page (or to the top when there is none):
 * - the workspace's owners and admins keep their role everywhere;
 * - otherwise the strongest of the grants on that stretch and, when nothing
 *   above or at the page is restricted, the member's workspace role;
 * - no role is no access.
 */
import type { Request, Response } from 'express';
import type { PgHandle } from '../db/client.js';
import { compareRoles, hasRole, type WorkspaceRole } from '../db/schema/workspaces.js';
import {
  type ChainLink,
  findGrantsForUser,
  findPageChain,
} from '../repositories/pagePermissions.js';
import { findMembership } from '../repositories/workspaces.js';
import { checkWorkspaceAccess } from './workspace-access.js';
import { databases } from '../db/schema/databases.js';
import { eq } from 'drizzle-orm';

export interface Grant {
  pageId: string;
  role: WorkspaceRole;
}

const strongest = (roles: readonly (WorkspaceRole | null | undefined)[]): WorkspaceRole | null =>
  roles.reduce<WorkspaceRole | null>(
    (best, role) => (role && (!best || compareRoles(role, best) > 0) ? role : best),
    null,
  );

/** The part of `chain` (page first) that grants reach: up to the nearest restricted page. */
export function grantReach(chain: readonly Pick<ChainLink, 'id' | 'restricted'>[]): {
  ids: string[];
  restricted: boolean;
} {
  const ids: string[] = [];
  for (const link of chain) {
    ids.push(link.id);
    if (link.restricted) return { ids, restricted: true };
  }
  return { ids, restricted: false };
}

/** The rule above, on data already loaded. */
export function effectivePageRole(input: {
  memberRole: WorkspaceRole | null;
  chain: readonly Pick<ChainLink, 'id' | 'restricted'>[];
  grants: readonly Grant[];
}): WorkspaceRole | null {
  const { memberRole, chain, grants } = input;
  if (memberRole && hasRole(memberRole, 'admin')) return memberRole;
  const reach = grantReach(chain);
  const inReach = new Set(reach.ids);
  const granted = strongest(grants.filter((g) => inReach.has(g.pageId)).map((g) => g.role));
  return strongest([reach.restricted ? null : memberRole, granted]);
}

export interface PageAccess {
  role: WorkspaceRole;
  /** The caller's workspace role; null for a guest. */
  memberRole: WorkspaceRole | null;
  /** The page, then its ancestors. */
  chain: ChainLink[];
  /** The caller's grants on the chain. */
  grants: Grant[];
}

/**
 * Which of the page's ancestors the caller can open too, root-first, ending
 * with the page: the run of accessible pages directly above it. A guest
 * shared one page deep in a workspace sees that page, not the path to it.
 */
export function accessibleAncestry(access: PageAccess): ChainLink[] {
  const out: ChainLink[] = [];
  for (let i = 0; i < access.chain.length; i += 1) {
    const role = effectivePageRole({
      memberRole: access.memberRole,
      chain: access.chain.slice(i),
      grants: access.grants,
    });
    if (!role) break;
    out.unshift(access.chain[i] as ChainLink);
  }
  return out;
}

/** `userId`'s access to `pageId`, or null when they have none (or there is no such page). */
export async function resolvePageAccess(
  db: PgHandle,
  userId: string,
  pageId: string,
): Promise<PageAccess | null> {
  const chain = await findPageChain(db, pageId);
  const page = chain[0];
  if (!page) return null;
  const [membership, grants] = await Promise.all([
    findMembership(db, page.workspaceId, userId),
    findGrantsForUser(
      db,
      userId,
      chain.map((link) => link.id),
    ),
  ]);
  const memberRole = (membership?.role as WorkspaceRole | undefined) ?? null;
  const held = grants.map((g) => ({ pageId: g.pageId, role: g.role }));
  const role = effectivePageRole({ memberRole, chain, grants: held });
  return role ? { role, memberRole, chain, grants: held } : null;
}

/**
 * Gate for a route on one page: the caller needs at least `minRole` on it.
 * Sends the 403 (shaped like the workspace gate's) and returns null when
 * they lack it; otherwise returns their access.
 */
export async function checkPageAccess(
  req: Request,
  res: Response,
  db: PgHandle,
  pageId: string,
  minRole: WorkspaceRole,
): Promise<PageAccess | null> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const access = await resolvePageAccess(db, userId, pageId);
  if (access && hasRole(access.role, minRole)) return access;
  res.status(403).json({
    error: access ? 'Forbidden: insufficient role' : 'Forbidden: no access to this page',
    code: access ? 'INSUFFICIENT_ROLE' : 'NO_PAGE_ACCESS',
    required: minRole,
    actual: access?.role ?? null,
  });
  return null;
}

/**
 * Which of a workspace's pages a member reaches, and with what role: the
 * same rule as `effectivePageRole`, over the whole list at once.
 */
export function rolesForPages(
  pages: readonly {
    id: string;
    parentId: string | null;
    restricted: boolean;
    databaseId?: string | null;
  }[],
  memberRole: WorkspaceRole | null,
  grants: readonly Grant[],
  /** Each database's host page (`databaseHosts`): what is above its rows. */
  hosts: ReadonlyMap<string, string | null> = new Map(),
): Map<string, WorkspaceRole> {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const above = (link: (typeof pages)[number]) =>
    link.parentId ?? (link.databaseId ? (hosts.get(link.databaseId) ?? null) : null);
  const out = new Map<string, WorkspaceRole>();
  for (const page of pages) {
    const chain: { id: string; restricted: boolean }[] = [];
    const seen = new Set<string>();
    for (
      let link = byId.get(page.id);
      link && !seen.has(link.id);
      link = above(link) ? byId.get(above(link) as string) : undefined
    ) {
      seen.add(link.id);
      chain.push(link);
    }
    const role = effectivePageRole({ memberRole, chain, grants });
    if (role) out.set(page.id, role);
  }
  return out;
}

/** Every database of a workspace and the page it sits in, for `rolesForPages`. */
export async function databaseHosts(
  db: PgHandle,
  workspaceId: string,
): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ id: databases.id, host: databases.parentPageId })
    .from(databases)
    .where(eq(databases.workspaceId, workspaceId));
  return new Map(rows.map((r) => [r.id, r.host]));
}

/**
 * Gate for a database route: an inline database is as open as the page it
 * sits in; one that sits in no page is open to the workspace by role.
 */
export async function checkDatabaseAccess(
  req: Request,
  res: Response,
  db: PgHandle,
  database: { workspaceId: string; parentPageId: string | null },
  minRole: WorkspaceRole,
): Promise<boolean> {
  if (database.parentPageId)
    return (await checkPageAccess(req, res, db, database.parentPageId, minRole)) !== null;
  return checkWorkspaceAccess(req, res, database.workspaceId, minRole);
}
