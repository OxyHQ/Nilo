/**
 * Database forms. A form view's link lets anyone (or, with `requireSignIn`,
 * anyone signed in) answer the form; each response becomes a row of the
 * database. Editors of the database manage the link; the public endpoints
 * see only the form's fields, never the rows.
 */
import crypto from 'node:crypto';
import { type NextFunction, type Request, type Response, Router } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import {
  type DatabaseProperty,
  type DatabasePropertyType,
  databaseForms,
  databaseViews,
} from '../db/schema/databases.js';
import { normalizeIncomingProperties } from '../lib/databases/create.js';
import { NAME_PROPERTY_ID } from '../lib/databases/schema-defaults.js';
import { log } from '../lib/logger.js';
import { checkDatabaseAccess } from '../lib/page-access.js';
import { rateLimit } from '../lib/rate-limit.js';
import { authenticateToken } from '../middleware/auth.js';
import { findDatabaseById } from '../repositories/databases.js';
import { createRow } from '../lib/databases/rows.js';
import { nextDatabaseRowOrder } from '../repositories/pages.js';

const router = Router();
const entityIdSchema = z.string().refine(isLiveEntityId, 'Invalid id');
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/** The property types a form can ask for; the rest are computed or need context. */
const FORM_TYPES = new Set<DatabasePropertyType>([
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'checkbox',
  'url',
  'email',
  'phone',
]);

function badInput(error: unknown, res: Response): boolean {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: error.errors });
    return true;
  }
  return false;
}

const serializeForm = (form: typeof databaseForms.$inferSelect) => ({
  id: form.id,
  viewId: form.viewId,
  token: form.token,
  open: form.open,
  requireSignIn: form.requireSignIn,
});

/** The database and form view of a management request, with edit access checked. */
async function loadView(req: Request, res: Response) {
  const { id, viewId } = z.object({ id: entityIdSchema, viewId: entityIdSchema }).parse(req.params);
  const db = getDb();
  const database = await findDatabaseById(db, id);
  if (!database) {
    res.status(404).json({ error: 'Database not found' });
    return null;
  }
  if (!(await checkDatabaseAccess(req, res, db, database, 'editor'))) return null;
  const [view] = await db
    .select()
    .from(databaseViews)
    .where(and(eq(databaseViews.id, viewId), eq(databaseViews.databaseId, database.id)));
  if (!view) {
    res.status(404).json({ error: 'View not found' });
    return null;
  }
  if (view.type !== 'form') {
    res.status(400).json({ error: 'Only a form view has a form link' });
    return null;
  }
  return { db, database, view };
}

/** GET /databases/:id/views/:viewId/form — the form's link, or null. */
router.get(
  '/databases/:id/views/:viewId/form',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const loaded = await loadView(req, res);
      if (!loaded) return;
      const [form] = await loaded.db
        .select()
        .from(databaseForms)
        .where(eq(databaseForms.viewId, loaded.view.id));
      res.json({ form: form ? serializeForm(form) : null });
    } catch (error: unknown) {
      if (badInput(error, res)) return;
      log.general.error({ err: error }, 'Failed to read a form');
      res.status(500).json({ error: 'Failed to read the form' });
    }
  },
);

/** PUT /databases/:id/views/:viewId/form { open?, requireSignIn? } — create or change the link. */
router.put(
  '/databases/:id/views/:viewId/form',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const body = z
        .object({ open: z.boolean().optional(), requireSignIn: z.boolean().optional() })
        .parse(req.body ?? {});
      const loaded = await loadView(req, res);
      if (!loaded) return;
      const [form] = await loaded.db
        .insert(databaseForms)
        .values({
          viewId: loaded.view.id,
          databaseId: loaded.database.id,
          token: crypto.randomBytes(24).toString('base64url'),
          open: body.open ?? true,
          requireSignIn: body.requireSignIn ?? false,
          createdBy: req.user?.id as string,
        })
        .onConflictDoUpdate({
          target: databaseForms.viewId,
          set: {
            updatedAt: new Date(),
            ...(body.open !== undefined && { open: body.open }),
            ...(body.requireSignIn !== undefined && { requireSignIn: body.requireSignIn }),
          },
        })
        .returning();
      res.json({ form: serializeForm(form as typeof databaseForms.$inferSelect) });
    } catch (error: unknown) {
      if (badInput(error, res)) return;
      log.general.error({ err: error }, 'Failed to save a form');
      res.status(500).json({ error: 'Failed to save the form' });
    }
  },
);

