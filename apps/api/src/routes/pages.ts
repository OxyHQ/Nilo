import { Router } from 'express';
import type { Request, Response } from 'express';
import { isLiveEntityId } from '@oxy.so/db';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import type { PageRow } from '../repositories/pages.js';
import {
  createPage,
  deletePageTree,
  findPageAncestry,
  findPageById,
  findPagesByIds,
  listPages,
  nextSiblingOrder,
  updatePage,
} from '../repositories/pages.js';
import { listBlocksForPage } from '../repositories/blocks.js';
import { blocksToHtml, blocksToMarkdown, blocksToTree } from '@nilo/contracts';
import { copyPageTree } from '../repositories/pageCopies.js';
import { follow } from '../repositories/pageFollows.js';
import { findDatabaseById } from '../repositories/databases.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireWorkspaceMember } from '../middleware/workspace.js';
import { log } from '../lib/logger.js';
import { checkWorkspaceAccess } from '../lib/workspace-access.js';
import {
  accessibleAncestry,
  checkPageAccess,
  databaseHosts,
  rolesForPages,
} from '../lib/page-access.js';
import { hasRole } from '../db/schema/workspaces.js';
import {
  listGrantsOfUser,
  listGrantsOfUserInWorkspace,
  listGrantsOnPages,
  upsertGrant,
} from '../repositories/pagePermissions.js';
import { findLiveWorkspaceById, listMembershipsForUser } from '../repositories/workspaces.js';
import { parsePropertyValue, serializeParsedValue } from '../lib/databases/property-values.js';
import { NAME_PROPERTY_ID } from '../lib/databases/schema-defaults.js';

const router = Router();

// All page routes require an authenticated Oxy user.
router.use(authenticateToken);

/**
 * Zod helper: an id this schema could have stored.
 *
 * `isLiveEntityId` accepts the two shapes a `generatedId()` primary key holds —
 * a uuid v7 for every row created after the cutover, and a 24-char ObjectId hex
 * for every row a backfill copies over verbatim. A 24-hex-only regex, which is
 * what this was, rejects every id the Postgres schema now mints.
 *
 * It is a 400 guard and nothing more: it never gates a lookup, because the
 * query already answers "no such row" for free, and a shape predicate used as a
 * precondition fails closed on a valid id it has not been taught about.
 * `workspaceId` goes through it too. Backfilled workspace ids retain their
 * ObjectId shape while rows created in PostgreSQL use uuid v7, so the predicate
 * spans both without guessing which storage generation produced the row.
 */
const entityIdSchema = z.string().refine(isLiveEntityId, 'Invalid id');

const listQuerySchema = z.object({
  workspaceId: entityIdSchema,
  parentId: z.union([entityIdSchema, z.literal('null'), z.literal('root')]).optional(),
  includeArchived: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
  archivedOnly: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
  favoritedOnly: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
  /** Templates are not part of the page tree: listed only on request. */
  templates: z.enum(['exclude', 'only', 'include']).default('exclude'),
});

const createPageSchema = z.object({
  workspaceId: entityIdSchema,
  parentId: entityIdSchema.nullable().optional(),
  title: z.string().max(2000).optional(),
  icon: z.string().max(200).nullable().optional(),
  cover: z.string().max(2000).nullable().optional(),
});

const updatePageSchema = z
  .object({
    title: z.string().max(2000).optional(),
    icon: z.string().max(200).nullable().optional(),
    cover: z.string().max(2000).nullable().optional(),
    coverPosition: z.number().min(0).max(100).optional(),
    parentId: entityIdSchema.nullable().optional(),
    order: z.number().finite().optional(),
    archived: z.boolean().optional(),
    favorited: z.boolean().optional(),
    /** Open only to the people it is shared with (see `lib/page-access.ts`). */
    restricted: z.boolean().optional(),
    /** Make it a template, or an ordinary page again. */
    template: z.boolean().optional(),
    // Database row property writes. Keys are propertyIds; shapes are
    // validated per-property type by `parsePropertyValue`.
    properties: z.record(z.unknown()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });

function handleZodError(err: unknown, res: Response): boolean {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: err.errors });
    return true;
  }
  return false;
}

function assertWorkspace(req: Request, res: Response): string | null {
  const workspaceId = req.workspace?.id;
  if (!workspaceId) {
    res.status(400).json({ error: 'Workspace context required' });
    return null;
  }
  return workspaceId;
}

