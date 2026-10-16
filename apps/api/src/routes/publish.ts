/**
 * Publishing a page to the web.
 *
 * A published page is readable by anyone at its public address, together with
 * its live subpages — except restricted ones and everything under them, which
 * stay private. Publishing needs full access to the page or being its
 * creator. Search engines are kept out unless the page allows indexing.
 */
import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { hasRole } from '../db/schema/workspaces.js';
import { log } from '../lib/logger.js';
import { checkPageAccess } from '../lib/page-access.js';
import { rateLimit } from '../lib/rate-limit.js';
import { authenticateToken } from '../middleware/auth.js';
import { listBlocksForPageByOrder } from '../repositories/blocks.js';
import { findPageChain } from '../repositories/pagePermissions.js';
import {
  findPageById,
  findPageByPublishSlug,
  findPagesByIds,
  listPages,
  type PageRow,
  updatePage,
} from '../repositories/pages.js';

const router = Router();
/** Published pages are read without signing in: bounded per client address. */
const publicReads = rateLimit('public-page', { max: 240, windowMs: 60_000 });

const entityIdSchema = z.string().refine(isLiveEntityId, 'Invalid id');
const slugSchema = z.string().regex(/^[a-z0-9-]{1,120}$/);

/** Lower-case ASCII words of the title, then a random suffix, so addresses are readable and unguessable enough. */
export function publishSlugFor(title: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  const suffix = crypto.randomBytes(5).toString('hex');
  return words ? `${words}-${suffix}` : suffix;
}

function publication(page: PageRow) {
  return {
    published: page.publishedAt !== null,
    slug: page.publishSlug,
    publishedAt: page.publishedAt,
    allowIndexing: page.publishIndexing,
  };
}

/** Full access or the page's creator: who may publish, change or unpublish it. */
async function authorizePublishing(
  req: Request,
  res: Response,
  pageId: string,
): Promise<PageRow | null> {
  const db = getDb();
  const page = await findPageById(db, pageId);
  if (!page) {
    res.status(404).json({ error: 'Page not found' });
    return null;
  }
  const access = await checkPageAccess(req, res, db, page.id, 'editor');
  if (!access) return null;
  if (!hasRole(access.role, 'admin') && page.ownerId !== req.user?.id) {
    res.status(403).json({
      error: 'Publishing a page needs full access to it',
      code: 'INSUFFICIENT_ROLE',
      required: 'admin',
      actual: access.role,
    });
    return null;
  }
  return page;
}

/**
 * POST /pages/:id/publish [{ allowIndexing? }]
 *
 * Publish the page (or change whether it may be indexed). Keeps the address
 * it had if it was published before.
 */
router.post('/pages/:id/publish', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: entityIdSchema }).parse(req.params);
    const body = z.object({ allowIndexing: z.boolean().optional() }).parse(req.body ?? {});
    const page = await authorizePublishing(req, res, id);
    if (!page) return;
    const db = getDb();
    const updated = await updatePage(db, page.id, {
      publishedAt: page.publishedAt ?? new Date(),
      publishSlug: page.publishSlug ?? publishSlugFor(page.title),
      ...(body.allowIndexing !== undefined && { publishIndexing: body.allowIndexing }),
    });
    res.json(publication(updated ?? page));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    log.general.error({ err: error }, 'Failed to publish page');
    res.status(500).json({ error: 'Failed to publish page' });
  }
});

/** DELETE /pages/:id/publish — take the page off the web; its address is kept for next time. */
router.delete('/pages/:id/publish', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: entityIdSchema }).parse(req.params);
    const page = await authorizePublishing(req, res, id);
    if (!page) return;
    const updated = await updatePage(getDb(), page.id, { publishedAt: null });
    res.json(publication(updated ?? page));
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    log.general.error({ err: error }, 'Failed to unpublish page');
    res.status(500).json({ error: 'Failed to unpublish page' });
  }
});

/** What the public sees of a page: no owner, workspace, grants or properties. */
function publicPage(page: PageRow) {
  return {
    id: page.id,
    title: page.title,
    icon: page.icon,
    cover: page.cover,
    coverPosition: page.coverPosition,
    // How it is laid out, as its readers see it.
    font: page.font,
    mode: page.mode,
    fullWidth: page.fullWidth,
    smallText: page.smallText,
    updatedAt: page.updatedAt,
  };
}

async function respondWithPublicPage(
  res: Response,
  root: PageRow,
  page: PageRow,
  trail: PageRow[],
) {
  const db = getDb();
  const [blocks, children] = await Promise.all([
    listBlocksForPageByOrder(db, page.id),
    listPages(db, {
      workspaceId: page.workspaceId,
      parentId: page.id,
      archived: false,
      template: false,
    }),
  ]);
  if (!root.publishIndexing) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.json({
    page: publicPage(page),
    blocks: blocks.map((b) => ({
      id: b.id,
      parentBlockId: b.parentBlockId,
      type: b.type,
      content: b.content,
      order: b.order,
    })),
    // Restricted subpages stay private, and so does everything under them.
    children: children
      .filter((c) => !c.restricted)
      .map((c) => ({ id: c.id, title: c.title, icon: c.icon })),
    breadcrumb: trail.map((p) => ({ id: p.id, title: p.title, icon: p.icon })),
    site: { slug: root.publishSlug, allowIndexing: root.publishIndexing },
  });
}

async function publishedRoot(res: Response, slug: string): Promise<PageRow | null> {
  const root = await findPageByPublishSlug(getDb(), slug);
  if (!root || !root.publishedAt || root.archived) {
    res.status(404).json({ error: 'This page is not published' });
    return null;
  }
  return root;
}

/** GET /public/pages/:slug — a published page, for anyone. */
router.get('/public/pages/:slug', publicReads, async (req: Request, res: Response) => {
  try {
    const parsed = slugSchema.safeParse(req.params.slug);
    if (!parsed.success) {
      res.status(404).json({ error: 'This page is not published' });
      return;
    }
    const root = await publishedRoot(res, parsed.data);
    if (!root) return;
    await respondWithPublicPage(res, root, root, [root]);
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to read a published page');
    res.status(500).json({ error: 'Failed to load the page' });
  }
});

/**
 * GET /public/pages/:slug/:pageId — a subpage of a published page: reachable
 * only through live, unrestricted pages from the published one down.
 */
router.get('/public/pages/:slug/:pageId', publicReads, async (req: Request, res: Response) => {
  try {
    const slug = slugSchema.safeParse(req.params.slug);
    const pageId = entityIdSchema.safeParse(req.params.pageId);
    if (!slug.success || !pageId.success) {
      res.status(404).json({ error: 'This page is not published' });
      return;
    }
    const root = await publishedRoot(res, slug.data);
    if (!root) return;

    const db = getDb();
    const chain = await findPageChain(db, pageId.data);
    const rootAt = chain.findIndex((link) => link.id === root.id);
    if (rootAt < 0) {
      res.status(404).json({ error: 'This page is not published' });
      return;
    }
    // The stretch from the page up to (not including) the published page.
    const below = chain.slice(0, rootAt);
    const rows = await findPagesByIds(
      db,
      below.map((link) => link.id),
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const stretch = below.map((link) => byId.get(link.id));
    if (stretch.some((row) => !row || row.archived || row.restricted || row.template)) {
      res.status(404).json({ error: 'This page is not published' });
      return;
    }
    const trail = [root, ...(stretch as PageRow[]).reverse()];
    await respondWithPublicPage(res, root, trail.at(-1) as PageRow, trail);
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to read a published subpage');
    res.status(500).json({ error: 'Failed to load the page' });
  }
});

export default router;
