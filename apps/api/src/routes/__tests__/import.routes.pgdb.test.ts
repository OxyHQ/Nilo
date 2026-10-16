/**
 * Import and export against PostgreSQL: Markdown and HTML files with
 * folders, Notion-style ZIPs (Markdown and HTML), and exporting the result
 * back to Markdown and HTML.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { asc, eq } from 'drizzle-orm';
import express from 'express';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { blocks, pages } from '../../db/schema/pages.js';
import { databases as databasesTable } from '../../db/schema/databases.js';
import { workspaceMembers, workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';
import { planImport } from '../import.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticateToken: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: String(req.header('x-test-user')) };
    next();
  },
  oxyClient: {
    // The real limiters resolve an optional session through this; anonymous here.
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
  },
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { default: importRouter } = await import('../import.js');
const { default: pagesRouter } = await import('../pages.js');
const { default: databasesRouter } = await import('../databases.js');

let db: TestDatabase;
let server: Server;
let base: string;
let workspaceId: string;
let previousUrl: string | undefined;
const EDITOR = 'import-editor';
const VIEWER = 'import-viewer';

async function call(
  user: string,
  method: string,
  path: string,
  body?: BodyInit,
  type = 'application/json',
) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': type, 'x-test-user': user, 'x-workspace-id': workspaceId },
    body,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json, type: res.headers.get('content-type') ?? '' };
}

/** A page as Notion's HTML export writes it: a header, then the page body. */
const notionHtml = (title: string, body: string, header = '') =>
  `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"/><title>${title}</title><style>.page{}</style></head><body><article id="x" class="page sans"><header><h1 class="page-title">${title}</h1>${header}</header><div class="page-body">${body}</div></article></body></html>`;

/** A Notion database table, its rows linking to their pages. */
const notionTable = (head: string[], rows: { cells: string[]; href: string }[]) =>
  `<table class="collection-content"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map(
      (row) =>
        `<tr><td class="cell-title"><a href="${row.href}">${row.cells[0]}</a></td>${row.cells
          .slice(1)
          .map((c) => `<td>${c}</td>`)
          .join('')}</tr>`,
    )
    .join('')}</tbody></table>`;

/** A page's blocks as projected rows, top-level first in order. */
async function blocksOf(pageId: string) {
  return db.select().from(blocks).where(eq(blocks.pageId, pageId)).orderBy(asc(blocks.order));
}

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: testScope('import'), ownerId: EDITOR })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: EDITOR, role: 'editor' },
    { workspaceId, userId: VIEWER, role: 'viewer' },
  ]);
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(importRouter);
  app.use('/pages', pagesRouter);
  app.use('/databases', databasesRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousUrl;
});

describe('planImport', () => {
  it('nests a Notion export: files, same-named folders, ids dropped, the wrapper folder ignored', () => {
    const { pages, skipped } = planImport([
      {
        path: 'Export-123/Projects 0123456789abcdef0123456789abcdef.md',
        content: '# Projects\n\nAll of them',
      },
      {
        path: 'Export-123/Projects 0123456789abcdef0123456789abcdef/Nilo fedcba9876543210fedcba9876543210.md',
        content: 'notes',
      },
      { path: 'Export-123/Loose/Idea.md', content: '- a' },
      { path: 'Export-123/image.png', content: '' },
    ]);
    expect(pages.map((p) => [p.title, p.parentKey])).toEqual([
      ['Loose', null],
      ['Projects', null],
      ['Idea', 'Loose'],
      ['Nilo', 'Projects 0123456789abcdef0123456789abcdef'],
    ]);
    expect(skipped).toEqual(['Export-123/image.png']);
  });
  it('plans a Notion HTML export as it plans the Markdown one, its databases as databases', () => {
    const id = '0123456789abcdef0123456789abcdef';
    const { pages, databases, skipped } = planImport([
      {
        path: `Export/Docs ${id}.html`,
        content: notionHtml(
          'Docs',
          `<p>Intro</p><figure class="link-to-page"><a href="Docs%20${id}/API%20fedcba9876543210fedcba9876543210.html"><span class="icon">📄</span>API</a></figure><figure class="link-to-page"><a href="Gone.html">Gone</a></figure><div class="collection-content"><h4 class="collection-title">Tasks</h4>${notionTable(
            ['Name', 'Status'],
            [
              {
                cells: ['Write', 'Todo'],
                href: `Docs%20${id}/Tasks%2022222222222222222222222222222222/Write%2033333333333333333333333333333333.html`,
              },
            ],
          )}</div>`,
        ),
      },
      {
        path: `Export/Docs ${id}/API fedcba9876543210fedcba9876543210.html`,
        content: '<title>API</title><pre><code class="language-ts">x</code></pre>',
      },
      {
        path: `Export/Docs ${id}/Tasks 22222222222222222222222222222222/Write 33333333333333333333333333333333.html`,
        content: notionHtml(
          'Write',
          '<p>Draft</p>',
          '<table class="properties"><tr><th>Status</th><td>Todo</td></tr></table>',
        ),
      },
      { path: 'Export/Deep.htm', content: `${'<div>'.repeat(5000)}x` },
    ]);
    expect(pages.map((p) => [p.title, p.parentKey])).toEqual([
      ['Docs', null],
      ['API', `Docs ${id}`],
    ]);
    expect(pages[0]?.blocks.map((b) => [b.type, b.content])).toEqual([
      ['paragraph', { text: 'Intro', segments: [{ text: 'Intro' }] }],
      ['link_to_page', { pageKey: `Docs ${id}/API fedcba9876543210fedcba9876543210` }],
      ['paragraph', { text: 'Gone', segments: [{ text: 'Gone' }] }],
    ]);
    expect(databases).toEqual([
      {
        key: `Docs ${id}/Tasks 22222222222222222222222222222222`,
        parentKey: `Docs ${id}`,
        name: 'Tasks',
        table: [
          ['Name', 'Status'],
          ['Write', 'Todo'],
        ],
        rowBodies: new Map([
          [
            'Write',
            [
              {
                type: 'paragraph',
                content: { text: 'Draft', segments: [{ text: 'Draft' }] },
                children: [],
              },
            ],
          ],
        ]),
      },
    ]);
    expect(skipped).toEqual(['Export/Deep.htm']);
  });
});

