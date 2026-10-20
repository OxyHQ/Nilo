/**
 * Pages exported together, as Notion's "Export with subpages" and "Export
 * workspace": a ZIP with one Markdown or HTML file per page and, for a page
 * with subpages, a folder of the same name holding theirs.
 *
 * Only what the reader may open goes in: the workspace's live pages filtered
 * by the same rule the page list uses (`rolesForPages`), each page's links
 * and inline databases as far as they may see them (`exportContext`).
 * Database rows travel inside their database's table, templates not at all.
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
import type { PageAccessRow } from '../repositories/pages.js';
import { exportContext } from './export-context.js';
import { rateLimit } from './rate-limit.js';
import { visiblePagesOf } from './page-access.js';

export const MAX_EXPORTED_PAGES = 500;

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
  const { pages: all, roles } = await visiblePagesOf(db, workspaceId, viewerId, {
    archived: false,
  });
  const visible = all.filter((p) => roles.has(p.id) && !p.template && !p.databaseId);
  const byId = new Map(visible.map((p) => [p.id, p]));
  const children = new Map<string, PageAccessRow[]>();
  for (const page of visible) {
    if (!page.parentId || !byId.has(page.parentId)) continue;
    const list = children.get(page.parentId) ?? [];
    list.push(page);
    children.set(page.parentId, list);
  }
  // A page whose parent the reader cannot see starts a tree of its own.
  const roots =
    input.rootIds === null
      ? visible.filter((p) => !p.parentId || !byId.has(p.parentId))
      : input.rootIds.flatMap((id) => byId.get(id) ?? []);

  const files: Record<string, Uint8Array> = {};
  const extension = format === 'html' ? 'html' : 'md';
  let count = 0;
  const unique = (folder: string, name: string, taken: Set<string>) => {
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${name} (${n})`;
    taken.add(candidate.toLowerCase());
    return `${folder}${candidate}`;
  };
  const add = async (pages: readonly PageAccessRow[], folder: string, seen: Set<string>) => {
    const taken = new Set<string>();
    for (const page of pages) {
      if (seen.has(page.id)) continue;
      seen.add(page.id);
      count += 1;
      if (count > MAX_EXPORTED_PAGES) throw new ExportTooLarge();
      const title = page.title?.trim() ? page.title : 'Untitled';
      const tree = inReadingOrder(blocksToTree(await listBlocksForPage(db, page.id)));
      const context = await exportContext(db, viewerId, page, tree);
      const body =
        format === 'html'
          ? blocksToHtml(tree, title, context)
          : blocksToMarkdown(tree, title, context);
      const path = unique(folder, fileName(title), taken);
      files[`${path}.${extension}`] = strToU8(body);
      const below = children.get(page.id);
      if (below) await add(below, `${path}/`, seen);
    }
  };
  await add(roots, '', new Set());
  return { bytes: zipSync(files, { level: 6 }), pages: count };
}
