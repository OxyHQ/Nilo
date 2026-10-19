/**
 * What a page's export says about what it points at (`ExportContext` in
 * `@oxy.so/nilo-contracts`): the titles of the pages it links to and its
 * inline databases as tables — each only when the reader exporting it may
 * open that page or database. Bounded, so a page of links cannot turn one
 * export into thousands of reads.
 */
import type { BlockNode, ExportContext } from '@oxy.so/nilo-contracts';
import type { PgHandle } from '../db/client.js';
import { findDatabaseById } from '../repositories/databases.js';
import { findPagesByIds, listDatabaseRows } from '../repositories/pages.js';
import { databaseToTable } from './databases/csv.js';
import { resolveDatabaseRole, resolvePageAccess } from './page-access.js';

const MAX_LINKED_PAGES = 100;
const MAX_DATABASES = 10;
const MAX_ROWS = 1000;

function targets(tree: readonly BlockNode[], types: readonly string[], key: string): string[] {
  const ids = new Set<string>();
  const walk = (nodes: readonly BlockNode[]) => {
    for (const node of nodes) {
      const id = node.content[key];
      if (types.includes(node.type) && typeof id === 'string') ids.add(id);
      walk(node.children);
    }
  };
  walk(tree);
  return [...ids];
}

export async function exportContext(
  db: PgHandle,
  viewerId: string,
  page: { workspaceId: string },
  tree: readonly BlockNode[],
): Promise<ExportContext> {
  const titles = new Map<string, string>();
  const linked = await findPagesByIds(
    db,
    targets(tree, ['link_to_page', 'child_page'], 'pageId').slice(0, MAX_LINKED_PAGES),
    { workspaceId: page.workspaceId, archived: false },
  );
  for (const target of linked) {
    if (await resolvePageAccess(db, viewerId, target.id)) titles.set(target.id, target.title);
  }

  const tables = new Map<string, { name: string; table: string[][] }>();
  for (const id of targets(tree, ['inline_database'], 'databaseId').slice(0, MAX_DATABASES)) {
    const database = await findDatabaseById(db, id);
    if (!database || database.archived || database.workspaceId !== page.workspaceId) continue;
    if (!(await resolveDatabaseRole(db, viewerId, database))) continue;
    const rows = await listDatabaseRows(db, id, { archived: false, template: false });
    tables.set(id, {
      name: database.name,
      table: databaseToTable(database.propertiesSchema, rows.slice(0, MAX_ROWS)),
    });
  }

  return { pageTitle: (id) => titles.get(id), database: (id) => tables.get(id) };
}
