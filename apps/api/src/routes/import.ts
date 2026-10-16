/**
 * Importing pages from Markdown and HTML: files with their folder structure
 * (`POST /pages/import`), or the ZIP of a Notion export, Markdown or HTML
 * (`POST /pages/import/zip`).
 *
 * Each `.md` or `.html` file becomes a page; a folder named like a file
 * (Notion's `Page abc….md` beside `Page abc…/`) holds that page's subpages,
 * and a folder with no such file becomes a page of its own. Titles come from
 * the document's leading `# Title` (Markdown) or its `<title>`, else leading
 * `<h1>` (HTML), else the file name without Notion's id. A CSV, or a Notion
 * database exported as an HTML table, becomes a database whose rows take
 * their content from the same-named folder. Blocks are written through
 * `applyBlockTransaction`, like any edit.
 */
import express, { Router, type Request, type Response } from 'express';
import { markdownTitle, markdownToBlocks, type BlockNode } from '@oxy.so/nilo-contracts';
import { isLiveEntityId, uuidv7 } from '@oxy.so/db';
import { strFromU8, unzipSync } from 'fflate';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { applyBlockTransaction, type BlockOperation } from '../lib/block-transactions.js';
import { HtmlTooDeepError, type HtmlPage, readHtmlPage } from '../lib/html-import.js';
import { log } from '../lib/logger.js';
import { checkPageAccess } from '../lib/page-access.js';
import { placeOrRefuse } from '../lib/placement.js';
import { createDatabaseWithRows } from '../lib/databases/create.js';
import { parseCsv, tableToDatabase } from '../lib/databases/csv.js';
import { authenticateToken } from '../middleware/auth.js';
import { createPage, findPageById, nextSiblingOrder } from '../repositories/pages.js';
import { announceChange } from '../collab/live-rooms.js';

const router = Router();
const entityIdSchema = z.string().refine(isLiveEntityId, 'Invalid id');

/** Bounds on one import. */
const MAX_FILES = 1000;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const MARKDOWN = /\.(md|markdown)$/i;
const HTML = /\.html?$/i;

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
  /** Links to other imported pages are `link_to_page` with the target's `pageKey`. */
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

const dirOf = (key: string) => key.split('/').slice(0, -1).join('/');
const nameOf = (key: string) => key.split('/').pop() as string;

/**
 * The key of the file a relative link in the file at `from` names (Notion's
 * `Sub%20page%20abc….html`), or null for a link out of the export.
 */
