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
import { checkPageAccess, databaseHosts, rolesForPages } from '../lib/page-access.js';
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
    const rows = await db.execute(sql`
      select distinct on (b.page_id) b.page_id, b.content ->> 'text' as text
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
      order by b.page_id, b."order"
    `);

    const memberRole = access.memberRole;
    const all = await listPages(db, { workspaceId: page.workspaceId });
    const byId = new Map(all.map((p) => [p.id, p]));
    const visible =
      memberRole && hasRole(memberRole, 'admin')
        ? null
        : rolesForPages(
            all,
            memberRole,
            await listGrantsOfUserInWorkspace(db, req.user?.id ?? '', page.workspaceId),
            await databaseHosts(db, page.workspaceId),
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
