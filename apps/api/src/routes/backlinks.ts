/**
 * GET /pages/:id/backlinks — the pages that point at this one: a link-to-page
 * block, a page mention in text (a segment whose `mention.attributes` are
 * `{ kind: 'page', id }`), or a link to `/p/<id>`. Only pages the caller can
 * open are listed, each with the text of the first block that points here.
 */
import { Router, type Request, type Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { hasRole } from '../db/schema/workspaces.js';
import { log } from '../lib/logger.js';
import { checkPageAccess, databaseHomes, loadViewer, rolesForPages } from '../lib/page-access.js';
import { authenticateToken } from '../middleware/auth.js';
import { listGrantsOfUserInWorkspace } from '../repositories/pagePermissions.js';
import { findPageById, listPages } from '../repositories/pages.js';

const router = Router();

router.get('/pages/:id/backlinks', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = z
      .object({ id: z.string().refine(isLiveEntityId, 'Invalid id') })
      .parse(req.params);
    const db = getDb();
    const access = await checkPageAccess(req, res, db, id, 'viewer');
    if (!access) return;
    const page = await findPageById(db, id);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const mention = JSON.stringify([{ mention: { attributes: { kind: 'page', id } } }]);
    // The first block that points here in reading order: a block's place is
    // the orders of its ancestors and its own, root first, so a nested block
    // is read where it sits and not by its order among its siblings alone.
    const rows = await db.execute(sql`
      with recursive matches as (
        select b.id, b.page_id, b.content ->> 'text' as text
        from blocks b
        join pages p on p.id = b.page_id
        where b.page_id <> ${id}
          and p.workspace_id = ${page.workspaceId}
          and not p.archived
          and (
            (b.type = 'link_to_page' and b.content ->> 'pageId' = ${id})
            or b.content -> 'segments' @> ${mention}::jsonb
            or exists (
              select 1 from jsonb_array_elements(
                case when jsonb_typeof(b.content -> 'segments') = 'array' then b.content -> 'segments' else '[]'::jsonb end
              ) s
              where s ->> 'link' = ${`/p/${id}`}
            )
          )
      ),
      place as (
        select m.id as match_id, b.id, b.parent_block_id, array[b."order"] as path
        from matches m join blocks b on b.id = m.id
        union all
        select place.match_id, parent.id, parent.parent_block_id, array[parent."order"] || place.path
        from place join blocks parent on parent.id = place.parent_block_id
      ) cycle id set is_cycle using cycle_path
      select distinct on (m.page_id) m.page_id, m.text
      from matches m
      join place on place.match_id = m.id and place.parent_block_id is null and not place.is_cycle
      order by m.page_id, place.path
    `);

    const userId = req.user?.id ?? '';
    const all = await listPages(db, { workspaceId: page.workspaceId });
    const byId = new Map(all.map((p) => [p.id, p]));
    const visible = rolesForPages(
      all,
      await loadViewer(db, page.workspaceId, userId),
      await listGrantsOfUserInWorkspace(db, userId, page.workspaceId),
      await databaseHomes(db, page.workspaceId),
    );

    const backlinks = rows
      .map((row) => ({
        pageId: String(row.page_id),
        text: typeof row.text === 'string' ? row.text : '',
      }))
      .filter((row) => byId.has(row.pageId) && (!visible || visible.has(row.pageId)))
      .map((row) => {
        const from = byId.get(row.pageId);
        return {
          page: { id: row.pageId, title: from?.title ?? '', icon: from?.icon ?? null },
          text: row.text.slice(0, 300),
        };
      });
    res.json({ backlinks });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    log.general.error({ err: error }, 'Failed to list backlinks');
    res.status(500).json({ error: 'Failed to list backlinks' });
  }
});

export default router;
