/**
 * Synced blocks outside the editor: what a reference shows when a page is
 * read without its document (exports, share links, published pages), and
 * where an original is shown.
 *
 * An original is a `sync_block` holding its content as children; a reference
 * is a `sync_block` naming it (`sourceBlockId`, `sourcePageId`). A reference's
 * blocks are its original's, read from the original's page — only when the
 * reader may read that page (`canRead`), so a reference never shows more than
 * opening the original would.
 */
import { type FlatBlock, syncedSource } from '@oxy.so/nilo-contracts';
import type { PgHandle } from '../db/client.js';
import { findBlocksByIds, listBlocksForPage } from '../repositories/blocks.js';
import { findPagesByIds } from '../repositories/pages.js';

/** Originals read for one page, at most: a page of references cannot fan out without end. */
export const MAX_SYNCED_SOURCES = 25;
/** How deep a reference inside an original is followed (a reference in what it shows). */
const MAX_SYNCED_DEPTH = 3;

/** The originals the given blocks refer to, by original id. */
export function referencesIn(
  blocks: readonly Pick<FlatBlock, 'type' | 'content'>[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of blocks) {
    const source = syncedSource(block.type, block.content);
    if (source) out.set(source.blockId, source.pageId);
  }
  return out;
}

/** Every block under `rootId` (not the block itself), as the page lists them. */
export function descendantsOf<T extends Pick<FlatBlock, 'id' | 'parentBlockId'>>(
  rows: readonly T[],
  rootId: string,
): T[] {
  const children = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.parentBlockId) continue;
    const list = children.get(row.parentBlockId) ?? [];
    list.push(row);
    children.set(row.parentBlockId, list);
  }
  const out: T[] = [];
  const seen = new Set<string>([rootId]);
  const visit = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      visit(child.id);
    }
  };
  visit(rootId);
  return out;
}

/**
 * What each reference among `blocks` shows: its original's blocks (flat, the
 * original's children at the top), by original id. A reference whose original
 * is gone, is not an original, sits on a page in the trash or one `canRead`
 * refuses is absent: it shows nothing. References inside what an original
 * holds are followed as well, a few levels deep.
 */
export async function resolveSyncedBlocks(
  db: PgHandle,
  blocks: readonly Pick<FlatBlock, 'type' | 'content'>[],
  canRead: (pageId: string) => Promise<boolean>,
): Promise<Map<string, FlatBlock[]>> {
  const resolved = new Map<string, FlatBlock[]>();
  const tried = new Set<string>();
  const pageRows = new Map<string, FlatBlock[]>();
  const readable = new Map<string, boolean>();
  let wanted = referencesIn(blocks);

  for (let depth = 0; depth < MAX_SYNCED_DEPTH && wanted.size > 0; depth += 1) {
    const ids = [...wanted.keys()].filter((id) => !tried.has(id));
    const room = MAX_SYNCED_SOURCES - tried.size;
    const batch = ids.slice(0, Math.max(0, room));
    for (const id of batch) tried.add(id);
    if (batch.length === 0) break;

    const originals = await findBlocksByIds(db, batch);
    const pages = new Map(
      (
        await findPagesByIds(
          db,
          originals.map((o) => o.pageId),
        )
      ).map((p) => [p.id, p]),
    );
    const next = new Map<string, string>();
    for (const original of originals) {
      // A reference names an original, never another reference.
      if (original.type !== 'sync_block' || syncedSource(original.type, original.content)) {
        continue;
      }
      const page = pages.get(original.pageId);
      if (!page || page.archived) continue;
      let allowed = readable.get(page.id);
      if (allowed === undefined) {
        allowed = await canRead(page.id);
        readable.set(page.id, allowed);
      }
      if (!allowed) continue;
      let rows = pageRows.get(page.id);
      if (!rows) {
        rows = (await listBlocksForPage(db, page.id)).map((row) => ({
          id: row.id,
          parentBlockId: row.parentBlockId,
          type: row.type,
          content: row.content as FlatBlock['content'],
          order: row.order,
        }));
        pageRows.set(page.id, rows);
      }
      const shown = descendantsOf(rows, original.id);
      resolved.set(original.id, shown);
      for (const [sourceId, sourcePage] of referencesIn(shown)) {
        if (!tried.has(sourceId)) next.set(sourceId, sourcePage);
      }
    }
    wanted = next;
  }
  return resolved;
}