/**
 * The wire shape of a page.
 *
 * `_id` is gone. It was a Mongo artefact that this serializer emitted BESIDE
 * `id`, holding the same value, and the storage layer that produced it no
 * longer exists — so it is deleted rather than carried forward as an alias.
 * Every consumer of it is listed in the rewiring PR; `apps/app` reads
 * `page._id` in twenty-odd files and has to move to `page.id`.
 *
 * Every column is already the right JavaScript type coming out of drizzle, so
 * there is nothing here to coerce: `String(...)` around each id was undoing
 * `ObjectId`, and `?? 50` / `?? false` were defending against a document
 * written before those fields had defaults. `coverPosition`, `favorited` and
 * `properties` are all `NOT NULL DEFAULT` in the schema.
 */
function serializePage(page: PageRow) {
  return {
    id: page.id,
    workspaceId: page.workspaceId,
    parentId: page.parentId,
    title: page.title,
    icon: page.icon,
    cover: page.cover,
    coverPosition: page.coverPosition,
    ownerId: page.ownerId,
    archived: page.archived,
    favorited: page.favorited,
    restricted: page.restricted,
    template: page.template,
    publishedAt: page.publishedAt,
    publishSlug: page.publishSlug,
    publishIndexing: page.publishIndexing,
    lastEditedBy: page.lastEditedBy,
    order: page.order,
    databaseId: page.databaseId,
    properties: page.properties,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

/**
 * GET /api/pages?workspaceId=...[&parentId=...][&includeArchived=false]
 *                              [&archivedOnly=true][&favoritedOnly=true]
 * Returns a flat list. Frontend builds the tree.
 *
 * - `archivedOnly=true`     — return only archived pages (trash view).
 * - `favoritedOnly=true`    — return only starred pages (sidebar favorites).
 * - `includeArchived=true`  — include archived pages alongside active ones.
 */
// `requireWorkspaceMember` resolves the workspace id from (in order) route
// param, ?workspaceId=..., or X-Workspace-Id header — so listing only needs
// the query string.
router.get('/', requireWorkspaceMember, async (req: Request, res: Response) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const workspaceId = assertWorkspace(req, res);
    if (!workspaceId) return;

    if (query.workspaceId !== workspaceId) {
      res.status(403).json({ error: 'Workspace mismatch' });
      return;
    }

    // `archived` is three-valued and the three cases are not symmetric:
    // absent means "archived and active together", which only
    // `?includeArchived=true` (without `?archivedOnly=true`) asks for.
    let archived: boolean | undefined;
    if (query.archivedOnly) {
      archived = true;
    } else if (!query.includeArchived) {
      archived = false;
    }

    const db = getDb();
    const pages = await listPages(db, {
      workspaceId,
      parentId:
        query.parentId === undefined
          ? undefined
          : query.parentId === 'null' || query.parentId === 'root'
            ? null
            : query.parentId,
      archived,
      favoritedOnly: query.favoritedOnly,
      template: query.templates === 'include' ? undefined : query.templates === 'only',
    });

    // Leave out the restricted pages this member has no grant reaching.
    // Owners and admins see everything; for everyone else the rule needs
    // each page's ancestry, so it runs over the whole workspace.
    const memberRole = req.workspace?.role ?? null;
    let visible = pages;
    if (!memberRole || !hasRole(memberRole, 'admin')) {
      const [all, grants, hosts] = await Promise.all([
        listPages(db, { workspaceId }),
        listGrantsOfUserInWorkspace(db, req.user?.id ?? '', workspaceId),
        databaseHosts(db, workspaceId),
      ]);
      const roles = rolesForPages(all, memberRole, grants, hosts);
      visible = pages.filter((p) => roles.has(p.id));
    }

    res.json({ pages: visible.map((p) => serializePage(p)) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to list pages');
    res.status(500).json({ error: 'Failed to list pages' });
  }
});

/**
 * GET /api/pages/shared
 *
 * The pages shared with the caller in workspaces they are not a member of
 * (they are a guest there), with their role on each: every page their
 * grants reach, flat, per workspace. Members find restricted pages shared
 * with them in the workspace's own list.
 */
router.get('/shared', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const db = getDb();
    const [grants, memberships] = await Promise.all([
      listGrantsOfUser(db, userId),
      listMembershipsForUser(db, userId),
    ]);
    const memberOf = new Set(memberships.map((m) => m.workspaceId));
    const grantedPages = await findPagesByIds(
      db,
      grants.map((g) => g.pageId),
    );
    const workspaceIds = [...new Set(grantedPages.map((p) => p.workspaceId))].filter(
      (id) => !memberOf.has(id),
    );

    const out = [];
    for (const workspaceId of workspaceIds) {
      const workspace = await findLiveWorkspaceById(db, workspaceId);
      if (!workspace) continue;
      const all = await listPages(db, { workspaceId, archived: false });
      const roles = rolesForPages(all, null, grants, await databaseHosts(db, workspaceId));
      out.push({
        workspace: { id: workspace.id, name: workspace.name, icon: workspace.icon ?? null },
        pages: all
          .filter((p) => roles.has(p.id))
          .map((p) => ({ ...serializePage(p), role: roles.get(p.id) })),
      });
    }
    res.json({ shared: out });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to list shared pages');
    res.status(500).json({ error: 'Failed to list shared pages' });
  }
});

