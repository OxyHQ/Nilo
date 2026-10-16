/**
 * The notes catalog's tools against PostgreSQL: what Alia and MCP clients do
 * to a person's notes, each write applied once per idempotency key, with the
 * event for Alia queued in its transaction and delivered by the outbox.
 */
import type { NormalizedAppEvent } from '@oxy.so/contracts';
import { and, eq, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '../../db/client.js';
import {
  closeTestDb,
  getTestDb,
  type TestDatabase,
  testDatabaseUrl,
  testScope,
} from '../../db/__tests__/testDatabase.js';
import { appEventOutbox, capabilityExecutions } from '../../db/schema/capabilities.js';
import { reminders } from '../../db/schema/collab.js';
import { workspaces } from '../../db/schema/workspaces.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticateToken: (_req: unknown, _res: unknown, next: () => void) => next(),
  oxyClient: {
    middleware: { auth: () => (_req: unknown, _res: unknown, next: () => void) => next() },
    users: { get: async () => ({ username: 'ada' }) },
  },
}));
vi.mock('../../socket.js', () => ({ getIO: () => null }));
vi.mock('../../lib/notification-service.js', () => ({ sendNotification: vi.fn(async () => ({})) }));
vi.mock('../../lib/logger.js', () => ({
  log: { general: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const { executeNotesTool, NotesCapabilityError } = await import('../notes.handlers.js');
const { IdempotencyConflictError } = await import('../idempotency.js');
const { runEventOutboxBatch } = await import('../event-outbox.js');
const { deliverDueReminders } = await import('../../lib/reminders.js');

let db: TestDatabase;
let previousUrl: string | undefined;
const scope = testScope('notes-capabilities');
const USER = `${scope}-user`;
const OTHER = `${scope}-other`;

type Json = Record<string, unknown>;
type AgentNote = {
  id: string;
  title: string;
  body: string;
  labels: string[];
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  reminderAt: string | null;
  appData?: unknown;
};

let keys = 0;
const key = () => `${scope}-key-${++keys}`;
const run = (tool: string, input: Json, user = USER) => executeNotesTool(tool, input, user);
const noteOf = (result: Json) => result.note as AgentNote;

async function eventsFor(noteId: string): Promise<NormalizedAppEvent[]> {
  const rows = await db.select().from(appEventOutbox);
  return rows.map((row) => row.event).filter((event) => event.resource.resourceId === noteId);
}

beforeAll(async () => {
  db = await getTestDb();
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
});

afterAll(async () => {
  await db.delete(workspaces).where(like(workspaces.ownerId, `${scope}%`));
  await db.delete(capabilityExecutions).where(like(capabilityExecutions.accountId, `${scope}%`));
  await db.delete(appEventOutbox).where(sql`${appEventOutbox.event}::text like ${`%${scope}%`}`);
  await closeDb();
  await closeTestDb();
  process.env.DATABASE_URL = previousUrl;
});

describe('notes', () => {
  it('creates a note from Markdown and reads it back as Markdown, with an event for Alia', async () => {
    const created = noteOf(
      await run('createNote', {
        idempotencyKey: key(),
        title: 'Groceries',
        body: '# Week\n\n- [ ] Milk\n- [x] Bread\n\nRemember the **coffee**.',
        color: 'blue',
      }),
    );
    expect(created.title).toBe('Groceries');
    expect(created.body).toContain('- [ ] Milk');
    expect(created.body).toContain('- [x] Bread');
    expect(created.body).toContain('**coffee**');

    const read = noteOf(await run('readNote', { noteId: created.id }));
    expect(read).toMatchObject({ id: created.id, title: 'Groceries', appData: null });

    const events = await eventsFor(created.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      appId: 'noted',
      accountId: USER,
      type: 'note_changed',
      data: { noteId: created.id, change: 'created' },
    });
  });

  it('applies a write once per idempotency key, and refuses the key with other input', async () => {
    const idempotencyKey = key();
    const first = noteOf(await run('createNote', { idempotencyKey, title: 'Once' }));
    const again = noteOf(await run('createNote', { idempotencyKey, title: 'Once' }));
    expect(again.id).toBe(first.id);
    const found = (await run('searchNotes', { query: 'Once' })).notes as AgentNote[];
    expect(found.map((note) => note.id)).toEqual([first.id]);
    expect(await eventsFor(first.id)).toHaveLength(1);

    await expect(run('createNote', { idempotencyKey, title: 'Twice' })).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
  });

  it('searches titles and text, accents and case aside, within a view', async () => {
    const note = noteOf(
      await run('createNote', { idempotencyKey: key(), title: 'Café plans', body: 'Meet Ánder' }),
    );
    const byTitle = (await run('searchNotes', { query: 'cafe' })).notes as AgentNote[];
    expect(byTitle.map((n) => n.id)).toContain(note.id);
    const byBody = (await run('searchNotes', { query: 'ANDER' })).notes as AgentNote[];
    expect(byBody.map((n) => n.id)).toEqual([note.id]);
    const archived = (await run('searchNotes', { query: 'cafe', view: 'archived' }))
      .notes as AgentNote[];
    expect(archived).toEqual([]);
  });

  it('updates fields and content, archives and restores, each with its event', async () => {
    const note = noteOf(await run('createNote', { idempotencyKey: key(), title: 'Draft' }));
    const updated = noteOf(
      await run('updateNote', {
        idempotencyKey: key(),
        noteId: note.id,
        title: 'Final',
        body: 'Done.',
        pinned: true,
      }),
    );
    expect(updated).toMatchObject({ title: 'Final', body: 'Done.', pinned: true });

    const archived = noteOf(await run('archiveNote', { idempotencyKey: key(), noteId: note.id }));
    expect(archived).toMatchObject({ archived: true, trashed: false });
    const restored = noteOf(await run('restoreNote', { idempotencyKey: key(), noteId: note.id }));
    expect(restored).toMatchObject({ archived: false, trashed: false });

    const changes = (await eventsFor(note.id)).map((event) => event.data.change);
    expect(changes.sort()).toEqual(['archived', 'created', 'restored', 'updated']);
  });

  it('refuses an update with nothing in it, and a note that is not the caller’s', async () => {
    const note = noteOf(await run('createNote', { idempotencyKey: key(), title: 'Mine' }));
    await expect(
      run('updateNote', { idempotencyKey: key(), noteId: note.id }),
    ).rejects.toMatchObject({ code: 'invalid_input', status: 400 });
    await expect(run('readNote', { noteId: note.id }, OTHER)).rejects.toMatchObject({
      code: 'note_not_found',
      status: 404,
    });
    await expect(
      run('updateNote', { idempotencyKey: key(), noteId: note.id, title: 'Theirs' }, OTHER),
    ).rejects.toBeInstanceOf(NotesCapabilityError);
    expect(noteOf(await run('readNote', { noteId: note.id })).title).toBe('Mine');
  });
});

describe('labels', () => {
  it('creates, lists, renames and deletes a label, and a note loses it with it', async () => {
    const label = (await run('createLabel', { idempotencyKey: key(), name: 'Work', color: 'red' }))
      .label as { id: string; name: string; color: string };
    expect(label).toMatchObject({ name: 'Work', color: 'red' });
    await expect(run('createLabel', { idempotencyKey: key(), name: 'work' })).rejects.toMatchObject(
      { code: 'label_exists', status: 409 },
    );

    const note = noteOf(
      await run('createNote', { idempotencyKey: key(), title: 'Tagged', labelIds: [label.id] }),
    );
    expect(note.labels).toEqual([label.id]);
    const tagged = (await run('searchNotes', { labelId: label.id })).notes as AgentNote[];
    expect(tagged.map((n) => n.id)).toEqual([note.id]);

    const renamed = (
      await run('updateLabel', { idempotencyKey: key(), labelId: label.id, name: 'Job' })
    ).label as { name: string };
    expect(renamed.name).toBe('Job');
    const listed = (await run('listLabels', {})).labels as { name: string }[];
    expect(listed.map((l) => l.name)).toContain('Job');

    expect(await run('deleteLabel', { idempotencyKey: key(), labelId: label.id })).toEqual({
      deleted: true,
      labelId: label.id,
    });
    expect(noteOf(await run('readNote', { noteId: note.id })).labels).toEqual([]);
  });

  it('refuses a note naming a label that does not exist', async () => {
    await expect(
      run('createNote', { idempotencyKey: key(), title: 'x', labelIds: ['missing'] }),
    ).rejects.toMatchObject({ code: 'label_not_found', status: 404 });
  });
});

describe('reminders', () => {
  it('sets, lists and clears a reminder; when it fires, Alia gets a reminder event', async () => {
    const note = noteOf(await run('createNote', { idempotencyKey: key(), title: 'Call mum' }));
    const at = new Date(Date.now() + 60_000).toISOString();
    const set = noteOf(
      await run('setReminder', { idempotencyKey: key(), noteId: note.id, reminderAt: at }),
    );
    expect(set.reminderAt).toBe(at);
    const due = (await run('listReminders', {})).notes as AgentNote[];
    expect(due.map((n) => n.id)).toContain(note.id);

    await deliverDueReminders(getDb(), new Date(Date.now() + 120_000));
    const [fired] = (await eventsFor(note.id)).filter((event) => event.type === 'reminder');
    expect(fired).toMatchObject({ data: { noteId: note.id, reminderAt: at } });
    expect((await run('listReminders', {})).notes as AgentNote[]).not.toContainEqual(
      expect.objectContaining({ id: note.id }),
    );
    expect(
      ((await run('listReminders', { includeDelivered: true })).notes as AgentNote[]).map(
        (n) => n.id,
      ),
    ).toContain(note.id);

    const cleared = noteOf(
      await run('setReminder', { idempotencyKey: key(), noteId: note.id, reminderAt: null }),
    );
    expect(cleared.reminderAt).toBeNull();
    const left = await db
      .select()
      .from(reminders)
      .where(and(eq(reminders.pageId, note.id), eq(reminders.userId, USER)));
    expect(left).toEqual([]);
  });
});

describe('the event outbox', () => {
  it('delivers each event once and keeps a failed one for the next lease', async () => {
    const note = noteOf(await run('createNote', { idempotencyKey: key(), title: 'Outbox' }));
    const delivered: string[] = [];
    let fail = true;
    const deliver = async (event: NormalizedAppEvent) => {
      if (event.resource.resourceId === note.id && fail) throw new Error('Alia is down');
      delivered.push(event.eventId);
    };
    const owner = `${scope}-worker`;
    const first = await runEventOutboxBatch({ ownerId: owner, deliver, batchSize: 500 });
    expect(first.failed).toBeGreaterThanOrEqual(1);

    fail = false;
    const later = await runEventOutboxBatch({
      ownerId: owner,
      deliver,
      batchSize: 500,
      leaseMs: 0,
    });
    expect(later.processed).toBeGreaterThanOrEqual(1);
    const [event] = await eventsFor(note.id);
    expect(delivered).toContain(event?.eventId);
    const [row] = await db
      .select()
      .from(appEventOutbox)
      .where(eq(appEventOutbox.eventId, event?.eventId as string));
    expect(row?.processedAt).not.toBeNull();
    expect(row?.attempts).toBe(2);

    await runEventOutboxBatch({ ownerId: owner, deliver, batchSize: 500, leaseMs: 0 });
    expect(delivered.filter((id) => id === event?.eventId)).toHaveLength(1);
  });
});
