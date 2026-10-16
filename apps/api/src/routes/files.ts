/**
 * Attachments of a page, stored in Oxy's file manager (`@oxy.so/nilo-contracts`
 * `files.ts`). The member's app uploads the file to Oxy under their own
 * session and links it to Nilo; it then records it here, on the page it went
 * into. Readers ask for URLs by file id, here or through a share link or a
 * published page (`share-links.ts`, `publish.ts`), all answered by
 * `respondWithFileUrls`.
 */
import { MAX_FILE_BYTES, MAX_FILE_URL_IDS } from '@oxy.so/nilo-contracts';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { mintFileUrls, toFileUrls } from '../lib/files.js';
import { log } from '../lib/logger.js';
import { checkPageAccess } from '../lib/page-access.js';
import { authenticateToken } from '../middleware/auth.js';
import { recordPageFile, servableFileIds } from '../repositories/pageFiles.js';
import { findPageById } from '../repositories/pages.js';

const router = Router();

const fileIdSchema = z.string().trim().min(1).max(64);
const recordSchema = z.object({ fileId: fileIdSchema, name: z.string().trim().min(1).max(255) });
export const fileUrlsSchema = z.object({
  ids: z.array(fileIdSchema).min(1).max(MAX_FILE_URL_IDS),
});

/**
 * Answer a reader of `page` with URLs for the requested files it may show
 * (`servableFileIds`); the others are left out, as Oxy leaves out files it
 * will not serve, so an id's absence says nothing about whether it exists.
 */
export async function respondWithFileUrls(
  req: Request,
  res: Response,
  page: { id: string; workspaceId: string },
): Promise<void> {
  const parsed = fileUrlsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid file ids' });
    return;
  }
  try {
    const ids = [...new Set(parsed.data.ids)];
    const servable = await servableFileIds(getDb(), page, ids);
    const minted = await mintFileUrls(servable);
    // Each URL is a credential for a few minutes: nothing may keep it.
    res.setHeader('Cache-Control', 'no-store');
    res.json({ files: toFileUrls(servable, minted) });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to mint file URLs');
    res.status(503).json({ error: 'Files are unavailable right now' });
  }
}

/**
 * POST /pages/:pageId/files { fileId, name } — record a file the caller has
 * just uploaded to Oxy and linked to Nilo as an attachment of the page.
 * Answers with what Oxy measured and a first URL, so the uploader sees it at
 * once.
 */
router.post('/pages/:pageId/files', authenticateToken, async (req: Request, res: Response) => {
  try {
    const body = recordSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'A file id and a name are required' });
      return;
    }
    const db = getDb();
    const page = await findPageById(db, String(req.params.pageId));
    if (!page || page.archived) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    const access = await checkPageAccess(req, res, db, page.id, 'editor');
    if (!access) return;

    const { fileId, name } = body.data;
    const minted = (await mintFileUrls([fileId])).get(fileId);
    if (!minted) {
      // Not linked to Nilo by its owner (or no such file): Oxy will never serve it.
      res.status(422).json({ error: 'This file is not attached to Nilo' });
      return;
    }
    if (minted.size > MAX_FILE_BYTES) {
      res.status(413).json({ error: 'This file is too large' });
      return;
    }
    const row = await recordPageFile(db, {
      fileId,
      workspaceId: page.workspaceId,
      pageId: page.id,
      uploadedBy: String(req.user?.id),
      name,
      mime: minted.mime,
      size: minted.size,
    });
    if (row.workspaceId !== page.workspaceId) {
      res.status(409).json({ error: 'This file belongs to another workspace' });
      return;
    }
    const [url] = toFileUrls([fileId], new Map([[fileId, minted]]));
    res.status(201).json({
      fileId,
      name: row.name,
      mime: row.mime,
      size: row.size,
      url: url?.url,
      expiresIn: url?.expiresIn,
    });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to record a page file');
    res.status(503).json({ error: 'Files are unavailable right now' });
  }
});

/** POST /pages/:pageId/files/urls { ids } — URLs for a page's files, for a reader of it. */
router.post('/pages/:pageId/files/urls', authenticateToken, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const page = await findPageById(db, String(req.params.pageId));
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    if (!(await checkPageAccess(req, res, db, page.id, 'viewer'))) return;
    await respondWithFileUrls(req, res, page);
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to read page file URLs');
    res.status(500).json({ error: 'Failed to load files' });
  }
});

export default router;