/** DELETE /databases/:id/views/:viewId/form — the link stops working (a new one gets a new token). */
router.delete(
  '/databases/:id/views/:viewId/form',
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const loaded = await loadView(req, res);
      if (!loaded) return;
      await loaded.db.delete(databaseForms).where(eq(databaseForms.viewId, loaded.view.id));
      res.json({ success: true });
    } catch (error: unknown) {
      if (badInput(error, res)) return;
      log.general.error({ err: error }, 'Failed to delete a form');
      res.status(500).json({ error: 'Failed to delete the form' });
    }
  },
);

/** Signed-in when a token is sent, anonymous otherwise. */
function optionalAuth(req: Request, res: Response, next: NextFunction) {
  if (req.headers.authorization) return authenticateToken(req, res, next);
  next();
}

/** The open form behind a public token, with its database and the fields it asks for. */
async function loadPublicForm(req: Request, res: Response) {
  const parsed = tokenSchema.safeParse(req.params.token);
  const db = getDb();
  const [form] = parsed.success
    ? await db.select().from(databaseForms).where(eq(databaseForms.token, parsed.data))
    : [];
  if (!form || !form.open) {
    res.status(404).json({ error: 'This form is not accepting responses' });
    return null;
  }
  if (form.requireSignIn && !req.user?.id) {
    res.status(401).json({ error: 'Sign in to answer this form', code: 'SIGN_IN_REQUIRED' });
    return null;
  }
  const [view] = await db.select().from(databaseViews).where(eq(databaseViews.id, form.viewId));
  const database = await findDatabaseById(db, form.databaseId);
  if (!view || !database || database.archived) {
    res.status(404).json({ error: 'This form is not accepting responses' });
    return null;
  }
  const hidden = new Set(view.hiddenProperties);
  const fields = database.propertiesSchema.properties.filter(
    (p) => FORM_TYPES.has(p.type) && !hidden.has(p.id),
  );
  return { db, form, view, database, fields };
}

const describeField = (property: DatabaseProperty) => ({
  id: property.id,
  name: property.name,
  type: property.type,
  required: property.id === NAME_PROPERTY_ID,
  ...(property.config?.options && {
    options: property.config.options.map((o) => ({ id: o.id, name: o.name })),
  }),
});

/** GET /forms/:token — the form: its title, description and fields. */
router.get(
  '/forms/:token',
  rateLimit({ name: 'form-read', limit: 120, windowMs: 60_000 }),
  optionalAuth,
  async (req: Request, res: Response) => {
    try {
      const loaded = await loadPublicForm(req, res);
      if (!loaded) return;
      const description = (loaded.view.config as { description?: unknown }).description;
      res.json({
        title: loaded.view.name || loaded.database.name,
        description: typeof description === 'string' ? description : '',
        requireSignIn: loaded.form.requireSignIn,
        fields: loaded.fields.map(describeField),
      });
    } catch (error: unknown) {
      log.general.error({ err: error }, 'Failed to read a public form');
      res.status(500).json({ error: 'Failed to load the form' });
    }
  },
);

/** POST /forms/:token { values: { [propertyId]: value } } — a response, as a new row. */
router.post(
  '/forms/:token',
  rateLimit({
    name: 'form-submit',
    limit: 10,
    windowMs: 60_000,
    scope: (req) => String(req.params.token),
  }),
  optionalAuth,
  async (req: Request, res: Response) => {
    try {
      const body = z.object({ values: z.record(z.unknown()) }).parse(req.body);
      const loaded = await loadPublicForm(req, res);
      if (!loaded) return;
      const allowed = new Set(loaded.fields.map((f) => f.id));
      const offered = Object.fromEntries(
        Object.entries(body.values).filter(([key]) => allowed.has(key)),
      );
      // Only the form's fields, validated as any row value is.
      const { stored, nameFromProperty } = normalizeIncomingProperties(
        loaded.database.propertiesSchema,
        offered,
      );
      const title = (nameFromProperty ?? '').trim();
      if (allowed.has(NAME_PROPERTY_ID) && !title) {
        res.status(400).json({ error: 'The first field is required', field: NAME_PROPERTY_ID });
        return;
      }
      await createRow(loaded.db, loaded.database, {
        workspaceId: loaded.database.workspaceId,
        parentId: null,
        title,
        // Anonymous responses are owned by the form itself.
        ownerId: req.user?.id ?? `form:${loaded.form.id}`,
        order: await nextDatabaseRowOrder(loaded.db, loaded.database.id),
        properties: stored,
      });
      res.status(201).json({ ok: true });
    } catch (error: unknown) {
      if (badInput(error, res)) return;
      log.general.error({ err: error }, 'Failed to submit a form');
      res.status(500).json({ error: 'Failed to submit the form' });
    }
  },
);

export default router;
