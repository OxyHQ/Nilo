/**
 * A database's automations (`lib/databases/automations.ts` runs them): list,
 * create, change and delete. They act with their creator's access and may send
 * data to a webhook, so managing them takes full access to the database.
 */
import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import {
  type AutomationAction,
  type AutomationTrigger,
  automationInputSchema,
  automationPatchSchema,
  isSafeUrl,
  MAX_AUTOMATIONS_PER_DATABASE,
} from '@oxy.so/nilo-contracts';
import { and, asc, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { databaseAutomations } from '../db/schema/automations.js';
import type { DatabaseSchema } from '../db/schema/databases.js';
import { serializeAutomation } from '../lib/databases/automations.js';
import { parseRowProperties } from '../lib/databases/row-writes.js';
import { log } from '../lib/logger.js';
import { checkDatabaseAccess } from '../lib/page-access.js';
import { authenticateToken } from '../middleware/auth.js';
import { findDatabaseById } from '../repositories/databases.js';

/**
 * What the schemas validate, as the contract's own types: zod infers an
 * action's required `to` as optional, so the boundary says what it checked.
 */
interface AutomationBody {
  name: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
}

const router = Router();
const entityIdSchema = z.string().refine(isLiveEntityId, 'Invalid id');

/** What is wrong with an automation against its database, or null. */
async function refusal(
  schema: DatabaseSchema,
  workspaceId: string,
  trigger: AutomationTrigger | undefined,
  actions: AutomationAction[] | undefined,
): Promise<string | null> {
  const property = (id: string) => schema.properties.find((p) => p.id === id);
  if (trigger?.kind === 'property_edited') {
    const watched = property(trigger.propertyId);
    if (!watched) return 'The property to watch is not in this database';
    // Computed values are never edited: nothing would ever fire it.
    if (
      [
        'formula',
        'rollup',
        'created_time',
        'last_edited_time',
        'created_by',
        'last_edited_by',
        'unique_id',
        'button',
        'verification',
      ].includes(watched.type)
    ) {
      return `A ${watched.type} property is not edited by anyone, so it cannot start an automation`;
    }
  }
  for (const action of actions ?? []) {
    if (action.kind === 'set_property') {
      try {
        const parsed = parseRowProperties(schema, { [action.propertyId]: action.value });
        if ('refusal' in parsed) return parsed.refusal.error;
      } catch {
        return 'The value does not fit the property it sets';
      }
    } else if (action.kind === 'notify' && action.to.kind === 'property') {
      if (property(action.to.propertyId)?.type !== 'person') {
        return 'Notify takes a person property of this database';
      }
    } else if (action.kind === 'webhook') {
      if (!isSafeUrl(action.url)) return 'A webhook needs a public https address';
    } else if (action.kind === 'create_row' && action.databaseId) {
      const target = await findDatabaseById(getDb(), action.databaseId);
      if (!target || target.workspaceId !== workspaceId) {
        return 'The database to add a page to is not in this workspace';
      }
    }
  }
  return null;
}

function badInput(error: unknown, res: Response): boolean {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: error.issues });
    return true;
  }
  return false;
}

/** GET /databases/:id/automations — viewers may see what runs, not its secrets. */
router.get('/databases/:id/automations', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: entityIdSchema }).parse(req.params);
    const db = getDb();
    const database = await findDatabaseById(db, id);
    if (!database) {
      res.status(404).json({ error: 'Database not found' });
      return;
    }
    if (!(await checkDatabaseAccess(req, res, db, database, 'viewer'))) return;
    const rows = await db
      .select()
      .from(databaseAutomations)
      .where(eq(databaseAutomations.databaseId, id))
      .orderBy(asc(databaseAutomations.createdAt));
    res.json({ automations: rows.map(serializeAutomation) });
  } catch (error: unknown) {
    if (badInput(error, res)) return;
    log.general.error({ err: error }, 'Failed to list automations');
    res.status(500).json({ error: 'Failed to list automations' });
  }
});

