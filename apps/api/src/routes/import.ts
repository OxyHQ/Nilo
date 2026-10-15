/**
 * Importing pages from Markdown: files with their folder structure
 * (`POST /pages/import`), or the ZIP of a Notion export
 * (`POST /pages/import/zip`).
 *
 * Each `.md` file becomes a page; a folder named like a file (Notion's
 * `Page abc….md` beside `Page abc…/`) holds that page's subpages, and a
 * folder with no such file becomes a page of its own. Titles come from the
 * document's leading `# Title`, else the file name without Notion's id.
 * Blocks are written through `applyBlockTransaction`, like any edit.
 */
import express, { Router, type Request, type Response } from 'express';
import { markdownTitle, markdownToBlocks, type BlockNode } from '@nilo/contracts';
import { isLiveEntityId, uuidv7 } from '@oxy.so/db';
import { strFromU8, unzipSync } from 'fflate';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { applyBlockTransaction, type BlockOperation } from '../lib/block-transactions.js';
import { log } from '../lib/logger.js';
import { checkPageAccess } from '../lib/page-access.js';
import { checkWorkspaceAccess } from '../lib/workspace-access.js';
import { authenticateToken } from '../middleware/auth.js';
import { createPage, findPageById, nextSiblingOrder } from '../repositories/pages.js';

const router = Router();
const entityIdSchema = z.string().refine(isLiveEntityId, 'Invalid id');

/** Bounds on one import. */
const MAX_FILES = 1000;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const fileSchema = z.object({ path: z.string().min(1).max(1024), content: z.string() });
const importSchema = z.object({
  workspaceId: entityIdSchema,
  parentId: entityIdSchema.nullable().optional(),
  files: z.array(fileSchema).min(1).max(MAX_FILES),
});

export interface ImportFile {
  path: string;
  content: string;
}

interface Planned {
  /** Path without extension: the key a same-named folder points at. */
  key: string;
  parentKey: string | null;
  title: string;
  blocks: BlockNode[];
}

/** Notion appends ` <32 hex>` to exported names. */
const withoutNotionId = (name: string) => name.replace(/\s+[0-9a-f]{32}$/i, '').trim();

const normalizePath = (path: string) =>
  path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');

/**
 * The pages an import creates, parents before children. Files that are not
 * Markdown are skipped (returned, so the caller can say so).
 */
export function planImport(files: readonly ImportFile[]): { pages: Planned[]; skipped: string[] } {
  const skipped: string[] = [];
  const markdown = new Map<string, string>();
  for (const file of files) {
    const path = normalizePath(file.path);
    if (/\.(md|markdown)$/i.test(path))
      markdown.set(path.replace(/\.(md|markdown)$/i, ''), file.content);
    else if (!path.startsWith('__MACOSX/') && !path.endsWith('/')) skipped.push(path);
  }
  const keys = new Set(markdown.keys());
  // Folders that hold files but have no page of their own become pages too.
  for (const key of [...keys]) {
    const parts = key.split('/');
    for (let i = 1; i < parts.length; i += 1) keys.add(parts.slice(0, i).join('/'));
  }
  // A Notion export wraps everything in one folder with no page of its own: drop it.
  const tops = new Set([...keys].map((k) => k.split('/')[0] as string));
  const [onlyTop] = [...tops];
  const wrapper =
    tops.size === 1 && onlyTop && !markdown.has(onlyTop) && keys.size > 1 ? onlyTop : null;

  const pages: Planned[] = [];
  for (const key of [...keys].sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
  )) {
    if (key === wrapper) continue;
    const local = wrapper ? key.slice(wrapper.length + 1) : key;
    const parts = local.split('/');
    const parentLocal = parts.slice(0, -1).join('/');
    const content = markdown.get(key);
    const name = withoutNotionId(parts[parts.length - 1] as string) || 'Untitled';
    if (content === undefined) {
      pages.push({ key: local, parentKey: parentLocal || null, title: name, blocks: [] });
      continue;
    }
    const { title, body } = markdownTitle(content);
    pages.push({
      key: local,
      parentKey: parentLocal || null,
      title: title ?? name,
      blocks: markdownToBlocks(body),
    });
  }
  return { pages, skipped };
}

