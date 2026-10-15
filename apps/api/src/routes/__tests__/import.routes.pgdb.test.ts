/**
 * Import and export against PostgreSQL: Markdown files with folders, a
 * Notion-style ZIP, and exporting the result back to Markdown and HTML.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import express from 'express';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { blocks, pages } from '../../db/schema/pages.js';
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
  oxyClient: {},
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
  return { status: res.status, text, json };
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
