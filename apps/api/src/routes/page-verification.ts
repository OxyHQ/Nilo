/**
 * Verifying a page: a row of a database with a `verification` property says
 * who stands behind it, and until when. The property is written only here, so
 * `verifiedBy` and `verifiedAt` are the caller and now, never what a client
 * sent (`parseRowProperties` refuses a direct write). The expiry sweep
 * (`lib/verifications.ts`) tells whoever verified a page when it expires.
 */
import { Router, type Request, type Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { VERIFICATION_EXPIRY_DAYS, type VerificationValue } from '@oxy.so/nilo-contracts';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { pageVerifications } from '../db/schema/collab.js';
import { rowWritten } from '../lib/databases/row-writes.js';
import { log } from '../lib/logger.js';
import { checkPageAccess } from '../lib/page-access.js';
import { authenticateToken } from '../middleware/auth.js';
import { findDatabaseById } from '../repositories/databases.js';
import { findPageById, updatePage } from '../repositories/pages.js';

const router = Router();
const entityIdSchema = z.string().refine(isLiveEntityId, 'Invalid id');
const DAY_MS = 24 * 60 * 60 * 1000;

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('verify'),
    propertyId: z.string().min(1).max(200),
    /** 7, 30 or 90 days; null (or absent) is until someone removes it. */
    expiresInDays: z
      .union([
        z.literal(VERIFICATION_EXPIRY_DAYS[0]),
        z.literal(VERIFICATION_EXPIRY_DAYS[1]),
        z.literal(VERIFICATION_EXPIRY_DAYS[2]),
      ])
      .nullable()
      .optional(),
  }),
  z.object({ action: z.literal('unverify'), propertyId: z.string().min(1).max(200) }),
]);

/** POST /pages/:id/verification { action: 'verify' | 'unverify', propertyId, expiresInDays? } */
router.post('/pages/:id/verification', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: entityIdSchema }).parse(req.params);
    const body = bodySchema.parse(req.body);
    const db = getDb();
    const page = await findPageById(db, id);
    if (!page || page.archived) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    if (!(await checkPageAccess(req, res, db, page.id, 'editor'))) return;
    const userId = req.user?.id as string;

    const database = page.databaseId ? await findDatabaseById(db, page.databaseId) : null;
    const property = database?.propertiesSchema.properties.find((p) => p.id === body.propertyId);
    if (!database || property?.type !== 'verification') {
      res.status(400).json({
        error: 'The page has no such verification property',
        code: 'NOT_A_VERIFICATION',
      });
      return;
    }

    const now = new Date();
    const days =
      body.action === 'verify'
        ? (body.expiresInDays ?? property.config?.defaultExpiryDays ?? null)
        : null;
    const expiresAt = days === null ? null : new Date(now.getTime() + days * DAY_MS);
    const value: VerificationValue =
      body.action === 'verify'
        ? {
            state: 'verified',
            verifiedBy: userId,
            verifiedAt: now.toISOString(),
            expiresAt: expiresAt?.toISOString() ?? null,
          }
        : { state: 'unverified', verifiedBy: null, verifiedAt: null, expiresAt: null };

    const updated = await db.transaction(async (tx) => {
      const written = await updatePage(tx, page.id, {
        mergeProperties: { [body.propertyId]: value },
        lastEditedBy: userId,
      });
      // The sweep's copy of the expiry: one per verified page that expires.
      if (written) {
        if (body.action === 'verify' && expiresAt) {
          await tx
            .insert(pageVerifications)
            .values({ pageId: page.id, propertyId: body.propertyId, verifiedBy: userId, expiresAt })
            .onConflictDoUpdate({
              target: [pageVerifications.pageId, pageVerifications.propertyId],
              set: { verifiedBy: userId, expiresAt, notifiedAt: null },
            });
        } else {
          await tx
            .delete(pageVerifications)
            .where(
              and(
                eq(pageVerifications.pageId, page.id),
                eq(pageVerifications.propertyId, body.propertyId),
              ),
            );
        }
      }
      return written;
    });
    if (!updated) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    rowWritten({
      database,
      row: updated,
      before: page.properties,
      actorId: userId,
      propertiesChanged: true,
      workspace: true,
    });
    res.json({ propertyId: body.propertyId, verification: value });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.issues });
      return;
    }
    log.general.error({ err: error }, 'Failed to set a page verification');
    res.status(500).json({ error: 'Failed to set a page verification' });
  }
});

export default router;
