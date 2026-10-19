import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.js';
import { getDb } from '../db/client.js';
import { hasRole } from '../db/schema/workspaces.js';
import { type PageGrantRole, SHARE_LINK_SCOPES, type ShareLinkScope } from '../db/schema/collab.js';
import { listBlocksForPageByOrder } from '../repositories/blocks.js';
import { findPageById, type PageRow } from '../repositories/pages.js';
import {
  createShareLink,
  findShareLinkById,
  findShareLinkByToken,
  listActiveShareLinksByPage,
  revokeShareLink,
} from '../repositories/shareLinks.js';
import { checkPageAccess, resolvePageAccess } from '../lib/page-access.js';
import {
  deleteGrantsFromShareLink,
  findGrant,
  upsertGrant,
} from '../repositories/pagePermissions.js';
import { log } from '../lib/logger.js';
import { generateLinkToken as generateToken, publicAppUrl } from '../lib/public-links.js';
import { rateLimit } from '../lib/rate-limit.js';
import { resolveSyncedBlocks } from '../lib/synced-blocks.js';
import { respondWithFileUrls } from './files.js';

const router = Router();

function shareLinkPublicUrl(token: string): string {
  return publicAppUrl(`/share/${token}`);
}

const createShareLinkSchema = z.object({
  scope: z
    .enum(SHARE_LINK_SCOPES as unknown as [ShareLinkScope, ...ShareLinkScope[]])
    .default('read'),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});

/**
 * Narrow an Express route param to a single string, normalizing the
 * `string | string[]` shape Express types declare for path params.
 */
function paramString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

type LoadedPage = PageRow;

/**
 * Asserts the caller is a member of the workspace owning `pageId` with at
 * least the role `editor`. Returns the page on success, or null after
 * having already sent an error response.
 */
async function authorizePageForShareManagement(
  req: Request,
  res: Response,
  pageIdRaw: unknown,
): Promise<{ page: LoadedPage } | null> {
  if (!req.user?.id) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const pageId = paramString(pageIdRaw);
  if (!pageId) {
    res.status(400).json({ error: 'Invalid page id' });
    return null;
  }

  // No 24-hex shape gate: it rejected every uuidv7 the schema now produces. A
  // malformed id matches no row and falls through to the 404 below.
  const db = getDb();
  const page = await findPageById(db, pageId);
  if (!page) {
    res.status(404).json({ error: 'Page not found' });
    return null;
  }

  // Edit access to the page manages its links, guests included.
  if (!(await checkPageAccess(req, res, db, page.id, 'editor'))) return null;

  return { page };
}

/**
 * POST /api/pages/:pageId/share
 *
 * Create a new share link for a page. Requires editor+ on the page's
 * workspace.
 */
router.post('/pages/:pageId/share', authenticateToken, async (req: Request, res: Response) => {
  try {
    const auth = await authorizePageForShareManagement(req, res, req.params.pageId);
    if (!auth) return;
    const { page } = auth;
    const userId = req.user?.id;
    if (!userId) {
      // authorize* already 401s if missing; this re-check keeps TS happy.
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const parsed = createShareLinkSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
      return;
    }

    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      res.status(400).json({ error: 'expiresAt must be in the future' });
      return;
    }

    // Up to a few retries in the extremely unlikely event of a token
    // collision. base64url(24) gives 192 bits of entropy; collisions are
    // not expected in practice.
    // `createShareLink` uses ON CONFLICT DO NOTHING RETURNING, so a token
    // collision comes back as null rather than as an exception. That is the
    // whole point: the ported `code === 11000` catch could not tell a
    // collision from a dropped connection, and would have retried — with a
    // fresh token — against an infrastructure failure. Here a real failure
    // still throws out of the loop.
    let link: Awaited<ReturnType<typeof createShareLink>> = null;
    let attempts = 0;
    while (!link && attempts < 5) {
      attempts++;
      link = await createShareLink(getDb(), {
        pageId: page.id,
        token: generateToken(),
        scope: parsed.data.scope,
        createdBy: userId,
        expiresAt,
      });
    }

    if (!link) {
      log.general.error({ pageId: page.id }, 'Failed to generate unique share token');
      res.status(500).json({ error: 'Failed to generate share link' });
      return;
    }

    res.status(201).json({
      shareLink: {
        id: link.id,
        token: link.token,
        url: shareLinkPublicUrl(link.token),
        scope: link.scope,
        expiresAt: link.expiresAt,
        createdAt: link.createdAt,
        createdBy: link.createdBy,
      },
    });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to create share link');
    res.status(500).json({ error: 'Failed to create share link' });
  }
});

