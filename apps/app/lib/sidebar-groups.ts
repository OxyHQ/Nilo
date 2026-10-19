import type { Page } from './types/pages';
import type { Database } from './types/databases';
import type { Teamspace } from './hooks/use-teamspaces';

/** Classify the accessible roots first, then keep each visible subtree together. */
export function groupSidebar(
  pages: Page[],
  databases: Database[],
  teamspaces: Teamspace[],
  userId: string,
) {
  const joined = teamspaces
    .filter((t) => t.role !== null && !t.archived)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  const archived = new Set(teamspaces.filter((t) => t.archived).map((t) => t.id));
  const groups = new Map(joined.map((t) => [t.id, [] as Page[]]));
  const privatePages: Page[] = [];
  const shared: Page[] = [];
  const visible = pages.filter((p) => !p.archived && !p.template && !p.databaseId);
  const byId = new Map(visible.map((p) => [p.id, p]));
  for (const page of visible) {
    let root = page;
    const seen = new Set([root.id]);
    while (root.parentId && byId.has(root.parentId) && !seen.has(root.parentId)) {
      const parent = byId.get(root.parentId);
      if (!parent) break;
      root = parent;
      seen.add(root.id);
    }
    // An archived teamspace leaves the sidebar with its pages, as in Notion; the
    // teamspace dialog lists it to unarchive.
    if (root.teamspaceId !== null && archived.has(root.teamspaceId)) continue;
    if (root.parentId === null && root.teamspaceId !== null && groups.has(root.teamspaceId)) {
      groups.get(root.teamspaceId)?.push(page);
    } else if (root.parentId === null && root.teamspaceId === null && root.ownerId === userId) {
      privatePages.push(page);
    } else if (root.sharedWithMe) {
      shared.push(page);
    }
    // Otherwise it is open to the caller by role in a teamspace they have
    // not joined: found by browsing teamspaces or searching, as in Notion.
  }
  const standalone = databases.filter((d) => !d.archived && d.parentPageId === null);
  return {
    teamspaces: joined.map((teamspace) => ({
      teamspace,
      pages: groups.get(teamspace.id) ?? [],
      databases: standalone.filter((d) => d.teamspaceId === teamspace.id),
    })),
    privatePages,
    privateDatabases: standalone.filter((d) => d.teamspaceId === null && d.ownerId === userId),
    shared,
  };
}
