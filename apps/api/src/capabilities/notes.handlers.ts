/**
 * The notes catalog's tools (`notes.catalog.ts`), over the caller's personal
 * workspace notes, through the same writes as `/notes` (`lib/notes.ts`).
 *
 * Every effectful tool runs once per idempotency key (`idempotency.ts`): the
 * write, its receipt and the event for Alia commit together. Clients with the
 * notes open (Nilo, Noted) are told after the commit, and only when the call
 * was not a replay.
 */
import {
  blocksToMarkdown,
  blocksToTree,
  type Note,
  type NoteBlock,
  type NoteColor,
  type NoteLabel,
  type NoteWrite,
} from '@oxy.so/nilo-contracts';
import type { CatalogToolHandler, CatalogToolHandlers } from '@oxy.so/mcp';
import { isLiveEntityId } from '@oxy.so/db';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { announceChange } from '../collab/live-rooms.js';
import { getDb, type PgHandle } from '../db/client.js';
import { reminders } from '../db/schema/collab.js';
import { pages } from '../db/schema/pages.js';
import {
  createLabel as createNoteLabel,
  createNote as createNoteRow,
  deleteLabel as deleteNoteLabel,
  NoteRejected,
  updateLabel as updateNoteLabel,
  updateNote as updateNoteRow,
} from '../lib/notes.js';
import { notedBlocks, notedColor } from '../lib/noted-import.js';
import { ensurePersonalNotesHome } from '../middleware/workspace.js';
import {
  findNoteRow,
  labelOptions,
  listNoteRows,
  type NotesHome,
  readNotes,
  toLabel,
} from '../repositories/notes.js';
import { executeIdempotently } from './idempotency.js';
import { NOTES_CAPABILITY_CATALOG } from './notes.catalog.js';
import { enqueueNoteChanged, type NoteChange } from './notes.events.js';

export class NotesCapabilityError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'NotesCapabilityError';
  }
}

type Input = Readonly<Record<string, unknown>>;
type ToolExecutor = (input: Input, accountId: string) => Promise<Record<string, unknown>>;

const DEFAULT_LIMIT = 50;

function invalid(message: string): never {
  throw new NotesCapabilityError('invalid_input', message, 400);
}

function requiredString(input: Input, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) invalid(`${key} is required`);
  return value;
}

function optionalString(input: Input, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function entityId(input: Input, key: string): string {
  const value = requiredString(input, key);
  if (!isLiveEntityId(value)) invalid(`${key} is not a valid id`);
  return value;
}

function stringArray(input: Input, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    invalid(`${key} must be a string array`);
  }
  return [...new Set(value as string[])];
}

const limitOf = (input: Input) => (typeof input.limit === 'number' ? input.limit : DEFAULT_LIMIT);

/** An instant the caller gave, or a refusal: `new Date` would take garbage as Invalid Date. */
function instant(value: string, key: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) invalid(`${key} is not a date`);
  return date;
}

/** The note as an agent reads it: its content as Markdown, not blocks. */
function agentNote(note: Note, withAppData = false): Record<string, unknown> {
  return {
    id: note.id,
    title: note.title,
    body: blocksToMarkdown(blocksToTree(note.blocks)).trim(),
    color: note.color,
    labels: note.labels,
    folderId: note.folderId,
    pinned: note.pinned,
    archived: note.archived,
    trashed: note.trashed,
    kind: note.kind,
    reminderAt: note.reminderAt,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    ...(withAppData && { appData: note.appData?.data ?? null }),
  };
}

const agentLabel = (label: NoteLabel): Record<string, unknown> => ({ ...label });

/** Nilo's refusal, in the catalog's words. */
function translated(error: unknown): never {
  if (error instanceof NoteRejected) {
    switch (error.code) {
      case 'UNKNOWN_LABEL':
        throw new NotesCapabilityError('label_not_found', error.message, 404);
      case 'LABEL_EXISTS':
        throw new NotesCapabilityError('label_exists', error.message, 409);
      case 'PAGE_LOCKED':
        throw new NotesCapabilityError('note_locked', error.message, 423);
      default:
        throw new NotesCapabilityError(
          error.status >= 500 ? 'capability_execution_failed' : 'invalid_input',
          error.message,
          error.status,
        );
    }
  }
  throw error;
}

async function readOne(db: PgHandle, home: NotesHome, id: string): Promise<Note | null> {
  const row = await findNoteRow(db, home, id);
  if (!row) return null;
  const [note] = await readNotes(db, home, [row]);
  return note ?? null;
}

/**
 * Run one effectful call: once per idempotency key, its event queued with it,
 * and clients told afterwards.
 */