function linkedKey(from: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/') || href.startsWith('#'))
    return null;
  let path: string;
  try {
    path = decodeURIComponent(href.split(/[?#]/)[0] as string);
  } catch {
    return null;
  }
  const parts = dirOf(from) ? dirOf(from).split('/') : [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/').replace(HTML, '') || null;
}

/** A page's source: Markdown text, or an HTML document already read. */
type Source = { markdown: string } | { html: HtmlPage };

interface PlannedDatabase {
  key: string;
  /** The page that holds the database, when there is one. */
  parentKey: string | null;
  name: string;
  /** The header row, then the records. */
  table: string[][];
  /** Row titles → the blocks of each row's exported page. */
  rowBodies: Map<string, BlockNode[]>;
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
 * What an import creates, parents before children: a page per Markdown or
 * HTML file (and per folder with no file of its own), a database per CSV (a
 * Notion export's `…_all.csv` preferred) or per database table in a Notion
 * HTML export, with its rows' content from the same-named folder. Other
 * files, and HTML too deeply nested to read, are skipped and returned.
 */
export function planImport(files: readonly ImportFile[]): {
  pages: Planned[];
  databases: PlannedDatabase[];
  skipped: string[];
} {
  const skipped: string[] = [];
  const documents = new Map<string, Source>();
  /** Database tables by key; `host` is the page an inline one sits in. */
  const tables = new Map<
    string,
    { table: string[][]; all: boolean; name?: string; host?: string }
  >();
  const htmlTables = new Map<string, { table: string[][]; name?: string; host?: string }>();
  for (const file of files) {
    const path = normalizePath(file.path);
    if (MARKDOWN.test(path)) documents.set(path.replace(MARKDOWN, ''), { markdown: file.content });
    else if (HTML.test(path)) {
      const key = path.replace(HTML, '');
      let page: HtmlPage;
      try {
        page = readHtmlPage(file.content);
      } catch (error) {
        if (!(error instanceof HtmlTooDeepError)) throw error;
        skipped.push(path);
        continue;
      }
      for (const database of page.databases) {
        const name = database.name ?? page.title ?? undefined;
        // An inline database's rows sit in a folder its links name; a full-page one is its file.
        const row = database.rowHrefs.map((href) => linkedKey(key, href)).find(Boolean);
        const tableKey = page.isDatabase
          ? key
          : row
            ? dirOf(row)
            : `${key}/${(name ?? 'Untitled').replace(/\//g, ' ')}`;
        htmlTables.set(tableKey, {
          table: database.table,
          name,
          ...(!page.isDatabase && { host: key }),
        });
      }
      if (!page.isDatabase) documents.set(key, { html: page });
    } else if (/\.csv$/i.test(path)) {
      const all = /_all\.csv$/i.test(path);
      const key = path.replace(/(_all)?\.csv$/i, '');
      if (!tables.has(key) || all) tables.set(key, { table: parseCsv(file.content), all });
    } else if (!path.startsWith('__MACOSX/') && !path.endsWith('/')) skipped.push(path);
  }
  // A CSV of the same database is the richer copy.
  for (const [key, table] of htmlTables)
    if (!tables.has(key)) tables.set(key, { ...table, all: false });

  // Documents inside a database's folder are its rows' content, not pages.
  const rowFiles = new Map<string, Map<string, { key: string; source: Source }>>();
  for (const [key, source] of [...documents]) {
    const dir = dirOf(key);
    if (!tables.has(dir)) continue;
    documents.delete(key);
    const title =
      ('markdown' in source ? markdownTitle(source.markdown).title : source.html.title) ??
      withoutNotionId(nameOf(key));
    rowFiles.set(dir, (rowFiles.get(dir) ?? new Map()).set(title, { key, source }));
  }

  const keys = new Set(documents.keys());
  // Folders that hold files but have no page of their own become pages too.
  for (const key of [...documents.keys(), ...tables.keys()]) {
    const parts = key.split('/');
    for (let i = 1; i < parts.length; i += 1) keys.add(parts.slice(0, i).join('/'));
  }
  for (const key of tables.keys()) keys.delete(key);
  // A Notion export wraps everything in one folder with no page of its own: drop it.
  const tops = new Set([...keys, ...tables.keys()].map((k) => k.split('/')[0] as string));
  const [onlyTop] = [...tops];
  const wrapper =
    tops.size === 1 && onlyTop && !documents.has(onlyTop) && keys.size + tables.size > 1
      ? onlyTop
      : null;
  if (wrapper) keys.delete(wrapper);
  const local = (key: string) => (wrapper ? key.slice(wrapper.length + 1) : key);

  /**
   * An HTML document's blocks with its links to other exported pages
   * pointing at the pages this import creates. A link to a database is
   * dropped (the database shows in its page), and one to a file not
   * imported reads as its title.
   */
  const linked = (blocks: readonly BlockNode[], from: string): BlockNode[] =>
    blocks.flatMap((block): BlockNode[] => {
      if (block.type !== 'link_to_page' || typeof block.content.href !== 'string')
        return [{ ...block, children: linked(block.children, from) }];
      const target = linkedKey(from, block.content.href);
      if (target && keys.has(target))
        return [{ type: 'link_to_page', content: { pageKey: local(target) }, children: [] }];
      const title = typeof block.content.title === 'string' ? block.content.title : '';
      if ((target && tables.has(target)) || !title) return [];
      return [
        {
          type: 'paragraph',
          content: { text: title, segments: [{ text: title }] },
          children: [],
        },
      ];
    });

  const pages: Planned[] = [];
  for (const key of [...keys].sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
  )) {
    const parts = local(key).split('/');
    const parentLocal = parts.slice(0, -1).join('/');
    const source = documents.get(key);
    const name = withoutNotionId(parts[parts.length - 1] as string) || 'Untitled';
    const base = { key: local(key), parentKey: parentLocal || null };
    if (source === undefined) pages.push({ ...base, title: name, blocks: [] });
    else if ('html' in source)
      pages.push({
        ...base,
        title: source.html.title ?? name,
        blocks: linked(source.html.blocks, key),
      });
    else {
      const { title, body } = markdownTitle(source.markdown);
      pages.push({ ...base, title: title ?? name, blocks: markdownToBlocks(body) });
    }
  }

  const databases: PlannedDatabase[] = [...tables].map(([key, entry]) => {
    const columns = (entry.table[0] ?? []).map((column) => column.trim());
    const rowBodies = new Map<string, BlockNode[]>();
    for (const [title, row] of rowFiles.get(key) ?? [])
      rowBodies.set(
        title,
        'html' in row.source
          ? linked(row.source.html.blocks, row.key)
          : markdownToBlocks(rowContent(row.source.markdown, columns)),
      );
    return {
      key: local(key),
      parentKey: entry.host !== undefined ? local(entry.host) : dirOf(local(key)) || null,
      name: entry.name || withoutNotionId(nameOf(local(key))) || 'Untitled',
      table: entry.table,
      rowBodies,
    };
  });
  return { pages, databases, skipped };
}

/** Links planned as `pageKey`s → the ids of the pages created for them. */
function withPageIds(
  blocks: readonly BlockNode[],
  created: ReadonlyMap<string, string>,
): BlockNode[] {
  return blocks.flatMap((block): BlockNode[] => {
    if (block.type !== 'link_to_page' || typeof block.content.pageKey !== 'string')
      return [{ ...block, children: withPageIds(block.children, created) }];
    const pageId = created.get(block.content.pageKey);
    return pageId ? [{ type: 'link_to_page', content: { pageId }, children: [] }] : [];
  });
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
    res.status(400).json({ error: 'Nothing to import: no Markdown, HTML or CSV files', skipped });
    return;
  }

  const created = new Map<string, string>();
  const out: { id: string; title: string; parentId: string | null }[] = [];
  // Every page first, so a link to a later page can name it.
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
    out.push({ id: page.id, title: page.title, parentId });
  }
  /** Each created page's last top-level block, so a database's block goes after it. */
  const lastBlock = new Map<string, string | null>();
  for (const planned of pages) {
    const pageId = created.get(planned.key) as string;
    const ops = insertOperations(withPageIds(planned.blocks, created));
    if (ops.length > 0) await applyBlockTransaction(db, { pageId, ops, actorId: userId });
    const tops = ops.filter((op) => op.kind === 'insert' && op.parentBlockId === null);
    lastBlock.set(pageId, tops.length > 0 ? (tops[tops.length - 1] as { id: string }).id : null);
  }

  const databasesOut: { id: string; name: string; parentPageId: string | null; rows: number }[] =
    [];
  for (const planned of databases) {
    const host = planned.parentKey
      ? (created.get(planned.parentKey) ?? input.parentId)
      : input.parentId;
    const parsed = tableToDatabase(planned.table);
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
    for (const [i, row] of parsed.rows.entries()) {
      const body = planned.rowBodies.get(row.title);
      const rowId = made.rowIds[i];
      if (!body || !rowId) continue;
      const ops = insertOperations(withPageIds(body, created));
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
  // Room for MAX_TOTAL_BYTES of files plus JSON's escaping.
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
        // Only Markdown, HTML and CSV are read; bounded before anything is inflated.
        filter: (file) => {
          if (!/\.(md|markdown|html?|csv)$/i.test(file.name)) return false;
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
