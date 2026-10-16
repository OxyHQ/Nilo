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
import { markdownTitle, markdownToBlocks, type BlockNode } from '@oxy.so/nilo-contracts';
import { isLiveEntityId, uuidv7 } from '@oxy.so/db';
import { strFromU8, unzipSync } from 'fflate';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { applyBlockTransaction, type BlockOperation } from '../lib/block-transactions.js';
import { log } from '../lib/logger.js';
import { checkPageAccess } from '../lib/page-access.js';
import { placeOrRefuse } from '../lib/placement.js';
import { createDatabaseWithRows } from '../lib/databases/create.js';
import { csvToDatabase } from '../lib/databases/csv.js';
import { authenticateToken } from '../middleware/auth.js';
import { createPage, findPageById, nextSiblingOrder } from '../repositories/pages.js';
import { announceChange } from '../collab/live-rooms.js';

const router = Router();
const entityIdSchema = z.string().refine(isLiveEntityId, 'Invalid id');

/** Bounds on one import. */
const MAX_FILES = 1000;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const fileSchema = z.object({ path: z.string().min(1).max(1024), content: z.string() });
const importSchema = z.object({
  workspaceId: entityIdSchema,
  parentId: entityIdSchema.nullable().optional(),
  /** At the top level: a teamspace, null for private; absent, the default one. */
  teamspaceId: entityIdSchema.nullable().optional(),
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

interface PlannedDatabase {
  key: string;
  /** The page whose folder holds the CSV, when there is one. */
  parentKey: string | null;
  name: string;
  csv: string;
  /** Row titles → the Markdown Notion exported for each row's page. */
  rowBodies: Map<string, string>;
}

/**
 * Notion writes a row's properties as `Name: value` lines under its title;
 * those are already columns, so only what follows them is the row's content.
 */
function rowContent(markdown: string, columns: readonly string[]): string {
  const { body } = markdownTitle(markdown);
  const lines = body.replace(/^\s*\n/, '').split('\n');
  let i = 0;
  while (i < lines.length && columns.some((c) => (lines[i] as string).startsWith(`${c}: `))) i += 1;
  return lines.slice(i).join('\n');
}

/**
 * What an import creates, parents before children: a page per Markdown
 * file (and per folder with no file of its own), a database per CSV (a
 * Notion export's `…_all.csv` preferred, with its rows' Markdown from the
 * same-named folder). Other files are skipped and returned.
 */
export function planImport(files: readonly ImportFile[]): {
  pages: Planned[];
  databases: PlannedDatabase[];
  skipped: string[];
} {
  const skipped: string[] = [];
  const markdown = new Map<string, string>();
  const csv = new Map<string, { content: string; all: boolean }>();
  for (const file of files) {
    const path = normalizePath(file.path);
    if (/\.(md|markdown)$/i.test(path))
      markdown.set(path.replace(/\.(md|markdown)$/i, ''), file.content);
    else if (/\.csv$/i.test(path)) {
      const all = /_all\.csv$/i.test(path);
      const key = path.replace(/(_all)?\.csv$/i, '');
      if (!csv.has(key) || all) csv.set(key, { content: file.content, all });
    } else if (!path.startsWith('__MACOSX/') && !path.endsWith('/')) skipped.push(path);
  }
  const dirOf = (key: string) => key.split('/').slice(0, -1).join('/');
  // Markdown inside a database's folder is its rows' content, not pages.
  const rowFiles = new Map<string, Map<string, string>>();
  for (const [key, content] of [...markdown]) {
    const dir = dirOf(key);
    if (!csv.has(dir)) continue;
    markdown.delete(key);
    const title = markdownTitle(content).title ?? withoutNotionId(key.split('/').pop() as string);
    rowFiles.set(dir, (rowFiles.get(dir) ?? new Map()).set(title, content));
  }

  const keys = new Set(markdown.keys());
  // Folders that hold files but have no page of their own become pages too.
  for (const key of [...markdown.keys(), ...csv.keys()]) {
    const parts = key.split('/');
    for (let i = 1; i < parts.length; i += 1) keys.add(parts.slice(0, i).join('/'));
  }
  for (const key of csv.keys()) keys.delete(key);
  // A Notion export wraps everything in one folder with no page of its own: drop it.
  const tops = new Set([...keys, ...csv.keys()].map((k) => k.split('/')[0] as string));
  const [onlyTop] = [...tops];
  const wrapper =
    tops.size === 1 && onlyTop && !markdown.has(onlyTop) && keys.size + csv.size > 1
      ? onlyTop
      : null;
  const local = (key: string) => (wrapper ? key.slice(wrapper.length + 1) : key);

  const pages: Planned[] = [];
  for (const key of [...keys].sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
  )) {
    if (key === wrapper) continue;
    const parts = local(key).split('/');
    const parentLocal = parts.slice(0, -1).join('/');
    const content = markdown.get(key);
    const name = withoutNotionId(parts[parts.length - 1] as string) || 'Untitled';
    if (content === undefined) {
      pages.push({ key: local(key), parentKey: parentLocal || null, title: name, blocks: [] });
      continue;
    }
    const { title, body } = markdownTitle(content);
    pages.push({
      key: local(key),
      parentKey: parentLocal || null,
      title: title ?? name,
      blocks: markdownToBlocks(body),
    });
  }

  const databases: PlannedDatabase[] = [...csv].map(([key, file]) => {
    const parts = local(key).split('/');
    return {
      key: local(key),
      parentKey: parts.slice(0, -1).join('/') || null,
      name: withoutNotionId(parts[parts.length - 1] as string) || 'Untitled',
      csv: file.content,
      rowBodies: rowFiles.get(key) ?? new Map(),
    };
  });
  return { pages, databases, skipped };
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
  input: {
    workspaceId: string;
    parentId: string | null;
    teamspaceId: string | null | undefined;
    files: readonly ImportFile[];
  },
): Promise<void> {
  const db = getDb();
  if (input.parentId) {
    const parent = await findPageById(db, input.parentId);
    if (!parent || parent.workspaceId !== input.workspaceId) {
      res.status(400).json({ error: 'The destination is not a page of this workspace' });
      return;
    }
    if (!(await checkPageAccess(req, res, db, parent.id, 'editor'))) return;
  }
  const userId = req.user?.id as string;
  // What lands at the top level lives in one place (`lib/placement.ts`).
  const place = input.parentId
    ? { teamspaceId: null }
    : await placeOrRefuse(res, db, input.workspaceId, userId, input.teamspaceId);
  if (!place) return;
  const { pages, databases, skipped } = planImport(input.files);
  if (pages.length === 0 && databases.length === 0) {
    res.status(400).json({ error: 'Nothing to import: no Markdown or CSV files', skipped });
    return;
  }

  const created = new Map<string, string>();
  /** Each created page's last top-level block, so a database's block goes after it. */
  const lastBlock = new Map<string, string | null>();
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
      teamspaceId: place.teamspaceId,
    });
    created.set(planned.key, page.id);
    const ops = insertOperations(planned.blocks);
    if (ops.length > 0) await applyBlockTransaction(db, { pageId: page.id, ops, actorId: userId });
    const tops = ops.filter((op) => op.kind === 'insert' && op.parentBlockId === null);
    lastBlock.set(page.id, tops.length > 0 ? (tops[tops.length - 1] as { id: string }).id : null);
    out.push({ id: page.id, title: page.title, parentId });
  }

  const databasesOut: { id: string; name: string; parentPageId: string | null; rows: number }[] =
    [];
  for (const planned of databases) {
    const host = planned.parentKey
      ? (created.get(planned.parentKey) ?? input.parentId)
      : input.parentId;
    const parsed = csvToDatabase(planned.csv);
    const made = await db.transaction((tx) =>
      createDatabaseWithRows(tx, {
        workspaceId: input.workspaceId,
        name: planned.name,
        ownerId: userId,
        schema: parsed.schema,
        isInline: host !== null,
        parentPageId: host,
        teamspaceId: place.teamspaceId,
        rows: parsed.rows,
      }),
    );
    // An inline database shows where it was: at the end of its page.
    if (host) {
      const id = uuidv7();
      await applyBlockTransaction(db, {
        pageId: host,
        ops: [
          {
            kind: 'insert',
            id,
            parentBlockId: null,
            afterId: lastBlock.get(host) ?? null,
            type: 'inline_database',
            content: { databaseId: made.database.id },
          },
        ],
        actorId: userId,
      });
      lastBlock.set(host, id);
    }
    // Each row's own content, from its exported page.
    const columns = parsed.schema.properties.map((p) => p.name);
    for (const [i, row] of parsed.rows.entries()) {
      const body = planned.rowBodies.get(row.title);
      const rowId = made.rowIds[i];
      if (!body || !rowId) continue;
      const ops = insertOperations(markdownToBlocks(rowContent(body, columns)));
      if (ops.length > 0) await applyBlockTransaction(db, { pageId: rowId, ops, actorId: userId });
    }
    databasesOut.push({
      id: made.database.id,
      name: made.database.name,
      parentPageId: host,
      rows: made.rowIds.length,
    });
  }
  announceChange({ workspaceId: input.workspaceId });
  res.status(201).json({ pages: out, databases: databasesOut, skipped });
}