async function effect<Result extends Record<string, unknown>>(
  tool: string,
  input: Input,
  accountId: string,
  run: (tx: PgHandle, home: NotesHome) => Promise<{ result: Result; event?: NoteEvent }>,
): Promise<Result> {
  const home = await ensurePersonalNotesHome(accountId);
  const key = requiredString(input, 'idempotencyKey');
  const execution = await executeIdempotently({
    accountId,
    tool,
    idempotencyKey: key,
    request: input,
    execute: async (tx) => {
      const { result, event } = await run(tx, home).catch(translated);
      if (event) {
        await enqueueNoteChanged(tx, {
          accountId,
          noteId: event.noteId,
          change: event.change,
          key,
          occurredAt: event.occurredAt,
        });
      }
      return result;
    },
  });
  if (!execution.replayed)
    announceChange({ workspaceId: home.workspaceId, databaseId: home.notes.id });
  return execution.result;
}

interface NoteEvent {
  noteId: string;
  change: NoteChange;
  occurredAt: string;
}

/** Write `write` on the note and answer it, with the event it makes. */
async function writeNote(
  tx: PgHandle,
  home: NotesHome,
  accountId: string,
  noteId: string,
  write: NoteWrite,
  change: NoteChange,
): Promise<{ result: { note: Record<string, unknown> }; event: NoteEvent }> {
  if (!(await updateNoteRow(tx, home, noteId, write, accountId))) {
    throw new NotesCapabilityError('note_not_found', 'Note not found', 404);
  }
  const note = (await readOne(tx, home, noteId)) as Note;
  return {
    result: { note: agentNote(note) },
    event: { noteId, change, occurredAt: note.updatedAt },
  };
}

const blocksOf = (body: string): NoteBlock[] => notedBlocks(body, []);

// ── Tools ────────────────────────────────────────────────────────────

