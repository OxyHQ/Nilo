/**
 * GET /search?workspaceId=…&q=…[&limit=20]
 *
 * Full-text search over a workspace's live pages: titles and block text, word
 * prefixes, every word required. Results are pages, best first, each with the
 * block that matched best and a snippet whose matches are marked (as parts,
 * never markup), and the titles of the pages above it. Only pages the caller
 * can open are returned.
 */
import { Router, type Request, type Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { hasRole, type WorkspaceRole } from '../db/schema/workspaces.js';
import { log } from '../lib/logger.js';
import { databaseHomes, loadViewer, rolesForPages } from '../lib/page-access.js';
import { authenticateToken } from '../middleware/auth.js';
import { listGrantsOfUserInWorkspace } from '../repositories/pagePermissions.js';
import { listPages } from '../repositories/pages.js';
import { findLiveWorkspaceById, findMembership } from '../repositories/workspaces.js';
import {
  prefixQuery,
  searchBlockText,
  searchPageTitles,
  type SnippetPart,
} from '../repositories/search.js';

const router = Router();

const querySchema = z.object({
  workspaceId: z.string().refine(isLiveEntityId, 'Invalid id'),
  q: z.string().max(500),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** A title match outranks any amount of body text. */
const TITLE_WEIGHT = 1;

/**
 * GET /search?workspaceId&q&limit — the pages of a workspace the caller can
 * open whose title or text matches, best first. Members search what their
 * role and grants open; a guest (no membership, pages shared with them)
 * searches those pages.
 */
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { workspaceId, q, limit } = querySchema.parse(req.query);
    const userId = req.user?.id ?? '';
    const db = getDb();
    const [workspace, member, grants] = await Promise.all([
      findLiveWorkspaceById(db, workspaceId),
      findMembership(db, workspaceId, userId),
      listGrantsOfUserInWorkspace(db, userId, workspaceId),
    ]);
    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (!member && grants.length === 0) {
      res.status(403).json({ error: 'Forbidden: nothing in this workspace is shared with you' });
      return;
    }
    const query = prefixQuery(q);
    if (!query) {
      res.json({ results: [] });
      return;
    }

    // More than `limit` from each side: some are dropped for access below.
    const [titles, texts, all] = await Promise.all([
      searchPageTitles(db, workspaceId, query, limit * 3),
      searchBlockText(db, workspaceId, query, limit * 3),
      listPages(db, { workspaceId, archived: false }),
    ]);

    const visible = rolesForPages(
      all,
      await loadViewer(db, workspaceId, userId),
      grants,
      await databaseHomes(db, workspaceId),
    );
    const byId = new Map(all.map((p) => [p.id, p]));

    const scored = new Map<
      string,
      { score: number; matchedTitle: boolean; blockId: string | null; snippet: SnippetPart[] }
    >();
    for (const hit of titles) {
      scored.set(hit.pageId, {
        score: TITLE_WEIGHT + hit.rank,
        matchedTitle: true,
        blockId: null,
        snippet: [],
      });
    }
    for (const hit of texts) {
      const current = scored.get(hit.pageId);
      scored.set(hit.pageId, {
        score: (current?.score ?? 0) + hit.rank,
        matchedTitle: current?.matchedTitle ?? false,
        blockId: hit.blockId,
        snippet: hit.snippet,
      });
    }

    const path = (pageId: string): string[] => {
      const titlesAbove: string[] = [];
      const seen = new Set([pageId]);
      for (let parent = byId.get(pageId)?.parentId; parent && !seen.has(parent); ) {
        seen.add(parent);
        const above = byId.get(parent);
        if (!above || (visible && !visible.has(above.id))) break;
        titlesAbove.unshift(above.title);
        parent = above.parentId;
      }
      return titlesAbove;
    };

    const results = [...scored.entries()]
      .filter(([pageId]) => byId.has(pageId) && (!visible || visible.has(pageId)))
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit)
      .map(([pageId, hit]) => {
        const page = byId.get(pageId);
        return {
          page: {
            id: pageId,
            title: page?.title ?? '',
            icon: page?.icon ?? null,
            parentId: page?.parentId ?? null,
          },
          path: path(pageId),
          matchedTitle: hit.matchedTitle,
          blockId: hit.blockId,
          snippet: hit.snippet,
        };
      });

    res.json({ results });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    log.general.error({ err: error }, 'Search failed');
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