/**
 * GET /api/pages/:id
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);

    const db = getDb();
    const page = await findPageById(db, params.id);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const access = await checkPageAccess(req, res, db, page.id, 'viewer');
    if (!access) return;

    // The caller's role on this page decides what the app lets them do.
    res.json({ page: serializePage(page), role: access.role });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to fetch page');
    res.status(500).json({ error: 'Failed to fetch page' });
  }
});

/**
 * POST /api/pages
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createPageSchema.parse(req.body);
    const workspaceId = body.workspaceId;

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const db = getDb();

    // A subpage needs edit access to its parent, which a guest can have; a
    // top-level page needs a workspace editor.
    if (body.parentId) {
      const parent = await findPageById(db, body.parentId);
      if (!parent) {
        res.status(404).json({ error: 'Parent page not found' });
        return;
      }
      if (parent.workspaceId !== workspaceId) {
        res.status(400).json({ error: 'Parent page is in a different workspace' });
        return;
      }
      if (!(await checkPageAccess(req, res, db, parent.id, 'editor'))) return;
    } else if (!(await checkWorkspaceAccess(req, res, workspaceId, 'editor'))) {
      return;
    }

    // `max(order) + 1` among siblings, then insert. Read and write are
    // deliberately NOT wrapped in a transaction: under READ COMMITTED one
    // would take no lock and two concurrent creates would still read the same
    // maximum, so it would buy nothing while implying the race was closed.
    // The race is the one Mongo had, and `order` is a client-writable
    // `double precision` that `PATCH /api/pages/:id` renumbers anyway.
    const order = await nextSiblingOrder(db, {
      workspaceId,
      parentId: body.parentId ?? null,
    });

    const page = await createPage(db, {
      workspaceId,
      parentId: body.parentId ?? null,
      title: body.title ?? '',
      icon: body.icon ?? null,
      cover: body.cover ?? null,
      ownerId: userId,
      archived: false,
      order,
    });
    // Whoever creates a page follows it.
    await follow(db, page.id, userId);

    res.status(201).json({ page: serializePage(page) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to create page');
    res.status(500).json({ error: 'Failed to create page' });
  }
});

/**
 * PATCH /api/pages/:id
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const body = updatePageSchema.parse(req.body);

    const db = getDb();
    const page = await findPageById(db, params.id);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const access = await checkPageAccess(req, res, db, page.id, 'editor');
    if (!access) return;
    const userId = req.user?.id as string;

    if (body.parentId !== undefined && body.parentId !== null) {
      if (body.parentId === page.id) {
        res.status(400).json({ error: 'A page cannot be its own parent' });
        return;
      }
      const parent = await findPageById(db, body.parentId);
      if (!parent) {
        res.status(404).json({ error: 'Parent page not found' });
        return;
      }
      if (parent.workspaceId !== page.workspaceId) {
        res.status(400).json({ error: 'Parent page is in a different workspace' });
        return;
      }
      // Moving a page under another needs edit access there too.
      if (!(await checkPageAccess(req, res, db, parent.id, 'editor'))) return;
    } else if (body.parentId === null && page.parentId !== null) {
      // To the top level: a workspace editor's place.
      if (!access.memberRole || !hasRole(access.memberRole, 'editor')) {
        res.status(403).json({ error: 'Moving a page to the top level needs a workspace editor' });
        return;
      }
    }

    // Restricting a page shuts other members out: full access, or the page's
    // creator. Whoever restricts it keeps access through a grant.
    if (body.restricted !== undefined && body.restricted !== page.restricted) {
      if (!hasRole(access.role, 'admin') && page.ownerId !== userId) {
        res.status(403).json({
          error: 'Changing who can open a page needs full access to it',
          code: 'INSUFFICIENT_ROLE',
          required: 'admin',
          actual: access.role,
        });
        return;
      }
      if (body.restricted && !(access.memberRole && hasRole(access.memberRole, 'admin'))) {
        await upsertGrant(db, { pageId: page.id, userId, role: 'admin', grantedBy: userId });
      }
    }

    // Built by assignment rather than by spreading `body`, because `title` is
    // written twice below and the second write has to win.
    const patch = {
      parentId: body.parentId,
      title: body.title,
      icon: body.icon,
      cover: body.cover,
      coverPosition: body.coverPosition,
      order: body.order,
      archived: body.archived,
      favorited: body.favorited,
      restricted: body.restricted,
      template: body.template,
      lastEditedBy: userId,
      mergeProperties: undefined as Record<string, unknown> | undefined,
    };

    if (body.properties) {
      if (!page.databaseId) {
        res.status(400).json({
          error: 'Properties can only be set on database row pages',
        });
        return;
      }
      const database = await findDatabaseById(db, page.databaseId);
      if (!database) {
        res.status(404).json({ error: 'Database not found for row' });
        return;
      }
      const schemaById = new Map(database.propertiesSchema.properties.map((p) => [p.id, p]));
      // Only the keys that survive validation are sent. `mergeProperties` is a
      // shallow top-level merge into the stored object, so the keys the request
      // does not mention keep their values — which is what `.set()` on the
      // page's existing property Map did.
      const merge: Record<string, unknown> = {};
      for (const [key, raw] of Object.entries(body.properties)) {
        const prop = schemaById.get(key);
        if (!prop) continue;
        const parsed = parsePropertyValue(prop.type, raw);
        if (!parsed) continue;
        merge[key] = serializeParsedValue(parsed);
        // Keep title <-> Name in sync. This overwrites `body.title` when both
        // are submitted, matching the order the two writes happened in before.
        if (key === NAME_PROPERTY_ID && parsed.kind === 'text') {
          patch.title = parsed.text;
        }
      }
      patch.mergeProperties = merge;
    }

    // Sync the Name property when the title changes on a database row. Runs
    // after the loop above, so an explicit `title` wins over a submitted `name`
    // property for what gets STORED in `properties.name` — while the loop wins
    // for what gets stored in `title`. That asymmetry is the existing behaviour
    // and is preserved rather than quietly reconciled here.
    if (body.title !== undefined && page.databaseId) {
      patch.mergeProperties = {
        ...patch.mergeProperties,
        [NAME_PROPERTY_ID]: { text: body.title },
      };
    }

    const updated = await updatePage(db, page.id, patch);
    if (!updated) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    res.json({ page: serializePage(updated) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to update page');
    res.status(500).json({ error: 'Failed to update page' });
  }
});

/**
 * DELETE /api/pages/:id
 * Soft-delete (archived = true) by default. Hard-delete when `?hard=true`
 * and caller is the workspace owner.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const hard = req.query.hard === 'true';

    const db = getDb();
    const page = await findPageById(db, params.id);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const access = await checkPageAccess(req, res, db, page.id, 'editor');
    if (!access) return;

    if (hard) {
      // Hard-delete requires workspace ownership.
      if (access.memberRole !== 'owner') {
        res.status(403).json({ error: 'Hard delete requires workspace owner role' });
        return;
      }

      // One recursive statement rather than the BFS-then-two-`deleteMany` this
      // replaces, and NOT a bare `delete from pages where id = ?` relying on
      // the referential action. `pages.parentId` is `ON DELETE SET NULL`, not
      // CASCADE — deliberately, so that emptying the trash cannot destroy live
      // children of an archived page — so a single-row delete here would
      // ORPHAN the subtree instead of removing it. Blocks still go by cascade;
      // the explicit `Block.deleteMany` has no counterpart because
      // `blocks.pageId` is CASCADE.
      const deleted = await deletePageTree(db, page.id);

      res.json({ success: true, deleted });
      return;
    }

    const archivedPage = await updatePage(db, page.id, { archived: true });
    if (!archivedPage) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    res.json({ page: serializePage(archivedPage) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to delete page');
    res.status(500).json({ error: 'Failed to delete page' });
  }
});

const duplicateSchema = z
  .object({
    /** Where the copy goes; beside the source when absent. */
    parentId: entityIdSchema.nullable().optional(),
    /** Use a template: the copy keeps its title and is an ordinary page. */
    fromTemplate: z.boolean().optional(),
  })
  .default({});

