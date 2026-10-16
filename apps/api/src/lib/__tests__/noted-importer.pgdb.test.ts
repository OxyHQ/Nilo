/**
 * The Noted import against PostgreSQL on the Nilo side, with Noted's data
 * given in memory: notes arrive under their ids with their content, labels,
 * folder, revisions and artifacts; a reminder that went off stays delivered;
 * a second run changes nothing.
 */
import { uuidv7 } from '@oxy.so/db';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../../db/client.js';
import { reminders } from '../../db/schema/collab.js';
import { pages, pageVersions } from '../../db/schema/pages.js';
import { workspaces } from '../../db/schema/workspaces.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticateToken: vi.fn(),
  oxyClient: { users: { get: async () => null } },
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { ensurePersonalNotesHome } = await import('../../middleware/workspace.js');
const { importNotedAccount } = await import('../noted-importer.js');
const { getDb } = await import('../../db/client.js');
const { readNotes, findNoteRow, listFolders, labelOptions } = await import(
  '../../repositories/notes.js'
);
type Source = import('../noted-importer.js').NotedSource;
type NotedNote = import('../noted-import.js').NotedNote;

let db: TestDatabase;
let previousUrl: string | undefined;
const scope = testScope('noted-import');
const USER = `${scope}-user`;

const ids = { kept: uuidv7(), trashed: uuidv7(), voice: uuidv7() };
const base = {
  oxyUserId: USER,
  kind: 'note',
  checklist: [],
  labels: [],
  folderId: null,
  pinned: false,
  archived: false,
  trashed: false,
  attachments: [],
  reminderAt: null,
  reminderSentAt: null,
  sortOrder: 0,
  createdAt: new Date('2026-09-01T10:00:00Z'),
} satisfies Partial<NotedNote>;

const source: Source = {
  users: async () => [USER],
  labels: async () => [
    { id: 'l-work', name: 'Work', color: 'teal' },
    { id: 'l-home', name: 'Home', color: null },
  ],
  folders: async () => [
    { id: 'f-sub', name: 'Sub', parentId: 'f-top' },
    { id: 'f-top', name: 'Top', parentId: null },
  ],
  notes: async () => [
    {
      ...base,
      id: ids.kept,
      title: 'Plan',
      body: '## Week\n\n- Call',
      checklist: [{ id: 'c', text: 'Buy milk', checked: true }],
      color: 'darkblue',
      labels: ['l-work', 'l-unknown'],
      folderId: 'f-sub',
      pinned: true,
      reminderAt: new Date(Date.now() - 3_600_000),
      reminderSentAt: new Date(Date.now() - 3_500_000),
    },
    { ...base, id: ids.trashed, title: 'Old', body: 'bye', color: 'yellow', trashed: true },
    {
      ...base,
      id: ids.voice,
      kind: 'voice',
      title: 'Standup',
      body: 'Notes',
      color: 'default',
      reminderAt: new Date(Date.now() + 86_400_000),
    },
  ],
  revisions: async (_user, noteIds) =>
    noteIds.includes(ids.kept)
      ? [
          {
            noteId: ids.kept,
            title: 'Plan',
            body: 'first draft',
            checklist: [],
            createdAt: new Date('2026-09-02T00:00:00Z'),
          },
        ]
      : [],
  appData: async (_user, noteIds) =>
    new Map(
      noteIds.includes(ids.voice)
        ? [[ids.voice, { artifacts: [{ id: 'a1', stage: 'final' }], itemOverrides: [] }]]
        : [],
    ),
};

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
});

afterAll(async () => {
  await db.delete(workspaces).where(like(workspaces.ownerId, `${scope}%`));
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousUrl;
});

describe('importNotedAccount', () => {
  it('reports without writing on a dry run', async () => {
    const home = await ensurePersonalNotesHome(USER);
    const report = await importNotedAccount(getDb(), source, home, { dryRun: true });
    expect(report.notes).toEqual({ created: 3, skipped: 0, trashed: 1 });
    expect(await findNoteRow(getDb(), home, ids.kept)).toBeNull();
  });

  it('copies every note under its id, with what belongs to it', async () => {
    const home = await ensurePersonalNotesHome(USER);
    const report = await importNotedAccount(getDb(), source, home, { dryRun: false });
    expect(report).toMatchObject({
      labels: { created: 2, matched: 0 },
      folders: { created: 2, matched: 0 },
      notes: { created: 3, skipped: 0, trashed: 1 },
      revisions: 1,
      reminders: { pending: 1, done: 1 },
    });

    const fresh = await ensurePersonalNotesHome(USER);
    const rows = await db.select().from(pages).where(eq(pages.databaseId, fresh.notes.id));
    const notes = await readNotes(getDb(), fresh, rows);
    const kept = notes.find((n) => n.id === ids.kept);
    const work = labelOptions(fresh).find((o) => o.name === 'Work');
    const sub = (await listFolders(getDb(), fresh)).find((f) => f.name === 'Sub');
    expect(kept).toMatchObject({
      title: 'Plan',
      color: 'blue',
      labels: [work?.id],
      folderId: sub?.id,
      pinned: true,
      createdAt: '2026-09-01T10:00:00.000Z',
    });
    expect(kept?.blocks.map((b) => [b.type, b.content.text])).toEqual([
      ['heading_2', 'Week'],
      ['bulleted_list_item', 'Call'],
      ['todo', 'Buy milk'],
    ]);
    expect(notes.find((n) => n.id === ids.trashed)?.trashed).toBe(true);
    expect(notes.find((n) => n.id === ids.voice)).toMatchObject({
      kind: 'voice',
      appData: {
        data: { artifacts: [{ id: 'a1', stage: 'final' }], itemOverrides: [] },
        revision: 1,
      },
    });

    // The past reminder is copied as delivered, so it never rings again.
    const [past] = await db
      .select()
      .from(reminders)
      .where(and(eq(reminders.pageId, ids.kept), eq(reminders.userId, USER)));
    expect(past?.sentAt).not.toBeNull();
    const [future] = await db.select().from(reminders).where(eq(reminders.pageId, ids.voice));
    expect(future?.sentAt).toBeNull();

    const versions = await db.select().from(pageVersions).where(eq(pageVersions.pageId, ids.kept));
    expect(versions.map((v) => v.blocks.map((b) => b.content.text))).toContainEqual([
      'first draft',
    ]);
  });

  it('changes nothing when run again', async () => {
    const home = await ensurePersonalNotesHome(USER);
    const report = await importNotedAccount(getDb(), source, home, { dryRun: false });
    expect(report).toMatchObject({
      labels: { created: 0, matched: 2 },
      folders: { created: 0, matched: 2 },
      notes: { created: 0, skipped: 3 },
      revisions: 0,
    });
  });
});
