/**
 * What a page's export says about what it points at (`ExportContext` in
 * `@oxy.so/nilo-contracts`): the titles of the pages it links to, its
 * inline databases as tables and what its synced blocks show — each only
 * when the reader exporting it may open that page or database. Bounded, so a
 * page of links cannot turn one export into thousands of reads.
 */
import { type BlockNode, blocksToTree, type ExportContext } from '@oxy.so/nilo-contracts';
import type { PgHandle } from '../db/client.js';
import { findDatabaseById } from '../repositories/databases.js';
import { findPagesByIds, listDatabaseRows } from '../repositories/pages.js';
import { databaseToTable } from './databases/csv.js';
import { resolveDatabaseRole, resolvePageAccess } from './page-access.js';
import { resolveSyncedBlocks } from './synced-blocks.js';

const MAX_LINKED_PAGES = 100;
const MAX_DATABASES = 10;
const MAX_ROWS = 1000;

type Table = { name: string; table: string[][] };

/**
 * What an export of many pages already knows (`exportPagesZip`): the
 * workspace's live pages and which the reader opens, so a link costs no read.
 */
export interface ExportAccess {
  byId: ReadonlyMap<string, { title: string }>;
  canOpen: (pageId: string) => boolean;
}

export interface ExportOptions {
  access?: ExportAccess;
  /** The tables already read in this export, by database id (null: not shown). */
  tables?: Map<string, Promise<Table | null>>;
}

export async function exportContext(
  db: PgHandle,
  viewerId: string,
  page: { workspaceId: string },
  tree: readonly BlockNode[],
  { access, tables = new Map() }: ExportOptions = {},
): Promise<ExportContext> {
  const flat: BlockNode[] = [];
  const linkIds = new Set<string>();
  const databaseIds = new Set<string>();
  const walk = (nodes: readonly BlockNode[]) => {
    for (const node of nodes) {
      flat.push(node);
      const { pageId, databaseId } = node.content;
      if (
        (node.type === 'link_to_page' || node.type === 'child_page') &&
        typeof pageId === 'string'
      )
        linkIds.add(pageId);
      if (node.type === 'inline_database' && typeof databaseId === 'string')
        databaseIds.add(databaseId);
      walk(node.children);
    }
  };
  walk(tree);

  // A page outside what the export knows (another workspace's) is checked alone.
  const canOpen = async (pageId: string) =>
    access?.byId.has(pageId)
      ? access.canOpen(pageId)
      : (await resolvePageAccess(db, viewerId, pageId)) !== null;

  const titles = new Map<string, string>();
  const linked = [...linkIds].slice(0, MAX_LINKED_PAGES);
  if (access) {
    for (const id of linked) {
      const target = access.byId.get(id);
      if (target && access.canOpen(id)) titles.set(id, target.title);
    }
  } else {
    const targets = await findPagesByIds(db, linked, {
      workspaceId: page.workspaceId,
      archived: false,
    });
    for (const target of targets) {
      if (await canOpen(target.id)) titles.set(target.id, target.title);
    }
  }

  const readTable = async (id: string): Promise<Table | null> => {
    const database = await findDatabaseById(db, id);
    if (!database || database.archived || database.workspaceId !== page.workspaceId) return null;
    const open = database.parentPageId
      ? await canOpen(database.parentPageId)
      : (await resolveDatabaseRole(db, viewerId, database)) !== null;
    if (!open) return null;
    const rows = await listDatabaseRows(db, id, {
      archived: false,
      template: false,
      limit: MAX_ROWS,
    });
    return { name: database.name, table: databaseToTable(database.propertiesSchema, rows) };
  };
  const shown = await Promise.all(
    [...databaseIds].slice(0, MAX_DATABASES).map(async (id) => {
      let table = tables.get(id);
      if (!table) {
        table = readTable(id);
        tables.set(id, table);
      }
      return [id, await table] as const;
    }),
  );
  const tableOf = new Map(shown.flatMap(([id, table]) => (table ? [[id, table] as const] : [])));

  const synced = await resolveSyncedBlocks(db, flat, canOpen);
  const syncedTrees = new Map([...synced].map(([id, rows]) => [id, blocksToTree(rows)]));

  return {
    pageTitle: (id) => titles.get(id),
    database: (id) => tableOf.get(id),
    syncedBlocks: (id) => syncedTrees.get(id),
  };
}
