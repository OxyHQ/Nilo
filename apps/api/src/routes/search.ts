/**
 * GET /search?workspaceId=…&q=…[&limit=20][&titleOnly=true][&createdBy=…]
 *             [&teamspaceId=…|private][&editedAfter=…][&editedBefore=…]
 *
 * Full-text search over a workspace's live pages: titles and block text, word
 * prefixes and quoted lexical phrases, every term required; in titles, an
 * unquoted word may also be close, typos included. Results are pages, best first, each with the
 * block that matched best and a snippet whose matches are marked (as parts,
 * never markup), and the titles of the pages above it. Only pages the caller
 * can open are returned. The filters narrow it, as Notion's do: titles only,
 * the page's creator, the teamspace its tree lives in, when it was last
 * edited. With filters and nothing typed, the matching pages come latest
 * edited first.
 */
import { Router, type Request, type Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { log } from '../lib/logger.js';
import { databaseHomes, loadViewer, rolesForPages } from '../lib/page-access.js';
import { authenticateToken } from '../middleware/auth.js';
import { listGrantsOfUserInWorkspace } from '../repositories/pagePermissions.js';
import { listPages } from '../repositories/pages.js';
import { findLiveWorkspaceById, findMembership } from '../repositories/workspaces.js';
import {
  parseSearchQuery,
  searchPages,
  type SearchFilter,
  type SnippetPart,
} from '../repositories/search.js';

const router = Router();

const entityId = z.string().refine(isLiveEntityId, 'Invalid id');

const querySchema = z.object({
  workspaceId: entityId,
  q: z.string().max(500).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** Match titles only, never the text of the pages. */
  titleOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  /** Pages this person created. */
  createdBy: z.string().min(1).max(200).optional(),
  /** Pages living in this teamspace, or `private` for the caller's private pages. */
  teamspaceId: z.union([entityId, z.literal('private')]).optional(),
  /** Edited in this range: at or after `editedAfter`, before `editedBefore`. */
  editedAfter: z.string().datetime({ offset: true }).optional(),
  editedBefore: z.string().datetime({ offset: true }).optional(),
});

/**
 * GET /search?workspaceId&q&limit — the pages of a workspace the caller can
 * open whose title or text matches, best first. Members search what their
 * role and grants open; a guest (no membership, pages shared with them)
 * searches those pages.
 */
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const params = querySchema.parse(req.query);
    const { workspaceId, q, limit } = params;
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
    const filter: SearchFilter = {
      createdBy: params.createdBy,
      editedAfter: params.editedAfter ? new Date(params.editedAfter) : undefined,
      editedBefore: params.editedBefore ? new Date(params.editedBefore) : undefined,
    };
    const filtered =
      Boolean(filter.createdBy || filter.editedAfter || filter.editedBefore) ||
      params.teamspaceId !== undefined;
    const query = parseSearchQuery(q);
    // Nothing typed and nothing to narrow by: nothing to show.
    if (!query && !filtered) {
      res.json({ results: [] });
      return;
    }

    const [all, homes] = await Promise.all([
      listPages(db, { workspaceId, archived: false }),
      databaseHomes(db, workspaceId),
    ]);

    const visible = rolesForPages(all, await loadViewer(db, workspaceId, userId), grants, homes);
    const byId = new Map(all.map((p) => [p.id, p]));

    /** The teamspace a page's tree lives in, read at its top; null for private. */
    const teamspaceOf = (pageId: string): string | null => {
      const seen = new Set<string>();
      let page = byId.get(pageId);
      while (page && !seen.has(page.id)) {
        seen.add(page.id);
        const home = page.databaseId ? homes.get(page.databaseId) : undefined;
        const above = page.parentId ?? home?.parentPageId ?? null;
        if (!above) return home ? home.teamspaceId : page.teamspaceId;
        page = byId.get(above);
      }
      return null;
    };
    const wanted = params.teamspaceId === 'private' ? null : params.teamspaceId;
    const inTeamspace = (pageId: string) =>
      params.teamspaceId === undefined || teamspaceOf(pageId) === wanted;

    const scored = new Map<
      string,
      { score: number; matchedTitle: boolean; blockId: string | null; snippet: SnippetPart[] }
    >();
    if (query) {
      const authorizedIds = all
        .filter((page) => visible.has(page.id) && inTeamspace(page.id))
        .map((page) => page.id);
      const hits = await searchPages(
        db,
        workspaceId,
        authorizedIds,
        query,
        limit,
        params.titleOnly,
        filter,
      );
      for (const hit of hits) scored.set(hit.pageId, hit);
    } else {
      // Only filters: the matching pages, the latest edited first.
      const after = filter.editedAfter?.getTime();
      const before = filter.editedBefore?.getTime();
      const matching = all
        .filter(
          (p) =>
            !p.template &&
            (!filter.createdBy || p.ownerId === filter.createdBy) &&
            (after === undefined || p.updatedAt.getTime() >= after) &&
            (before === undefined || p.updatedAt.getTime() < before),
        )
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      for (const [i, p] of matching.entries()) {
        scored.set(p.id, { score: -i, matchedTitle: false, blockId: null, snippet: [] });
      }
    }

    const path = (pageId: string): string[] => {
      const titlesAbove: string[] = [];
      const seen = new Set([pageId]);
      for (let parent = byId.get(pageId)?.parentId; parent && !seen.has(parent); ) {
        seen.add(parent);
        const above = byId.get(parent);
        if (!above || !visible.has(above.id)) break;
        titlesAbove.unshift(above.title);
        parent = above.parentId;
      }
      return titlesAbove;
    };

    const results = [...scored.entries()]
      .filter(([pageId]) => byId.has(pageId) && visible.has(pageId) && inTeamspace(pageId))
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