describe('POST /pages/import', () => {
  it('creates the pages with their blocks, and exports them back', async () => {
    const res = await call(
      EDITOR,
      'POST',
      '/pages/import',
      JSON.stringify({
        workspaceId,
        files: [
          {
            path: 'Plan.md',
            content: '# Weekly plan\n\nSome **bold** text\n\n- [ ] task\n    - sub',
          },
          { path: 'Plan/Child.md', content: '## Inside' },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const created = res.json.pages as { id: string; title: string; parentId: string | null }[];
    expect(created.map((p) => p.title)).toEqual(['Weekly plan', 'Child']);
    expect(created[1]?.parentId).toBe(created[0]?.id);

    const rows = await db
      .select()
      .from(blocks)
      .where(eq(blocks.pageId, created[0]?.id as string));
    expect(rows.map((r) => r.type).sort()).toEqual(['bulleted_list_item', 'paragraph', 'todo']);

    const md = await call(EDITOR, 'GET', `/pages/${created[0]?.id}/export?format=md`);
    expect(md.text).toContain('# Weekly plan');
    expect(md.text).toContain('Some **bold** text');
    expect(md.text).toContain('- [ ] task\n    - sub');
    const html = await call(EDITOR, 'GET', `/pages/${created[0]?.id}/export?format=html`);
    expect(html.text).toContain('<strong>bold</strong>');
    expect(html.text).toContain('<input type="checkbox" disabled>');
    const pdf = await call(EDITOR, 'GET', `/pages/${created[0]?.id}/export?format=pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.type).toBe('application/pdf');
    expect(pdf.text.startsWith('%PDF-')).toBe(true);
  });

  it('imports an HTML file: its title, its blocks', async () => {
    const res = await call(
      EDITOR,
      'POST',
      '/pages/import',
      JSON.stringify({
        workspaceId,
        files: [
          {
            path: 'Article.html',
            content:
              '<!doctype html><html><head><title>An article</title><script>alert(1)</script></head><body><h1>An article</h1><p>Some <b>bold</b> and <a href="javascript:x">bad</a> text</p><ul><li><input type="checkbox" checked> done<ul><li>sub</li></ul></li></ul><pre><code class="language-py">print(1)</code></pre></body></html>',
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const created = res.json.pages as { id: string; title: string; parentId: string | null }[];
    expect(created.map((p) => [p.title, p.parentId])).toEqual([['An article', null]]);
    const rows = await blocksOf(created[0]?.id as string);
    const top = rows.filter((r) => r.parentBlockId === null);
    expect(top.map((r) => [r.type, r.content.text])).toEqual([
      ['paragraph', 'Some bold and bad text'],
      ['todo', 'done'],
      ['code', 'print(1)'],
    ]);
    expect(top[0]?.content.segments).toEqual([
      { text: 'Some ' },
      { text: 'bold', bold: true },
      { text: ' and bad text' },
    ]);
    expect(top[1]?.content.checked).toBe(true);
    expect(top[2]?.content.language).toBe('py');
    const sub = rows.find((r) => r.parentBlockId === top[1]?.id);
    expect([sub?.type, sub?.content.text]).toEqual(['bulleted_list_item', 'sub']);
  });

  it('needs edit access where the pages go', async () => {
    const res = await call(
      VIEWER,
      'POST',
      '/pages/import',
      JSON.stringify({ workspaceId, files: [{ path: 'a.md', content: 'x' }] }),
    );
    expect(res.status).toBe(403);
  });
});

describe('POST /pages/import/zip', () => {
  it('imports the Markdown in a ZIP', async () => {
    const zip = zipSync({
      'Export/Docs 0123456789abcdef0123456789abcdef.md': strToU8('# Docs\n\n> 💡 Read me'),
      'Export/Docs 0123456789abcdef0123456789abcdef/API fedcba9876543210fedcba9876543210.md':
        strToU8('```ts\nx\n```'),
    });
    const res = await call(
      EDITOR,
      'POST',
      `/pages/import/zip?workspaceId=${workspaceId}`,
      zip,
      'application/zip',
    );
    expect(res.status).toBe(201);
    expect((res.json.pages as { title: string }[]).map((p) => p.title)).toEqual(['Docs', 'API']);
  });

  it('imports a Notion database: an inline database in its page, rows with their content', async () => {
    const id = '0123456789abcdef0123456789abcdef';
    const zip = zipSync({
      [`Export/Team ${id}.md`]: strToU8('# Team\n\nOur tasks:'),
      [`Export/Team ${id}/Tasks fedcba9876543210fedcba9876543210.csv`]: strToU8(
        'Name,Status\nWrite,Todo\nShip,Done\n',
      ),
      [`Export/Team ${id}/Tasks fedcba9876543210fedcba9876543210/Write 11111111111111111111111111111111.md`]:
        strToU8('# Write\n\nStatus: Todo\n\nDraft the **spec**'),
    });
    const res = await call(
      EDITOR,
      'POST',
      `/pages/import/zip?workspaceId=${workspaceId}`,
      zip,
      'application/zip',
    );
    expect(res.status).toBe(201);
    const team = (res.json.pages as { id: string; title: string }[]).find(
      (p) => p.title === 'Team',
    );
    const [database] = res.json.databases as {
      id: string;
      name: string;
      parentPageId: string;
      rows: number;
    }[];
    expect(database).toMatchObject({ name: 'Tasks', parentPageId: team?.id, rows: 2 });

    const hostBlocks = await db
      .select()
      .from(blocks)
      .where(eq(blocks.pageId, team?.id as string));
    expect(hostBlocks.map((b) => b.type)).toEqual(
      expect.arrayContaining(['paragraph', 'inline_database']),
    );
    const [row] = await db
      .select()
      .from(pages)
      .where(eq(pages.databaseId, database?.id as string))
      .orderBy(pages.order)
      .limit(1);
    const rowBlocks = await db
      .select()
      .from(blocks)
      .where(eq(blocks.pageId, row?.id as string));
    expect(rowBlocks.map((b) => b.content.text)).toEqual(['Draft the spec']);
  });

  it('imports a Notion HTML export: nested pages, links between them, databases with their rows', async () => {
    const docs = `Docs ${'a'.repeat(32)}`;
    const api = `API ${'b'.repeat(32)}`;
    const tasks = `Tasks ${'c'.repeat(32)}`;
    const write = `Write ${'d'.repeat(32)}`;
    const projects = `Projects ${'e'.repeat(32)}`;
    const alpha = `Alpha ${'f'.repeat(32)}`;
    const href = (path: string) => path.split('/').map(encodeURIComponent).join('/');
    const root = `Export-${testScope('html')}`;
    const zip = zipSync({
      [`${root}/${docs}.html`]: strToU8(
        notionHtml(
          'Docs',
          `<p>Read <strong>this</strong></p><figure class="link-to-page"><a href="${href(`${docs}/${api}.html`)}"><span class="icon">📄</span>API</a></figure><figure class="link-to-page"><a href="${href(`${projects}.html`)}">Projects</a></figure><div class="collection-content"><h4 class="collection-title">Tasks</h4>${notionTable(
            ['Name', 'Status'],
            [{ cells: ['Write', 'Todo'], href: href(`${docs}/${tasks}/${write}.html`) }],
          )}</div>`,
        ),
      ),
      [`${root}/${docs}/${api}.html`]: strToU8(
        notionHtml(
          'API',
          '<pre class="code"><code class="language-TypeScript">let x = 1;</code></pre>',
        ),
      ),
      [`${root}/${docs}/${tasks}/${write}.html`]: strToU8(
        notionHtml(
          'Write',
          '<p>Draft the <em>spec</em></p>',
          '<table class="properties"><tbody><tr><th>Status</th><td>Todo</td></tr></tbody></table>',
        ),
      ),
      [`${root}/${projects}.html`]: strToU8(
        notionHtml(
          'Projects',
          notionTable(
            ['Name', 'Done'],
            [
              {
                cells: ['Alpha', '<div class="checkbox checkbox-on"></div>'],
                href: href(`${projects}/${alpha}.html`),
              },
              { cells: ['Beta', '<div class="checkbox checkbox-off"></div>'], href: '' },
            ],
          ),
        ),
      ),
      [`${root}/${projects}/${alpha}.html`]: strToU8(
        notionHtml(
          'Alpha',
          '<ul class="to-do-list"><li><div class="checkbox checkbox-off"></div> <span>Kick off</span></li></ul>',
        ),
      ),
      [`${root}/${docs}/image.png`]: new Uint8Array([1, 2, 3]),
    });
    const res = await call(
      EDITOR,
      'POST',
      `/pages/import/zip?workspaceId=${workspaceId}`,
      zip,
      'application/zip',
    );
    expect(res.status).toBe(201);
    const created = res.json.pages as { id: string; title: string; parentId: string | null }[];
    expect(created.map((p) => p.title)).toEqual(['Docs', 'API']);
    const [docsPage, apiPage] = created;
    expect(docsPage?.parentId).toBeNull();
    expect(apiPage?.parentId).toBe(docsPage?.id);

    const made = res.json.databases as {
      id: string;
      name: string;
      parentPageId: string | null;
      rows: number;
    }[];
    expect(made.map((d) => [d.name, d.parentPageId, d.rows])).toEqual([
      ['Tasks', docsPage?.id, 1],
      ['Projects', null, 2],
    ]);

    const docsBlocks = await blocksOf(docsPage?.id as string);
    expect(docsBlocks.map((b) => b.type)).toEqual(['paragraph', 'link_to_page', 'inline_database']);
    expect(docsBlocks[0]?.content.segments).toEqual([
      { text: 'Read ' },
      { text: 'this', bold: true },
    ]);
    expect(docsBlocks[1]?.content.pageId).toBe(apiPage?.id);
    expect(docsBlocks[2]?.content.databaseId).toBe(made[0]?.id);
    const apiBlocks = await blocksOf(apiPage?.id as string);
    expect(apiBlocks.map((b) => [b.type, b.content.text, b.content.language])).toEqual([
      ['code', 'let x = 1;', 'typescript'],
    ]);

    const rowsOf = (databaseId: string) =>
      db.select().from(pages).where(eq(pages.databaseId, databaseId)).orderBy(asc(pages.order));
    const [writeRow] = await rowsOf(made[0]?.id as string);
    expect(writeRow?.title).toBe('Write');
    expect((await blocksOf(writeRow?.id as string)).map((b) => b.content.text)).toEqual([
      'Draft the spec',
    ]);
    const projectRows = await rowsOf(made[1]?.id as string);
    expect(projectRows.map((r) => r.title)).toEqual(['Alpha', 'Beta']);
    expect(
      (await blocksOf(projectRows[0]?.id as string)).map((b) => [
        b.type,
        b.content.text,
        b.content.checked,
      ]),
    ).toEqual([['todo', 'Kick off', false]]);
    const [projectsDb] = await db
      .select()
      .from(databasesTable)
      .where(eq(databasesTable.id, made[1]?.id as string));
    expect(projectsDb?.propertiesSchema.properties.map((p) => [p.name, p.type])).toEqual([
      ['Name', 'text'],
      ['Done', 'checkbox'],
    ]);
  });

  it('refuses what is not a ZIP', async () => {
    const res = await call(
      EDITOR,
      'POST',
      `/pages/import/zip?workspaceId=${workspaceId}`,
      'not a zip',
      'application/zip',
    );
    expect(res.status).toBe(400);
  });
});

describe('database CSV', () => {
  it('imports a CSV as a database and exports it back', async () => {
    const created = await call(
      EDITOR,
      'POST',
      '/databases/import/csv',
      JSON.stringify({
        workspaceId,
        name: 'Budget',
        csv: 'Item,Cost,Paid\nRent,1200,Yes\nFood,300,No\n',
      }),
    );
    expect(created.status).toBe(201);
    const database = created.json.database as { id: string };
    expect(created.json.rows).toBe(2);
    const exported = await call(EDITOR, 'GET', `/databases/${database.id}/export?format=csv`);
    expect(exported.status).toBe(200);
    expect(exported.text.replace(/^\uFEFF/, '')).toBe(
      'Item,Cost,Paid\r\nRent,1200,Yes\r\nFood,300,No\r\n',
    );
  });
});
