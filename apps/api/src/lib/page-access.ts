/**
 * Who may do what on a page — `docs/access.md` is the rule in prose.
 *
 * A page tree lives somewhere: in a teamspace, or private to its creator. The
 * caller's **base** role comes from that (`baseRole`): workspace owners and
 * admins keep their role in every teamspace; a teamspace's members have their
 * workspace role (its owners at least `admin`); anyone else in the workspace
 * has their workspace role in an open teamspace and nothing in a closed or
 * private one; a private tree is its owner's alone; a guest has none.
 *
 * A page can also be shared with a person directly (`page_permissions`): a
 * member, or a guest who is not a member at all. A grant covers the page and
 * its subtree. A restricted page closes its subtree to everyone without a
 * grant reaching it (workspace owners and admins in a teamspace excepted),
 * and cuts off grants from above it.
 *
 * The effective role, walking from the page up to the nearest restricted page
 * (or the top): the strongest of the grants on that stretch and, when nothing
 * at or above the page is restricted, the base role. No role is no access.
 */
import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';
import { databases } from '../db/schema/databases.js';
import {
  type TeamspacePrivacy,
  type TeamspaceRole,
  teamspaceMembers,
  teamspaces,
} from '../db/schema/teamspaces.js';
import { compareRoles, hasRole, type WorkspaceRole } from '../db/schema/workspaces.js';
import {
  type ChainLink,
  findGrantsForUser,
  findPageChain,
  listGrantsOfUserInWorkspace,
} from '../repositories/pagePermissions.js';
import { listPagesForAccess, type PageAccessRow } from '../repositories/pages.js';
import { findMembership } from '../repositories/workspaces.js';

export interface Grant {
  pageId: string;
  role: WorkspaceRole;
}

const strongest = (roles: readonly (WorkspaceRole | null | undefined)[]): WorkspaceRole | null =>
  roles.reduce<WorkspaceRole | null>(
    (best, role) => (role && (!best || compareRoles(role, best) > 0) ? role : best),
    null,
  );

/** Where a page tree lives: a teamspace, or (null) private to `ownerId`. */
export interface Home {
  teamspaceId: string | null;
  ownerId: string;
}

/** A teamspace as the caller stands in it. */
export interface TeamspaceStanding {
  privacy: TeamspacePrivacy;
  /**
   * The workspace's default teamspace: everyone's, so the workspace role
   * alone counts there (ownership of it follows no role change).
   */
  isDefault?: boolean;
  /** The caller's membership, or null when they do not belong to it. */
  role: TeamspaceRole | null;
}

/** The caller, as the rule sees them in one workspace. */
export interface Viewer {
  userId: string;
  /** Their workspace role; null for a guest. */
  memberRole: WorkspaceRole | null;
  /** The workspace's teamspaces they may need, with their standing in each. */
  teamspaces: ReadonlyMap<string, TeamspaceStanding>;
}

export interface BaseRole {
  role: WorkspaceRole | null;
  /** Workspace owners and admins in a teamspace: past restricted pages too. */
  passesRestricted: boolean;
}

const NO_BASE: BaseRole = { role: null, passesRestricted: false };

/**
 * The most anyone holds on a read-only database (`databases.read_only`, one a
 * sync keeps), its rows and what is beneath them: they read it, no one edits
 * it, whatever their role or grant says.
 */
export const READ_ONLY_CEILING: WorkspaceRole = 'viewer';

/** `role`, no more than `READ_ONLY_CEILING` when `readOnly`. */
export function readOnlyCapped(
  role: WorkspaceRole | null,
  readOnly: boolean | undefined,
): WorkspaceRole | null {
  if (!role || !readOnly) return role;
  return compareRoles(role, READ_ONLY_CEILING) > 0 ? READ_ONLY_CEILING : role;
}