/**
 * GET /api/pages/:pageId/share
 *
 * List active (non-revoked, non-expired) share links for a page. Requires
 * editor+ on the page's workspace — same authority as creating one, since
 * the token itself is sensitive.
 */
router.get('/pages/:pageId/share', authenticateToken, async (req: Request, res: Response) => {
  try {
    const auth = await authorizePageForShareManagement(req, res, req.params.pageId);
    if (!auth) return;
    const { page } = auth;

    const links = await listActiveShareLinksByPage(getDb(), page.id, new Date());

    res.json({
      shareLinks: links.map((l) => ({
        id: l.id,
        token: l.token,
        url: shareLinkPublicUrl(l.token),
        scope: l.scope,
        createdBy: l.createdBy,
        expiresAt: l.expiresAt,
        createdAt: l.createdAt,
      })),
    });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to list share links');
    res.status(500).json({ error: 'Failed to list share links' });
  }
});

/**
 * DELETE /api/share-links/:id
 *
 * Revoke a share link. Allowed for: the link creator, or any admin+
 * member of the workspace that owns the linked page.
 */
router.delete('/share-links/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const id = paramString(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Invalid share link id' });
      return;
    }

    const db = getDb();
    const link = await findShareLinkById(db, id);
    if (!link) {
      res.status(404).json({ error: 'Share link not found' });
      return;
    }

    if (link.revokedAt) {
      res.json({ success: true, alreadyRevoked: true });
      return;
    }

    const isCreator = link.createdBy === req.user.id;
    let hasFullAccess = false;
    if (!isCreator) {
      const page = await findPageById(db, link.pageId);
      if (!page) {
        // Page already gone; allow workspace-less revoke only by creator.
        res.status(404).json({ error: 'Linked page not found' });
        return;
      }
      const access = await resolvePageAccess(db, req.user.id, page.id);
      hasFullAccess = !!access && hasRole(access.role, 'admin');
    }

    if (!isCreator && !hasFullAccess) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // `revokeShareLink` only stamps a link that is not already revoked, so a
    // null here means someone revoked it between the read above and now. That
    // is the same answer the early return gives, not an error. The access the
    // link handed out goes with it.
    const revoked = await db.transaction(async (tx) => {
      const stamped = await revokeShareLink(tx, link.id, new Date());
      await deleteGrantsFromShareLink(tx, link.id);
      return stamped;
    });
    res.json({
      success: true,
      revokedAt: revoked?.revokedAt ?? link.revokedAt,
      alreadyRevoked: !revoked,
    });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to revoke share link');
    res.status(500).json({ error: 'Failed to revoke share link' });
  }
});

/**
 * The page a share link opens, or why it opens nothing: 404 for a link that
 * never was, 410 for one revoked or expired (the reader is told it is gone,
 * so they ask for a new one instead of doubting the URL).
 */
async function findSharedPage(
  token: string | null,
): Promise<
  | { link: NonNullable<Awaited<ReturnType<typeof findShareLinkByToken>>>; page: PageRow }
  | { status: 404 | 410; error: string }
> {
  if (!token || token.length < 8 || token.length > 128) {
    return { status: 404, error: 'Share link not found' };
  }
  const db = getDb();
  const link = await findShareLinkByToken(db, token);
  if (!link) return { status: 404, error: 'Share link not found' };
  if (link.revokedAt) return { status: 410, error: 'Share link has been revoked' };
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
    return { status: 410, error: 'Share link has expired' };
  }
  const page = await findPageById(db, link.pageId);
  if (!page || page.archived) return { status: 404, error: 'Shared page is no longer available' };
  return { link, page };
}

/**
 * GET /api/share/:token
 *
 * Public, unauthenticated read of a shared page. Returns the page metadata
 * and its non-archived blocks. 404 on revoked, expired, or missing tokens.
 */
