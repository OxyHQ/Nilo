/**
 * Synced blocks across pages (`lib/synced-blocks.ts`):
 *
 * - `GET /blocks/:id/synced` — where an original is shown: every reference to
 *   it on a live page of its workspace the caller can open.
 * - `GET /workspaces/:workspaceId/synced-blocks` — the originals the caller
 *   can read in a workspace, newest page first, each with the start of its
 *   text: what "Paste synced block" offers.
 *
 * Both read the projected rows, so a block made a moment ago may take a
 * second to be listed.
 */
import { Router, type Request, type Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { syncedSource } from '@oxy.so/nilo-contracts';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { log } from '../lib/logger.js';
import { checkPageAccess, resolvePageAccess, visiblePagesOf } from '../lib/page-access.js';
import { authenticateToken } from '../middleware/auth.js';
import { findBlockById } from '../repositories/blocks.js';
import type { ChainLink } from '../repositories/pagePermissions.js';
import { findPagesByIds, type PageAccessRow, type PageRow } from '../repositories/pages.js';

const router = Router();

const idSchema = z.string().refine(isLiveEntityId, 'Invalid id');
/** Originals listed at most. */
const MAX_LISTED = 100;
const PREVIEW_LENGTH = 160;

const pageRef = (page: Pick<PageRow, 'id' | 'title' | 'icon'>) => ({
  id: page.id,
  title: page.title,
  icon: page.icon ?? null,
});

function failed(res: Response, error: unknown, what: string): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: error.errors });
    return;
  }
  log.general.error({ err: error }, `Failed to ${what}`);
  res.status(500).json({ error: `Failed to ${what}` });
}

router.get('/blocks/:id/synced', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: idSchema }).parse(req.params);
    const db = getDb();
    const original = await findBlockById(db, id);
    if (original?.type !== 'sync_block' || syncedSource(original.type, original.content)) {
      res.status(404).json({ error: 'Synced block not found' });
      return;
    }
    const access = await checkPageAccess(req, res, db, original.pageId, 'viewer');
    if (!access) return;

    const rows = await db.execute(sql`
      select b.id, b.page_id
      from blocks b
      join pages p on p.id = b.page_id
      where b.type = 'sync_block'
        and b.content ->> 'sourceBlockId' = ${original.id}
        and p.workspace_id = ${(access.chain[0] as ChainLink).workspaceId}
        and not p.archived
      order by p.updated_at desc, b.id
    `);
    const shownOn = rows.map((row) => ({ blockId: String(row.id), pageId: String(row.page_id) }));
    const pageIds = [...new Set(shownOn.map((row) => row.pageId))];
    const userId = req.user?.id ?? '';
    // Only the pages showing it are checked, not the whole workspace.
    const [pages, opened] = await Promise.all([
      findPagesByIds(db, [original.pageId, ...pageIds]),
      Promise.all(pageIds.map((pageId) => resolvePageAccess(db, userId, pageId))),
    ]);
    const byId = new Map(pages.map((p) => [p.id, p]));
    const open = new Set(pageIds.filter((_, i) => opened[i]));
    const page = byId.get(original.pageId);
    if (!page) {
      res.status(404).json({ error: 'Synced block not found' });
      return;
    }
    const references = shownOn
      .filter((row) => open.has(row.pageId) && byId.has(row.pageId))
      .map((row) => ({ blockId: row.blockId, page: pageRef(byId.get(row.pageId) as PageRow) }));
    res.json({ original: { blockId: original.id, page: pageRef(page) }, references });
  } catch (error: unknown) {
    failed(res, error, 'list where a synced block is shown');
  }
});

router.get(
  '/workspaces/:workspaceId/synced-blocks',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { workspaceId } = z.object({ workspaceId: idSchema }).parse(req.params);
      const db = getDb();
      // The text an original starts with: its first blocks', in order.
      const [rows, { byId, roles }] = await Promise.all([
        db.execute(sql`
        select b.id, b.page_id,
          (
            select string_agg(nullif(c.content ->> 'text', ''), ' ' order by c."order", c.id)
            from blocks c
            where c.parent_block_id = b.id
          ) as preview
        from blocks b
        join pages p on p.id = b.page_id
        where p.workspace_id = ${workspaceId}
          and not p.archived
          and b.type = 'sync_block'
          and b.content ->> 'sourceBlockId' is null
        order by p.updated_at desc, b.id
        limit ${MAX_LISTED * 4}
      `),
        visiblePagesOf(db, workspaceId, req.user?.id ?? ''),
      ]);
      const syncedBlocks = rows
        .map((row) => ({
          blockId: String(row.id),
          pageId: String(row.page_id),
          preview: typeof row.preview === 'string' ? row.preview : '',
        }))
        .filter((row) => roles.has(row.pageId) && byId.has(row.pageId))
        .slice(0, MAX_LISTED)
        .map((row) => ({
          blockId: row.blockId,
          page: pageRef(byId.get(row.pageId) as PageAccessRow),
          preview: row.preview.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH),
        }));
      res.json({ syncedBlocks });
    } catch (error: unknown) {
      failed(res, error, 'list synced blocks');
    }
  },
);

export default router;