/** The caller's role on a tree from where it lives, before restrictions and grants. */
export function baseRole(viewer: Viewer, home: Home): BaseRole {
  const { memberRole } = viewer;
  if (!memberRole) return NO_BASE;
  if (home.teamspaceId === null) {
    return home.ownerId === viewer.userId ? { role: 'admin', passesRestricted: false } : NO_BASE;
  }
  if (hasRole(memberRole, 'admin')) return { role: memberRole, passesRestricted: true };
  const team = viewer.teamspaces.get(home.teamspaceId);
  if (!team) return NO_BASE;
  if (team.role === 'owner' && !team.isDefault) {
    return { role: strongest([memberRole, 'admin']), passesRestricted: false };
  }
  if (team.role === 'member' || team.privacy === 'open') {
    return { role: memberRole, passesRestricted: false };
  }
  return NO_BASE;
}

/**
 * Where the tree `chain` (page first) belongs: its top page's place, or —
 * when the top is a row of a database that sits in no page — the database's.
 */
export function homeOf(
  chain: readonly Pick<ChainLink, 'teamspaceId' | 'ownerId' | 'database'>[],
): Home {
  const top = chain[chain.length - 1];
  if (!top) return { teamspaceId: null, ownerId: '' };
  if (top.database && top.database.parentPageId === null) {
    return { teamspaceId: top.database.teamspaceId, ownerId: top.database.ownerId };
  }
  return { teamspaceId: top.teamspaceId, ownerId: top.ownerId };
}

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

/**
 * The rule above, on data already loaded. A page in a read-only database
 * (itself a row of one, or beneath one) is capped at `READ_ONLY_CEILING`.
 */
export function effectivePageRole(input: {
  base: BaseRole;
  chain: readonly (Pick<ChainLink, 'id' | 'restricted'> & {
    database?: { readOnly?: boolean } | null;
  })[];
  grants: readonly Grant[];
}): WorkspaceRole | null {
  const { base, chain, grants } = input;
  const readOnly = chain.some((link) => link.database?.readOnly === true);
  if (base.passesRestricted) return readOnlyCapped(base.role, readOnly);
  const reach = grantReach(chain);
  const inReach = new Set(reach.ids);
  const granted = strongest(grants.filter((g) => inReach.has(g.pageId)).map((g) => g.role));
  return readOnlyCapped(strongest([reach.restricted ? null : base.role, granted]), readOnly);
}

export interface PageAccess {
  role: WorkspaceRole;
  /** The caller's workspace role; null for a guest. */
  memberRole: WorkspaceRole | null;
  /** What they have from where the page lives. */
  base: BaseRole;
  /** Where the page lives. */
  home: Home;
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
      base: access.base,
      chain: access.chain.slice(i),
      grants: access.grants,
    });
    if (!role) break;
    out.unshift(access.chain[i] as ChainLink);
  }
  return out;
}

/** The caller's standing in one teamspace (null: no such teamspace). */
async function teamspaceStanding(
  db: PgHandle,
  teamspaceId: string,
  userId: string,
): Promise<TeamspaceStanding | null> {
  const [row] = await db
    .select({
      privacy: teamspaces.privacy,
      isDefault: teamspaces.isDefault,
      role: teamspaceMembers.role,
    })
    .from(teamspaces)
    .leftJoin(
      teamspaceMembers,
      and(eq(teamspaceMembers.teamspaceId, teamspaces.id), eq(teamspaceMembers.userId, userId)),
    )
    .where(eq(teamspaces.id, teamspaceId));
  return row ? { privacy: row.privacy, isDefault: row.isDefault, role: row.role ?? null } : null;
}