/** Insert operations for block trees: parents first, each after its previous sibling. */
function insertOperations(blocks: readonly BlockNode[]): BlockOperation[] {
  const ops: BlockOperation[] = [];
  const add = (nodes: readonly BlockNode[], parentBlockId: string | null) => {
    let afterId: string | null = null;
    for (const block of nodes) {
      const id = uuidv7();
      ops.push({
        kind: 'insert',
        id,
        parentBlockId,
        afterId,
        type: block.type,
        content: block.content,
      });
      afterId = id;
      add(block.children, id);
    }
  };
  add(blocks, null);
  return ops;
}

async function runImport(
  req: Request,
  res: Response,
  input: { workspaceId: string; parentId: string | null; files: readonly ImportFile[] },
): Promise<void> {
  const db = getDb();
  if (input.parentId) {
    const parent = await findPageById(db, input.parentId);
    if (!parent || parent.workspaceId !== input.workspaceId) {
      res.status(400).json({ error: 'The destination is not a page of this workspace' });
      return;
    }
    if (!(await checkPageAccess(req, res, db, parent.id, 'editor'))) return;
  } else if (!(await checkWorkspaceAccess(req, res, input.workspaceId, 'editor'))) {
    return;
  }
  const userId = req.user?.id as string;
  const { pages, skipped } = planImport(input.files);
  if (pages.length === 0) {
    res.status(400).json({ error: 'No Markdown files to import', skipped });
    return;
  }

  const created = new Map<string, string>();
  const out: { id: string; title: string; parentId: string | null }[] = [];
  for (const planned of pages) {
    const parentId = planned.parentKey
      ? (created.get(planned.parentKey) ?? input.parentId)
      : input.parentId;
    const page = await createPage(db, {
      workspaceId: input.workspaceId,
      parentId,
      title: planned.title,
      ownerId: userId,
      order: await nextSiblingOrder(db, { workspaceId: input.workspaceId, parentId }),
    });
    created.set(planned.key, page.id);
    const ops = insertOperations(planned.blocks);
    if (ops.length > 0) await applyBlockTransaction(db, { pageId: page.id, ops, actorId: userId });
    out.push({ id: page.id, title: page.title, parentId });
  }
  res.status(201).json({ pages: out, skipped });
}

/** POST /pages/import { workspaceId, parentId?, files: [{ path, content }] } */
router.post('/pages/import', authenticateToken, async (req: Request, res: Response) => {
  try {
    const body = importSchema.parse(req.body);
    const total = body.files.reduce((sum, f) => sum + Buffer.byteLength(f.content), 0);
    if (total > MAX_TOTAL_BYTES) {
      res.status(413).json({ error: 'The import is too large' });
      return;
    }
    await runImport(req, res, {
      workspaceId: body.workspaceId,
      parentId: body.parentId ?? null,
      files: body.files as ImportFile[],
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    log.general.error({ err: error }, 'Import failed');
    res.status(500).json({ error: 'Import failed' });
  }
});

/** POST /pages/import/zip?workspaceId=…[&parentId=…] with the ZIP as the body (`application/zip`). */
router.post(
  '/pages/import/zip',
  authenticateToken,
  express.raw({
    type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
    limit: '25mb',
  }),
  async (req: Request, res: Response) => {
    try {
      const query = z
        .object({ workspaceId: entityIdSchema, parentId: entityIdSchema.optional() })
        .parse(req.query);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: 'Send the ZIP file as the request body' });
        return;
      }
      let total = 0;
      let count = 0;
      const entries = unzipSync(new Uint8Array(req.body), {
        // Only Markdown is read; bounded before anything is inflated.
        filter: (file) => {
          if (!/\.(md|markdown)$/i.test(file.name)) return false;
          count += 1;
          total += file.originalSize;
          return count <= MAX_FILES && total <= MAX_TOTAL_BYTES;
        },
      });
      if (count > MAX_FILES || total > MAX_TOTAL_BYTES) {
        res.status(413).json({ error: 'The import is too large' });
        return;
      }
      const files = Object.entries(entries).map(([path, bytes]) => ({
        path,
        content: strFromU8(bytes),
      }));
      await runImport(req, res, {
        workspaceId: query.workspaceId,
        parentId: query.parentId ?? null,
        files,
      });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid input', details: error.errors });
        return;
      }
      log.general.warn({ err: error }, 'ZIP import failed');
      res.status(400).json({ error: 'That file could not be read as a ZIP export' });
    }
  },
);

export default router;