/** POST /databases/:id/automations { name, trigger, actions, enabled? } — answers with the webhook `secret`, once. */
router.post(
  '/databases/:id/automations',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { id } = z.object({ id: entityIdSchema }).parse(req.params);
      const body = automationInputSchema.parse(req.body) as AutomationBody;
      const db = getDb();
      const database = await findDatabaseById(db, id);
      if (!database) {
        res.status(404).json({ error: 'Database not found' });
        return;
      }
      if (!(await checkDatabaseAccess(req, res, db, database, 'admin'))) return;
      const problem = await refusal(
        database.propertiesSchema,
        database.workspaceId,
        body.trigger,
        body.actions,
      );
      if (problem) {
        res.status(400).json({ error: problem, code: 'INVALID_AUTOMATION' });
        return;
      }
      const [{ total } = { total: 0 }] = await db
        .select({ total: count() })
        .from(databaseAutomations)
        .where(eq(databaseAutomations.databaseId, id));
      if (total >= MAX_AUTOMATIONS_PER_DATABASE) {
        res.status(409).json({
          error: 'This database has as many automations as it may',
          code: 'TOO_MANY_AUTOMATIONS',
        });
        return;
      }
      const secret = randomBytes(24).toString('hex');
      const [created] = await db
        .insert(databaseAutomations)
        .values({
          databaseId: id,
          name: body.name,
          enabled: body.enabled ?? true,
          trigger: body.trigger,
          actions: body.actions,
          createdBy: req.user?.id as string,
          secret,
        })
        .returning();
      res.status(201).json({ automation: serializeAutomation(created), secret });
    } catch (error: unknown) {
      if (badInput(error, res)) return;
      log.general.error({ err: error }, 'Failed to create an automation');
      res.status(500).json({ error: 'Failed to create an automation' });
    }
  },
);

/**
 * PATCH /databases/:id/automations/:automationId — change any of name, enabled,
 * trigger and actions. Whoever changes what it does becomes whose access it
 * runs with, so switching one on or editing it takes it over.
 */
router.patch(
  '/databases/:id/automations/:automationId',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { id, automationId } = z
        .object({ id: entityIdSchema, automationId: entityIdSchema })
        .parse(req.params);
      const body = automationPatchSchema.parse(req.body) as Partial<AutomationBody>;
      const db = getDb();
      const database = await findDatabaseById(db, id);
      if (!database) {
        res.status(404).json({ error: 'Database not found' });
        return;
      }
      if (!(await checkDatabaseAccess(req, res, db, database, 'admin'))) return;
      const [current] = await db
        .select()
        .from(databaseAutomations)
        .where(
          and(eq(databaseAutomations.id, automationId), eq(databaseAutomations.databaseId, id)),
        );
      if (!current) {
        res.status(404).json({ error: 'Automation not found' });
        return;
      }
      const problem = await refusal(
        database.propertiesSchema,
        database.workspaceId,
        body.trigger,
        body.actions,
      );
      if (problem) {
        res.status(400).json({ error: problem, code: 'INVALID_AUTOMATION' });
        return;
      }
      const takesOver =
        body.trigger !== undefined || body.actions !== undefined || body.enabled === true;
      const [updated] = await db
        .update(databaseAutomations)
        .set({
          ...(body.name !== undefined && { name: body.name }),
          ...(body.enabled !== undefined && { enabled: body.enabled }),
          ...(body.trigger !== undefined && { trigger: body.trigger }),
          ...(body.actions !== undefined && { actions: body.actions }),
          ...(takesOver && { createdBy: req.user?.id as string }),
          // Switched back on, it starts without the failure that stopped it.
          ...(body.enabled === true && { lastStatus: null, lastError: null }),
        })
        .where(eq(databaseAutomations.id, automationId))
        .returning();
      res.json({ automation: serializeAutomation(updated as typeof current) });
    } catch (error: unknown) {
      if (badInput(error, res)) return;
      log.general.error({ err: error }, 'Failed to change an automation');
      res.status(500).json({ error: 'Failed to change an automation' });
    }
  },
);

/** DELETE /databases/:id/automations/:automationId */
router.delete(
  '/databases/:id/automations/:automationId',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { id, automationId } = z
        .object({ id: entityIdSchema, automationId: entityIdSchema })
        .parse(req.params);
      const db = getDb();
      const database = await findDatabaseById(db, id);
      if (!database) {
        res.status(404).json({ error: 'Database not found' });
        return;
      }
      if (!(await checkDatabaseAccess(req, res, db, database, 'admin'))) return;
      const removed = await db
        .delete(databaseAutomations)
        .where(
          and(eq(databaseAutomations.id, automationId), eq(databaseAutomations.databaseId, id)),
        )
        .returning({ id: databaseAutomations.id });
      if (removed.length === 0) {
        res.status(404).json({ error: 'Automation not found' });
        return;
      }
      res.status(204).end();
    } catch (error: unknown) {
      if (badInput(error, res)) return;
      log.general.error({ err: error }, 'Failed to delete an automation');
      res.status(500).json({ error: 'Failed to delete an automation' });
    }
  },
);

export default router;