router.get(
  '/share/:token',
  rateLimit('share-read', { max: 240, windowMs: 60_000 }),
  async (req: Request, res: Response) => {
    try {
      const shared = await findSharedPage(paramString(req.params.token));
      if ('error' in shared) {
        res.status(shared.status).json({ error: shared.error });
        return;
      }
      const { link, page } = shared;
      const db = getDb();

      // Ordering lives in the repository (`...ByOrder`) rather than in a chained
      // `.sort()` here, so every reader of a page's blocks gets the same order.
      const blocks = await listBlocksForPageByOrder(db, page.id);
      // A synced block shows its original only when the original is on this
      // page: the link opens this page and nothing else.
      const synced = await resolveSyncedBlocks(db, blocks, async (id) => id === page.id);

      res.json({
        page: {
          id: page.id,
          title: page.title,
          icon: page.icon,
          cover: page.cover,
          parentId: page.parentId,
          createdAt: page.createdAt,
          updatedAt: page.updatedAt,
        },
        blocks: blocks.map((b) => ({
          id: b.id,
          pageId: String(b.pageId),
          parentBlockId: b.parentBlockId ? String(b.parentBlockId) : null,
          type: b.type,
          content: b.content,
          order: b.order,
        })),
        synced: Object.fromEntries(synced),
        share: {
          scope: link.scope,
          expiresAt: link.expiresAt,
        },
      });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to resolve share link');
      res.status(500).json({ error: 'Failed to load shared page' });
    }
  },
);

/** POST /share/:token/files/urls { ids } — URLs for the files of a shared page. */
router.post(
  '/share/:token/files/urls',
  rateLimit('share-read', { max: 240, windowMs: 60_000 }),
  async (req: Request, res: Response) => {
    try {
      const shared = await findSharedPage(paramString(req.params.token));
      if ('error' in shared) {
        res.status(shared.status).json({ error: shared.error });
        return;
      }
      await respondWithFileUrls(req, res, shared.page);
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to read shared file URLs');
      res.status(500).json({ error: 'Failed to load files' });
    }
  },
);

/** The role opening a link of each scope gives a signed-in person. */
const ROLE_FOR_SCOPE: Record<ShareLinkScope, PageGrantRole> = {
  read: 'viewer',
  comment: 'commenter',
  edit: 'editor',
};

/**
 * POST /api/share/:token/join
 *
 * A signed-in person opening a link: they get the link's scope on the page
 * (read → viewer, comment → commenter, edit → editor) as a grant tied to the
 * link, which revoking the link takes away. Someone who already has as much
 * access is left as they are. Answers with the page and the caller's role.
 */
router.post(
  '/share/:token/join',
  rateLimit('share-join', { max: 30, windowMs: 60_000 }),
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const token = paramString(req.params.token);
      const db = getDb();
      const link = token ? await findShareLinkByToken(db, token) : undefined;
      if (!link) {
        res.status(404).json({ error: 'Share link not found' });
        return;
      }
      if (link.revokedAt) {
        res.status(410).json({ error: 'Share link has been revoked' });
        return;
      }
      if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
        res.status(410).json({ error: 'Share link has expired' });
        return;
      }
      const page = await findPageById(db, link.pageId);
      if (!page || page.archived) {
        res.status(404).json({ error: 'Shared page is no longer available' });
        return;
      }

      const role = ROLE_FOR_SCOPE[link.scope];
      const access = await resolvePageAccess(db, userId, page.id);
      if (!access || !hasRole(access.role, role)) {
        const existing = await findGrant(db, page.id, userId);
        // A grant made by hand stays one (a weaker one is raised); otherwise the
        // grant belongs to the link.
        await upsertGrant(db, {
          pageId: page.id,
          userId,
          role,
          grantedBy: link.createdBy,
          shareLinkId: existing && existing.shareLinkId === null ? null : link.id,
        });
      }
      const after = await resolvePageAccess(db, userId, page.id);
      res.json({ pageId: page.id, workspaceId: page.workspaceId, role: after?.role ?? role });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to join through share link');
      res.status(500).json({ error: 'Failed to open shared page' });
    }
  },
);

export default router;