/**
 * POST /api/pages/:id/duplicate [{ parentId?, fromTemplate? }]
 *
 * Copies the page with its subpages, their blocks and who may open them, as
 * Notion's Duplicate does. By default the copy lands beside the source, is
 * titled "… (copy)" and needs edit access to the source. `fromTemplate` uses
 * a template instead: viewing it is enough, the copy keeps its title, is not
 * a template, and goes to `parentId` (the top level when absent).
 */
router.post('/:id/duplicate', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const body = duplicateSchema.parse(req.body ?? {});

    const db = getDb();
    const source = await findPageById(db, params.id);
    if (!source) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    if (body.fromTemplate && !source.template) {
      res.status(400).json({ error: 'That page is not a template' });
      return;
    }

    const access = await checkPageAccess(
      req,
      res,
      db,
      source.id,
      body.fromTemplate ? 'viewer' : 'editor',
    );
    if (!access) return;
    const userId = req.user?.id as string;

    // The destination: a page needs edit access there, the top level a
    // workspace editor.
    const parentId =
      body.parentId !== undefined ? body.parentId : body.fromTemplate ? null : source.parentId;
    if (parentId) {
      const parent = await findPageById(db, parentId);
      if (!parent || parent.workspaceId !== source.workspaceId) {
        res.status(400).json({ error: 'The destination is not a page of this workspace' });
        return;
      }
      if (!(await checkPageAccess(req, res, db, parent.id, 'editor'))) return;
    } else if (!access.memberRole || !hasRole(access.memberRole, 'editor')) {
      res.status(403).json({ error: 'Adding a top-level page needs a workspace editor' });
      return;
    }

    // One logical write: the pages, their blocks and their grants commit
    // together. The transaction does not close the sibling-order race —
    // `nextSiblingOrder` takes no lock under READ COMMITTED.
    const duplicate = await db.transaction(async (tx) => {
      const order = await nextSiblingOrder(tx, { workspaceId: source.workspaceId, parentId });
      return copyPageTree(tx, {
        sourceId: source.id,
        parentId,
        order,
        title: body.fromTemplate
          ? source.title
          : source.title
            ? `${source.title} (copy)`
            : '(copy)',
        template: !body.fromTemplate && source.template,
        userId,
        keepAccess: !(access.memberRole && hasRole(access.memberRole, 'admin')),
      });
    });

    res.status(201).json({ page: serializePage(duplicate) });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to duplicate page');
    res.status(500).json({ error: 'Failed to duplicate page' });
  }
});

