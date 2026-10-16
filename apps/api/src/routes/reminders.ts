/**
 * A person's reminders: set one on a page (or a block of it), list theirs,
 * and delete one. Delivery is `lib/reminders.ts`.
 */
import { Router, type Request, type Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { and, asc, eq, gte, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { reminders } from '../db/schema/collab.js';
import { blocks, pages } from '../db/schema/pages.js';
import { touchSystemRow } from '../lib/databases/system.js';
import { log } from '../lib/logger.js';
import { checkPageAccess } from '../lib/page-access.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
const entityIdSchema = z.string().refine(isLiveEntityId, 'Invalid id');
/** Far enough for any plan; a bound against typos like year 20260. */
const MAX_AHEAD_MS = 5 * 366 * 24 * 60 * 60 * 1000;

const createSchema = z.object({
  remindAt: z.string().datetime({ offset: true }),
  blockId: entityIdSchema.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

function badInput(error: unknown, res: Response): boolean {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: error.errors });
    return true;
  }
  return false;
}

const serialize = (r: typeof reminders.$inferSelect) => ({
  id: r.id,
  pageId: r.pageId,
  blockId: r.blockId,
  remindAt: r.remindAt,
  note: r.note,
  sentAt: r.sentAt,
  createdAt: r.createdAt,
});

/** POST /pages/:id/reminders { remindAt, blockId?, note? } — for the caller, who must be able to open the page. */
router.post('/pages/:id/reminders', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: entityIdSchema }).parse(req.params);
    const body = createSchema.parse(req.body);
    const db = getDb();
    if (!(await checkPageAccess(req, res, db, id, 'viewer'))) return;
    const remindAt = new Date(body.remindAt);
    if (remindAt.getTime() - Date.now() > MAX_AHEAD_MS) {
      res.status(400).json({ error: 'A reminder can be at most five years ahead' });
      return;
    }
    if (body.blockId) {
      const [block] = await db
        .select({ pageId: blocks.pageId })
        .from(blocks)
        .where(eq(blocks.id, body.blockId));
      if (block?.pageId !== id) {
        res.status(400).json({ error: 'That block is not on this page' });
        return;
      }
    }
    // A time already past is simply due: the next sweep delivers it.
    const [row] = await db
      .insert(reminders)
      .values({
        userId: req.user?.id as string,
        pageId: id,
        blockId: body.blockId ?? null,
        remindAt,
        note: body.note ?? null,
      })
      .returning();
    await touchSystemRow(db, id);
    res.status(201).json({ reminder: serialize(row as typeof reminders.$inferSelect) });
  } catch (error: unknown) {
    if (badInput(error, res)) return;
    log.general.error({ err: error }, 'Failed to set a reminder');
    res.status(500).json({ error: 'Failed to set a reminder' });
  }
});

/** GET /reminders — the caller's pending reminders, soonest first, with their pages' titles. */
router.get('/reminders', authenticateToken, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = await db
      .select({ reminder: reminders, title: pages.title, icon: pages.icon })
      .from(reminders)
      .innerJoin(pages, eq(pages.id, reminders.pageId))
      .where(and(eq(reminders.userId, req.user?.id as string), isNull(reminders.sentAt)))
      .orderBy(asc(reminders.remindAt));
    res.json({
      reminders: rows.map((r) => ({
        ...serialize(r.reminder),
        page: { id: r.reminder.pageId, title: r.title, icon: r.icon },
      })),
    });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to list reminders');
    res.status(500).json({ error: 'Failed to list reminders' });
  }
});

/** GET /pages/:id/reminders — the caller's reminders on one page (pending and upcoming). */
router.get('/pages/:id/reminders', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: entityIdSchema }).parse(req.params);
    const db = getDb();
    if (!(await checkPageAccess(req, res, db, id, 'viewer'))) return;
    const rows = await db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, req.user?.id as string),
          eq(reminders.pageId, id),
          gte(reminders.remindAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
        ),
      )
      .orderBy(asc(reminders.remindAt));
    res.json({ reminders: rows.map(serialize) });
  } catch (error: unknown) {
    if (badInput(error, res)) return;
    log.general.error({ err: error }, 'Failed to list page reminders');
    res.status(500).json({ error: 'Failed to list page reminders' });
  }
});

/** DELETE /reminders/:id — one's own. */
router.delete('/reminders/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: entityIdSchema }).parse(req.params);
    const db = getDb();
    const deleted = await db
      .delete(reminders)
      .where(and(eq(reminders.id, id), eq(reminders.userId, req.user?.id as string)))
      .returning({ id: reminders.id, pageId: reminders.pageId });
    if (deleted.length === 0) {
      res.status(404).json({ error: 'Reminder not found' });
      return;
    }
    await touchSystemRow(db, deleted[0]?.pageId as string);
    res.json({ success: true });
  } catch (error: unknown) {
    if (badInput(error, res)) return;
    log.general.error({ err: error }, 'Failed to delete a reminder');
    res.status(500).json({ error: 'Failed to delete a reminder' });
  }
});

export default router;