/** Accent- and case-insensitive. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

async function searchNotes(input: Input, accountId: string) {
  const home = await ensurePersonalNotesHome(accountId);
  const db = getDb();
  const view = input.view === 'archived' || input.view === 'trashed' ? input.view : 'active';
  const rows = await listNoteRows(db, home, {
    view,
    label: optionalString(input, 'labelId'),
    pinned: typeof input.pinned === 'boolean' ? input.pinned : undefined,
  });
  const query = fold(optionalString(input, 'query')?.trim() ?? '');
  const limit = limitOf(input);
  if (!query)
    return { notes: (await readNotes(db, home, rows.slice(0, limit))).map((n) => agentNote(n)) };
  const found: Record<string, unknown>[] = [];
  // Read in pages, so a search stops reading once it has enough.
  for (let at = 0; at < rows.length && found.length < limit; at += 100) {
    for (const note of await readNotes(db, home, rows.slice(at, at + 100))) {
      const shown = agentNote(note);
      if (fold(`${note.title}\n${shown.body as string}`).includes(query)) found.push(shown);
      if (found.length === limit) break;
    }
  }
  return { notes: found };
}

async function readNote(input: Input, accountId: string) {
  const home = await ensurePersonalNotesHome(accountId);
  const note = await readOne(getDb(), home, entityId(input, 'noteId'));
  if (!note) throw new NotesCapabilityError('note_not_found', 'Note not found', 404);
  return { note: agentNote(note, true) };
}

function noteFields(input: Input): NoteWrite {
  const write: NoteWrite = {};
  const title = optionalString(input, 'title');
  if (title !== undefined) write.title = title;
  const body = optionalString(input, 'body');
  if (body !== undefined) write.blocks = blocksOf(body);
  if (input.color !== undefined) write.color = notedColor(input.color) as NoteColor;
  const labels = stringArray(input, 'labelIds');
  if (labels !== undefined) write.labels = labels;
  if (typeof input.pinned === 'boolean') write.pinned = input.pinned;
  return write;
}

function createNote(input: Input, accountId: string) {
  const write = noteFields(input);
  const reminderAt = optionalString(input, 'reminderAt');
  if (reminderAt) write.reminderAt = instant(reminderAt, 'reminderAt').toISOString();
  return effect('createNote', input, accountId, async (tx, home) => {
    const { id } = await createNoteRow(tx, home, write, accountId);
    const note = (await readOne(tx, home, id)) as Note;
    return {
      result: { note: agentNote(note) },
      event: { noteId: id, change: 'created', occurredAt: note.updatedAt },
    };
  });
}

function updateNote(input: Input, accountId: string) {
  const noteId = entityId(input, 'noteId');
  const write = noteFields(input);
  if (Object.keys(write).length === 0) invalid('No note fields to update');
  return effect('updateNote', input, accountId, (tx, home) =>
    writeNote(tx, home, accountId, noteId, write, 'updated'),
  );
}

function setNoteState(tool: 'archiveNote' | 'restoreNote', input: Input, accountId: string) {
  const noteId = entityId(input, 'noteId');
  const archived = tool === 'archiveNote';
  return effect(tool, input, accountId, (tx, home) =>
    writeNote(
      tx,
      home,
      accountId,
      noteId,
      { archived, trashed: false },
      archived ? 'archived' : 'restored',
    ),
  );
}

async function listLabels(_input: Input, accountId: string) {
  const home = await ensurePersonalNotesHome(accountId);
  const labels = labelOptions(home)
    .map(toLabel)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { labels: labels.map(agentLabel) };
}

const labelColorOf = (input: Input): NoteColor | null | undefined =>
  input.color === undefined
    ? undefined
    : input.color === null
      ? null
      : (notedColor(input.color) as NoteColor);

function createLabel(input: Input, accountId: string) {
  const name = requiredString(input, 'name').trim();
  if (!name) invalid('name cannot be blank');
  return effect('createLabel', input, accountId, async (tx, home) => {
    const option = await createNoteLabel(tx, home, { name, color: labelColorOf(input) });
    return { result: { label: agentLabel(toLabel(option)) } };
  });
}

function updateLabel(input: Input, accountId: string) {
  const labelId = requiredString(input, 'labelId');
  const name = optionalString(input, 'name')?.trim();
  if (name === '') invalid('name cannot be blank');
  const color = labelColorOf(input);
  if (name === undefined && color === undefined) invalid('No label fields to update');
  return effect('updateLabel', input, accountId, async (tx, home) => {
    const option = await updateNoteLabel(tx, home, labelId, {
      ...(name !== undefined && { name }),
      ...(color !== undefined && { color }),
    });
    if (!option) throw new NotesCapabilityError('label_not_found', 'Label not found', 404);
    return { result: { label: agentLabel(toLabel(option)) } };
  });
}

function deleteLabel(input: Input, accountId: string) {
  const labelId = requiredString(input, 'labelId');
  return effect('deleteLabel', input, accountId, async (tx, home) => ({
    result: { deleted: await deleteNoteLabel(tx, home, labelId), labelId },
  }));
}

async function listReminders(input: Input, accountId: string) {
  const home = await ensurePersonalNotesHome(accountId);
  const db = getDb();
  const conditions = [
    eq(reminders.userId, accountId),
    isNull(reminders.blockId),
    eq(pages.databaseId, home.notes.id),
    eq(pages.archived, false),
  ];
  const dueBefore = optionalString(input, 'dueBefore');
  if (dueBefore) conditions.push(lte(reminders.remindAt, instant(dueBefore, 'dueBefore')));
  if (input.includeDelivered !== true) conditions.push(isNull(reminders.sentAt));
  const rows = await db
    .select({ page: pages })
    .from(reminders)
    .innerJoin(pages, eq(pages.id, reminders.pageId))
    .where(and(...conditions))
    .orderBy(asc(reminders.remindAt))
    .limit(limitOf(input));
  const notes = await readNotes(
    db,
    home,
    rows.map((row) => row.page),
  );
  return { notes: notes.map((note) => agentNote(note)) };
}

function setReminder(input: Input, accountId: string) {
  const noteId = entityId(input, 'noteId');
  if (input.reminderAt !== null && typeof input.reminderAt !== 'string') {
    invalid('reminderAt is required');
  }
  const reminderAt =
    input.reminderAt === null
      ? null
      : instant(input.reminderAt as string, 'reminderAt').toISOString();
  return effect('setReminder', input, accountId, (tx, home) =>
    writeNote(tx, home, accountId, noteId, { reminderAt }, 'updated'),
  );
}

const TOOL_EXECUTORS: Readonly<Record<string, ToolExecutor>> = {
  searchNotes,
  readNote,
  createNote,
  updateNote,
  archiveNote: (input, accountId) => setNoteState('archiveNote', input, accountId),
  restoreNote: (input, accountId) => setNoteState('restoreNote', input, accountId),
  listLabels,
  createLabel,
  updateLabel,
  deleteLabel,
  listReminders,
  setReminder,
};

const catalogToolNames = NOTES_CAPABILITY_CATALOG.tools.map(({ name }) => name);
const missing = catalogToolNames.filter((name) => !TOOL_EXECUTORS[name]);
const extra = Object.keys(TOOL_EXECUTORS).filter((name) => !catalogToolNames.includes(name));
if (missing.length > 0 || extra.length > 0) {
  throw new Error(
    `Notes catalog handler mismatch: missing=${missing.join(',')} extra=${extra.join(',')}`,
  );
}

export async function executeNotesTool(
  toolName: string,
  input: Input,
  effectiveAccountId: string,
): Promise<Record<string, unknown>> {
  const executor = TOOL_EXECUTORS[toolName];
  if (!executor) throw new NotesCapabilityError('unknown_tool', 'Unknown notes tool', 404);
  return executor(input, effectiveAccountId);
}

export const NOTES_MCP_HANDLERS: CatalogToolHandlers = Object.fromEntries(
  Object.keys(TOOL_EXECUTORS).map((toolName) => {
    const handler: CatalogToolHandler = async (input, context) => ({
      structuredContent: await executeNotesTool(toolName, input, context.principal.activeAccountId),
    });
    return [toolName, handler];
  }),
);