/** The caller as `baseRole` needs them for one home. */
async function viewerFor(
  db: PgHandle,
  workspaceId: string,
  userId: string,
  home: Home,
): Promise<Viewer> {
  const [membership, standing] = await Promise.all([
    findMembership(db, workspaceId, userId),
    home.teamspaceId ? teamspaceStanding(db, home.teamspaceId, userId) : null,
  ]);
  return {
    userId,
    memberRole: (membership?.role as WorkspaceRole | undefined) ?? null,
    teamspaces: new Map(home.teamspaceId && standing ? [[home.teamspaceId, standing]] : []),
  };
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
  const home = homeOf(chain);
  const [viewer, grants] = await Promise.all([
    viewerFor(db, page.workspaceId, userId, home),
    findGrantsForUser(
      db,
      userId,
      chain.map((link) => link.id),
    ),
  ]);
  const held = grants.map((g) => ({ pageId: g.pageId, role: g.role }));
  const base = baseRole(viewer, home);
  const role = effectivePageRole({ base, chain, grants: held });
  return role ? { role, memberRole: viewer.memberRole, base, home, chain, grants: held } : null;
}

function forbidden(res: Response, minRole: WorkspaceRole, actual: WorkspaceRole | null): void {
  res.status(403).json({
    error: actual ? 'Forbidden: insufficient role' : 'Forbidden: no access to this page',
    code: actual ? 'INSUFFICIENT_ROLE' : 'NO_PAGE_ACCESS',
    required: minRole,
    actual,
  });
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
  forbidden(res, minRole, access?.role ?? null);
  return null;
}

/** A database's place: the page it sits in, or where it lives itself. */
export interface DatabaseHome {
  parentPageId: string | null;
  teamspaceId: string | null;
  ownerId: string;
  /** Kept by a sync: no one edits it (`readOnlyCapped`). */
  readOnly: boolean;
}

/** Every database of a workspace and where it is, for `rolesForPages`. */
export async function databaseHomes(
  db: PgHandle,
  workspaceId: string,
): Promise<Map<string, DatabaseHome>> {
  const rows = await db
    .select({
      id: databases.id,
      parentPageId: databases.parentPageId,
      teamspaceId: databases.teamspaceId,
      ownerId: databases.ownerId,
      readOnly: databases.readOnly,
    })
    .from(databases)
    .where(eq(databases.workspaceId, workspaceId));
  return new Map(rows.map(({ id, ...home }) => [id, home]));
}

/** The caller in a workspace, with their standing in each of its teamspaces. */
export async function loadViewer(
  db: PgHandle,
  workspaceId: string,
  userId: string,
): Promise<Viewer> {
  const [membership, rows] = await Promise.all([
    findMembership(db, workspaceId, userId),
    db
      .select({
        id: teamspaces.id,
        privacy: teamspaces.privacy,
        isDefault: teamspaces.isDefault,
        role: teamspaceMembers.role,
      })
      .from(teamspaces)
      .leftJoin(
        teamspaceMembers,
        and(eq(teamspaceMembers.teamspaceId, teamspaces.id), eq(teamspaceMembers.userId, userId)),
      )
      .where(eq(teamspaces.workspaceId, workspaceId)),
  ]);
  return {
    userId,
    memberRole: (membership?.role as WorkspaceRole | undefined) ?? null,
    teamspaces: new Map(
      rows.map((r) => [r.id, { privacy: r.privacy, isDefault: r.isDefault, role: r.role ?? null }]),
    ),
  };
}

/**
 * Which of a workspace's pages the caller reaches, and with what role: the
 * same rule as `resolvePageAccess`, over the whole list at once.
 */