/**
 * GET /api/pages/:id/breadcrumb
 * Returns the chain of ancestors from workspace root → current page (inclusive).
 * Each entry is a slim {id, title, icon} record — enough to render a nav crumb.
 * Bounded at 32 levels to defend against pathological loops.
 */
router.get('/:id/breadcrumb', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);

    const db = getDb();
    const head = await findPageById(db, params.id);
    if (!head) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const access = await checkPageAccess(req, res, db, head.id, 'viewer');
    if (!access) return;

    // One recursive walk instead of one query per level. The depth bound and
    // the cycle handling that the `seen` set provided are both inside
    // `findPageAncestry`, which returns root-first exactly as the `unshift` did.
    // Only the ancestors the caller can open are named.
    const open = new Set(accessibleAncestry(access).map((link) => link.id));
    const breadcrumb = (await findPageAncestry(db, head.id)).filter((crumb) => open.has(crumb.id));

    res.json({ breadcrumb });
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to fetch page breadcrumb');
    res.status(500).json({ error: 'Failed to fetch page breadcrumb' });
  }
});

const exportQuerySchema = z.object({
  format: z.enum(['md', 'markdown', 'html']).default('md'),
});

/**
 * GET /api/pages/:id/export?format=md|html
 *
 * The page as a Markdown or a standalone HTML document: title, blocks with
 * their formatting and nesting (`@nilo/contracts` markdown/HTML), every piece
 * of text escaped in HTML.
 */
router.get('/:id/export', async (req: Request, res: Response) => {
  try {
    const params = z.object({ id: entityIdSchema }).parse(req.params);
    const { format } = exportQuerySchema.parse(req.query);

    const db = getDb();
    const page = await findPageById(db, params.id);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    if (!(await checkPageAccess(req, res, db, page.id, 'viewer'))) return;

    const tree = blocksToTree(await listBlocksForPage(db, page.id));
    const title = page.title?.trim() ? page.title : 'Untitled';
    // A filename every OS accepts, plus the exact name for clients that read RFC 5987.
    const ascii =
      title
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9-_]+/gu, '-')
        .replace(/^-+|-+$/g, '') || 'page';
    const html = format === 'html';
    const extension = html ? 'html' : 'md';
    res.setHeader(
      'Content-Type',
      html ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${ascii}.${extension}"; filename*=UTF-8''${encodeURIComponent(`${title}.${extension}`)}`,
    );
    res.send(html ? blocksToHtml(tree, title) : blocksToMarkdown(tree, title));
  } catch (error: unknown) {
    if (handleZodError(error, res)) return;
    log.general.error({ err: error }, 'Failed to export page');
    res.status(500).json({ error: 'Failed to export page' });
  }
});

export default router;