/** POST /pages/import { workspaceId, parentId?, files: [{ path, content }] } */
router.post(
  '/pages/import',
  authenticateToken,
  // Room for MAX_TOTAL_BYTES of Markdown plus JSON's escaping.
  express.json({ limit: '30mb' }),
  async (req: Request, res: Response) => {
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
        teamspaceId: body.teamspaceId,
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
  },
);

/**
 * POST /pages/import/zip?workspaceId=…[&parentId=…][&teamspaceId=…|private] with the
 * ZIP as the body (`application/zip`).
 */
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
        .object({
          workspaceId: entityIdSchema,
          parentId: entityIdSchema.optional(),
          // A teamspace's id, or `private`; the default teamspace when absent.
          teamspaceId: z
            .union([entityIdSchema, z.literal('private')])
            .optional()
            .transform((v) => (v === 'private' ? null : v)),
        })
        .parse(req.query);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: 'Send the ZIP file as the request body' });
        return;
      }
      let total = 0;
      let count = 0;
      const entries = unzipSync(new Uint8Array(req.body), {
        // Only Markdown and CSV are read; bounded before anything is inflated.
        filter: (file) => {
          if (!/\.(md|markdown|csv)$/i.test(file.name)) return false;
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
        teamspaceId: query.teamspaceId,
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
