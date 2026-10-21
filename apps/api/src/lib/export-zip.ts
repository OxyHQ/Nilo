/**
 * Pages exported together, as Notion's "Export with subpages" and "Export
 * workspace": a ZIP with one Markdown or HTML file per page and, for a page
 * with subpages, a folder of the same name holding theirs.
 *
 * Only what the reader may open goes in: the workspace's live pages filtered
 * by the same rule the page list uses (`rolesForPages`), each page's links
 * and inline databases as far as they may see them (`exportContext`).
 * Databases export a CSV and a folder of row documents, templates not at all.
 * Bounded, so one request cannot read a whole large workspace at once.
 */
import {
  blocksToHtml,
  blocksToMarkdown,
  blocksToTree,
  inReadingOrder,
} from '@oxy.so/nilo-contracts';
import { strToU8, zipSync } from 'fflate';
import type { PgHandle } from '../db/client.js';
import { listBlocksForPage } from '../repositories/blocks.js';
import { type DatabaseRecord, listDatabasesByWorkspace } from '../repositories/databases.js';
import { listDatabaseRows, type PageAccessRow } from '../repositories/pages.js';
import { databaseToTable, toCsv } from './databases/csv.js';
import { type ExportOptions, exportContext } from './export-context.js';
import { rateLimit } from './rate-limit.js';
import { resolveDatabaseRole, visiblePagesOf } from './page-access.js';
import { projectPage } from './page-projection.js';

/** Counts page documents and database CSVs together; an export never truncates. */
export const MAX_EXPORTED_PAGES = 500;

type ExportNode =
  | { kind: 'page'; id: string; page: PageAccessRow }
  | { kind: 'database'; id: string; database: DatabaseRecord };
const keyOf = (node: ExportNode) => `${node.kind}:${node.id}`;

/** A ZIP reads a whole tree of pages: a member gets a few a minute. */
export const zipExports = rateLimit('export-zip', { max: 5, windowMs: 60_000 });

export type ZipFormat = 'md' | 'html';

/** A name every OS accepts for a file or folder, from a page's title. */
export function fileName(title: string): string {
  const name = title
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\.+/u, '')
    .slice(0, 100)
    .trim();
  return name || 'Untitled';
}

export class ExportTooLarge extends Error {}

/**
 * The ZIP of `rootIds` and their subpages, or — `rootIds` null — of every
 * page the reader can open at the top of the workspace.
 */