export function rolesForPages(
  pages: readonly {
    id: string;
    parentId: string | null;
    restricted: boolean;
    teamspaceId: string | null;
    ownerId: string;
    databaseId?: string | null;
  }[],
  viewer: Viewer,
  grants: readonly Grant[],
  /** Each database's place (`databaseHomes`): what is above its rows. */
  homes: ReadonlyMap<string, DatabaseHome> = new Map(),
  /** Filled with the pages the caller reaches only through a grant (shared with them). */
  sharedOnly?: Set<string>,
): Map<string, WorkspaceRole> {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const above = (link: (typeof pages)[number]) =>
    link.parentId ?? (link.databaseId ? (homes.get(link.databaseId)?.parentPageId ?? null) : null);
  const out = new Map<string, WorkspaceRole>();
  for (const page of pages) {
    const chain: ((typeof pages)[number] & { database: DatabaseHome | null })[] = [];
    const seen = new Set<string>();
    for (
      let link = byId.get(page.id);
      link && !seen.has(link.id);
      link = above(link) ? byId.get(above(link) as string) : undefined
    ) {
      seen.add(link.id);
      chain.push({
        ...link,
        database: link.databaseId ? (homes.get(link.databaseId) ?? null) : null,
      });
    }
    const base = baseRole(viewer, homeOf(chain));
    const role = effectivePageRole({ base, chain, grants });
    if (!role) continue;
    out.set(page.id, role);
    if (sharedOnly && !effectivePageRole({ base, chain, grants: [] })) sharedOnly.add(page.id);
  }
  return out;
}

/** A workspace's pages and which of them the caller reaches (`visiblePagesOf`). */
export interface VisiblePages {
  pages: PageAccessRow[];
  byId: Map<string, PageAccessRow>;
  roles: Map<string, WorkspaceRole>;
  viewer: Viewer;
  grants: Grant[];
}

/**
 * `rolesForPages` over a whole workspace, its four reads at once. `archived`
 * filters the pages read, as `listPages` does: absent, the trash counts too.
 */
export async function visiblePagesOf(
  db: PgHandle,
  workspaceId: string,
  userId: string,
  filter: { archived?: boolean } = {},
): Promise<VisiblePages> {
  const [pages, viewer, grants, homes] = await Promise.all([
    listPagesForAccess(db, { workspaceId, archived: filter.archived }),
    loadViewer(db, workspaceId, userId),
    listGrantsOfUserInWorkspace(db, userId, workspaceId),
    databaseHomes(db, workspaceId),
  ]);
  return {
    pages,
    byId: new Map(pages.map((p) => [p.id, p])),
    roles: rolesForPages(pages, viewer, grants, homes),
    viewer,
    grants,
  };
}

/**
 * Gate for a database route: an inline database is as open as the page it
 * sits in; one that sits in no page lives in a teamspace, or privately with
 * its owner, like a top-level page.
 */
/** `userId`'s role on a database: its page's, or from where it lives. */
export async function resolveDatabaseRole(
  db: PgHandle,
  userId: string,
  database: { workspaceId: string } & DatabaseHome,
): Promise<WorkspaceRole | null> {
  if (database.parentPageId) {
    const role = (await resolvePageAccess(db, userId, database.parentPageId))?.role ?? null;
    return readOnlyCapped(role, database.readOnly);
  }
  const home = { teamspaceId: database.teamspaceId, ownerId: database.ownerId };
  const role = baseRole(await viewerFor(db, database.workspaceId, userId, home), home).role;
  return readOnlyCapped(role, database.readOnly);
}

/**
 * The caller's role on a database when it is at least `minRole`; otherwise the
 * refusal is sent and null returned.
 */
export async function checkDatabaseAccess(
  req: Request,
  res: Response,
  db: PgHandle,
  database: { workspaceId: string } & DatabaseHome,
  minRole: WorkspaceRole,
): Promise<WorkspaceRole | null> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  let role: WorkspaceRole | null;
  if (database.parentPageId) {
    role = (await resolvePageAccess(db, userId, database.parentPageId))?.role ?? null;
  } else {
    const home = { teamspaceId: database.teamspaceId, ownerId: database.ownerId };
    role = baseRole(await viewerFor(db, database.workspaceId, userId, home), home).role;
  }
  role = readOnlyCapped(role, database.readOnly);
  if (role && hasRole(role, minRole)) return role;
  forbidden(res, minRole, role);
  return null;
}