export async function exportPagesZip(
  db: PgHandle,
  input: {
    viewerId: string;
    workspaceId: string;
    rootIds: readonly string[] | null;
    format: ZipFormat;
  },
): Promise<{ bytes: Uint8Array; pages: number }> {
  const { viewerId, workspaceId, format } = input;
  const {
    pages: all,
    byId: live,
    roles,
  } = await visiblePagesOf(db, workspaceId, viewerId, { archived: false });
  // What every page's links and databases are checked against: read once.
  const shared: ExportOptions = {
    access: { byId: live, canOpen: (id) => roles.has(id) },
    tables: new Map(),
  };
  // Archiving a database does not mark its row pages archived. Its whole
  // subtree must remain out of the live export, rather than becoming roots.
  const databases = await listDatabasesByWorkspace(db, { workspaceId, includeArchived: true });
  const databaseById = new Map(databases.map((database) => [database.id, database]));
  const retained = new Map<string, boolean>();
  const isLiveDocument = (page: PageAccessRow): boolean => {
    const chain = new Set<string>();
    let link: PageAccessRow | undefined = page;
    let keep = true;
    while (link) {
      const cached = retained.get(link.id);
      if (cached !== undefined) {
        keep = cached;
        break;
      }
      const database = link.databaseId ? databaseById.get(link.databaseId) : undefined;
      if (chain.has(link.id) || link.template || database?.archived) {
        keep = false;
        break;
      }
      chain.add(link.id);
      const parent = link.parentId ?? database?.parentPageId;
      link = parent ? live.get(parent) : undefined;
    }
    for (const id of chain) retained.set(id, keep);
    return keep;
  };
  const visible = all.filter((p) => roles.has(p.id) && isLiveDocument(p));
  const nodes = new Map<string, ExportNode>(
    visible.map((page) => [`page:${page.id}`, { kind: 'page', id: page.id, page }]),
  );
  for (const database of databases) {
    if (database.archived) continue;
    const allowed = database.parentPageId
      ? nodes.has(`page:${database.parentPageId}`)
      : (await resolveDatabaseRole(db, viewerId, database)) !== null;
    if (allowed)
      nodes.set(`database:${database.id}`, { kind: 'database', id: database.id, database });
  }
  const parentKey = (node: ExportNode): string | null => {
    if (node.kind === 'database')
      return node.database.parentPageId ? `page:${node.database.parentPageId}` : null;
    // Match the canonical page-access chain: an explicit page parent wins.
    if (node.page.parentId) return `page:${node.page.parentId}`;
    return node.page.databaseId ? `database:${node.page.databaseId}` : null;
  };
  const children = new Map<string, ExportNode[]>();
  const roots: ExportNode[] = [];
  for (const node of nodes.values()) {
    const parent = parentKey(node);
    if (parent && nodes.has(parent)) {
      const list = children.get(parent) ?? [];
      list.push(node);
      children.set(parent, list);
    } else {
      // A separately shared row does not disclose its inaccessible database.
      roots.push(node);
    }
  }

  const entries: { node: ExportNode; path: string }[] = [];
  const seen = new Set<string>();
  const collect = (siblings: readonly ExportNode[], folder: string) => {
    // Pages and database folders share one namespace, even though their file
    // extensions differ; otherwise their descendants could overwrite one another.
    const taken = new Set<string>();
    for (const node of siblings) {
      const key = keyOf(node);
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size > MAX_EXPORTED_PAGES) throw new ExportTooLarge();
      const name = fileName(node.kind === 'page' ? node.page.title : node.database.name);
      let candidate = name;
      for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${name} (${n})`;
      taken.add(candidate.toLowerCase());
      const path = `${folder}${candidate}`;
      entries.push({ node, path });
      collect(children.get(key) ?? [], `${path}/`);
    }
  };
  collect(
    input.rootIds === null ? roots : input.rootIds.flatMap((id) => nodes.get(`page:${id}`) ?? []),
    '',
  );

  const files: Record<string, Uint8Array> = {};
  // Project only the selected, authorized inventory. The canonical projector
  // locks each page, including in-flight work from another process. Unlike the
  // background queue, this direct call propagates a failure instead of exporting
  // stale blocks. Do this before CSV too, for last-edited-time properties.
  for (const { node } of entries) {
    if (node.kind === 'page') await projectPage(db, node.id);
  }
  // Inventory is complete and checked before loading any body. Reuse the same
  // authorized, unpaginated rows for CSV and embedded table serialization.
  for (const { node, path } of entries) {
    if (node.kind !== 'database') continue;
    const rows = (await listDatabaseRows(db, node.id, { archived: false, template: false })).filter(
      (row) => roles.has(row.id),
    );
    const table = databaseToTable(node.database.propertiesSchema, rows);
    shared.tables?.set(node.id, Promise.resolve({ name: node.database.name, table }));
    files[`${path}.csv`] = strToU8(`\uFEFF${toCsv(table)}`);
  }
  const extension = format === 'html' ? 'html' : 'md';
  let count = 0;
  for (const { node, path } of entries) {
    if (node.kind !== 'page') continue;
    const { page } = node;
    const title = page.title?.trim() ? page.title : 'Untitled';
    const tree = inReadingOrder(blocksToTree(await listBlocksForPage(db, page.id)));
    const context = await exportContext(db, viewerId, page, tree, shared);
    const body =
      format === 'html'
        ? blocksToHtml(tree, title, context)
        : blocksToMarkdown(tree, title, context);
    files[`${path}.${extension}`] = strToU8(body);
    count += 1;
  }
  return { bytes: zipSync(files, { level: 6 }), pages: count };
}
