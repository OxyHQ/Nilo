/**
 * `/notes`: Noted's API. Every route works in the caller's personal workspace,
 * on its `notes` and `note_folders` system databases (`lib/databases/system.ts`),
 * which it provisions on first use. Contract: `@oxy.so/nilo-contracts` `notes.ts`.
 *
 * A note's history is the page's (`/pages/:id/versions`), and the routes for
 * it are not repeated here.
 */
import { randomUUID } from 'node:crypto';
import {
  type Note,
  noteCreateSchema,
  noteFolderWriteSchema,
  noteLabelWriteSchema,
  type NotesExport,
  type NotesSyncPage,
  type NoteWrite,
  noteWriteSchema,
} from '@oxy.so/nilo-contracts';
import { isLiveEntityId } from '@oxy.so/db';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { enqueueNoteChanged, type NoteChange } from '../capabilities/notes.events.js';
import { announceChange } from '../collab/live-rooms.js';
import { getDb, type PgHandle } from '../db/client.js';
import { and, asc, eq } from 'drizzle-orm';
import { PAGE_TOMBSTONE_RETENTION_MS, pages } from '../db/schema/pages.js';
import { log } from '../lib/logger.js';
import {
  createFolder,
  createLabel,
  createNote,
  deleteFolder,
  deleteLabel,
  deleteNote,
  eraseNotes,
  NoteRejected,
  reorderNotes,
  updateFolder,
  updateLabel,
  updateNote,
} from '../lib/notes.js';
import { authenticateToken } from '../middleware/auth.js';
import { ensurePersonalNotesHome } from '../middleware/workspace.js';
import { NotesMaintenanceBusy } from '../lib/notes-maintenance-lock.js';
import {
  lockNotesGeneration,
  notesGenerationConfig,
  NotesGenerationChanged,
  NotesGenerationUnavailable,
} from '../lib/notes-generation.js';
import { findDatabaseById } from '../repositories/databases.js';
import {
  findNoteRow,
  labelOptions,
  listFolders,
  listNoteRows,
  type NotesHome,
  noteRowsChangedSince,
  noteTombstonesSince,
  readNotes,
  syncWatermark,
  toLabel,
} from '../repositories/notes.js';

const router = Router();
router.use(authenticateToken);
// Never silently accept a generation-aware request while the protocol is off.
router.use((req, res, next) => {
  if (
    !notesGenerationConfig.enabled &&
    (req.get('X-Notes-Generation') !== undefined ||
      (req.path === '/sync' && req.query.generationAware === '1'))
  ) {
    res
      .status(503)
      .json({ error: 'Notes generation is unavailable', code: 'NOTES_GENERATION_UNAVAILABLE' });
    return;
  }
  if (notesGenerationConfig.enabled && req.get('X-Notes-Generation') !== undefined) {
    const supported =
      (req.method === 'POST' && req.path === '/') ||
      ((req.method === 'PATCH' || req.method === 'DELETE') && /^\/[^/]+$/.test(req.path));
    if (!supported) {
      res.status(400).json({
        error: 'Generation is not supported for this operation',
        code: 'NOTES_GENERATION_UNSUPPORTED',
      });
      return;
    }
  }
  next();
});

const idSchema = z.string().refine(isLiveEntityId, 'Invalid id');

const SYNC_DEFAULT_LIMIT = 200;
const SYNC_MAX_LIMIT = 500;

async function homeOf(req: Request): Promise<NotesHome> {
  return ensurePersonalNotesHome(req.user?.id as string);
}

async function readNote(home: NotesHome, id: string, db: PgHandle = getDb()): Promise<Note | null> {
  const row = await findNoteRow(db, home, id);
  if (!row) return null;
  const [note] = await readNotes(db, home, [row]);
  return note ?? null;
}

/** Answer a refused write, or report that the error was something else. */
async function refused(error: unknown, res: Response, home?: NotesHome, id?: string) {
  if (error instanceof NotesGenerationUnavailable) {
    res.status(503).json({ error: error.message, code: 'NOTES_GENERATION_UNAVAILABLE' });
    return true;
  }
  if (error instanceof NotesGenerationChanged) {
    res.status(409).json({ error: error.message, code: 'NOTES_GENERATION_CHANGED' });
    return true;
  }
  if (error instanceof NotesMaintenanceBusy) {
    res.status(409).json({ error: error.message, code: 'NOTES_MAINTENANCE_IN_PROGRESS' });
    return true;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid input', details: error.errors });
    return true;
  }
  if (error instanceof NoteRejected) {
    // A stale write is answered with the note as it stands, to rebase onto.
    const current =
      error.status === 409 && home && id ? await readNote(home, id).catch(() => null) : null;
    res
      .status(error.status)
      .json({ error: error.message, code: error.code, ...(current && { note: current }) });
    return true;
  }
  return false;
}

/** Reject generation-aware writes before touching their home or data when disabled. */
function requestGeneration(req: Request): string | undefined {
  const value = req.get('X-Notes-Generation');
  if (value === undefined) return undefined;
  if (!notesGenerationConfig.enabled) throw new NotesGenerationUnavailable();
  return z.string().min(1).max(256).parse(value);
}

const changed = (home: NotesHome, databaseId = home.notes.id) =>
  announceChange({ workspaceId: home.workspaceId, databaseId });

/** A failed delivery cannot roll back an already committed guarded write. */
function notifyCommitted(actions: Array<() => void>): void {
  for (const action of actions) {
    try {
      action();
    } catch (err: unknown) {
      log.general.error({ err }, 'Failed to announce a committed note');
    }
  }
}

/** Tell Alia, in the transaction of the change, as Noted's own server did. */
const noteChanged = (tx: PgHandle, home: NotesHome, noteId: string, change: NoteChange) =>
  enqueueNoteChanged(tx, {
    accountId: home.ownerId,
    noteId,
    change,
    key: randomUUID(),
    occurredAt: new Date().toISOString(),
  });

function patchChange(write: NoteWrite): NoteChange {
  if (write.trashed === true) return 'trashed';
  if (write.archived === true) return 'archived';
  if (write.trashed === false || write.archived === false) return 'restored';
  return 'updated';
}

// ── Notes ────────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  view: z.enum(['active', 'archived', 'trashed']).default('active'),
  label: z.string().optional(),
  folder: z.string().optional(),
  pinned: z.enum(['true', 'false']).optional(),
});

/** GET /notes?view&label&folder&pinned — one view of the notes, pinned first. */
router.get('/', async (req: Request, res: Response) => {
  try {
    const query = listQuerySchema.parse(req.query);
    const home = await homeOf(req);
    const db = getDb();
    const rows = await listNoteRows(db, home, {
      view: query.view,
      label: query.label,
      folder: query.folder,
      pinned: query.pinned === undefined ? undefined : query.pinned === 'true',
    });
    res.json({ notes: await readNotes(db, home, rows) });
  } catch (error: unknown) {
    if (await refused(error, res)) return;
    log.general.error({ err: error }, 'Failed to list notes');
    res.status(500).json({ error: 'Failed to list notes' });
  }
});

interface SyncCursor {
  /** Optional epoch for generation-aware clients. */
  g?: string;
  /** The notes database the cursor is for: a reset makes a new one, and its cursors start over. */
  d?: string;
  /** Changes at or after this instant; absent for the whole set. */
  s?: string;
  /** Within a pass: the last row returned, to continue after. */
  u?: string;
  i?: string;
  /** Within a pass: where it ends, and the next pass starts (`syncWatermark`). */
  t?: string;
  /** Within a pass: it is the whole set. */
  f?: boolean;
}

function parseCursor(raw: unknown): SyncCursor | null {
  if (raw === undefined || raw === '') return {};
  if (typeof raw !== 'string') return null;
  try {
    const cursor = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as SyncCursor;
    if (typeof cursor !== 'object' || cursor === null) return null;
    const dates = [cursor.s, cursor.u, cursor.t].filter((d) => d !== undefined);
    if (dates.some((d) => typeof d !== 'string' || Number.isNaN(Date.parse(d)))) return null;
    if ((cursor.u === undefined) !== (cursor.i === undefined)) return null;
    if (cursor.i !== undefined && typeof cursor.i !== 'string') return null;
    if (cursor.d !== undefined && typeof cursor.d !== 'string') return null;
    return cursor;
  } catch {
    return null;
  }
}

const encodeCursor = (cursor: SyncCursor) =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

/**
 * GET /notes/sync?cursor&limit — what changed since the cursor, in pages.
 *
 * A pass ends where `syncWatermark` says, read when it begins, and the next
 * pass starts there, inclusively: a row a slow transaction stamps early is in
 * one pass or the next, never between them (a row may come twice, which the
 * client's upsert absorbs). Without a cursor, with one for a notes database
 * that a reset replaced, or with one older than deletions are remembered, the
 * pass is the whole set (`full`).
 */
router.get('/sync', async (req: Request, res: Response) => {
  try {
    const cursor = parseCursor(req.query.cursor);
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(SYNC_MAX_LIMIT)
      .default(SYNC_DEFAULT_LIMIT)
      .safeParse(req.query.limit);
    if (!cursor || !limit.success) {
      res.status(400).json({ error: 'Invalid cursor or limit' });
      return;
    }
    const aware = req.query.generationAware === '1';
    if (aware && !notesGenerationConfig.enabled) throw new NotesGenerationUnavailable();
    if (
      aware &&
      cursor.g !== undefined &&
      (typeof cursor.g !== 'string' || !cursor.g || cursor.g.length > 256)
    ) {
      res.status(400).json({ error: 'Invalid cursor or limit' });
      return;
    }
    if (
      aware &&
      req.query.cursor !== undefined &&
      req.query.cursor !== '' &&
      cursor.g === undefined
    ) {
      res
        .status(409)
        .json({
          error: 'A generation-aware bootstrap is required',
          code: 'NOTES_GENERATION_BOOTSTRAP_REQUIRED',
        });
      return;
    }
    const originalHome = await homeOf(req);
    const buildPage = async (db: PgHandle, home: NotesHome, generation?: string) => {
      const sameDatabase =
        (cursor.d === undefined || cursor.d === home.notes.id) &&
        (generation === undefined || cursor.g === undefined || cursor.g === generation);
      // A cursor for notes a reset replaced: the client starts over, from nothing.
      const reset = !sameDatabase;
      const continuing = sameDatabase && cursor.u !== undefined && cursor.t !== undefined;
      const end = continuing ? new Date(cursor.t as string) : await syncWatermark(db);
      let since = sameDatabase && cursor.s ? new Date(cursor.s) : null;
      if (since && end.getTime() - since.getTime() > PAGE_TOMBSTONE_RETENTION_MS) since = null;
      const full = since === null;
      const after = continuing
        ? { updatedAt: new Date(cursor.u as string), id: cursor.i as string }
        : null;

      const fetched = await noteRowsChangedSince(db, home, { since, after, limit: limit.data });
      const hasMore = fetched.length > limit.data;
      const rows = hasMore ? fetched.slice(0, limit.data) : fetched;
      const deleted = since && !after ? await noteTombstonesSince(db, home, since) : [];

      const last = rows[rows.length - 1];
      const next: SyncCursor =
        hasMore && last
          ? {
              d: home.notes.id,
              ...(generation !== undefined && { g: generation }),
              ...(since && { s: since.toISOString() }),
              u: last.updatedAt.toISOString(),
              i: last.id,
              t: end.toISOString(),
            }
          : {
              d: home.notes.id,
              s: end.toISOString(),
              ...(generation !== undefined && { g: generation }),
            };

      const page: NotesSyncPage = {
        notes: await readNotes(db, home, rows),
        deleted,
        cursor: encodeCursor(next),
        hasMore,
        full,
        reset,
        ...(generation !== undefined && { generation }),
        ...(!hasMore && {
          labels: labelOptions(home).map(toLabel),
          folders: await listFolders(db, home),
        }),
      };
      return page;
    };
    const page = aware
      ? await getDb().transaction(async (tx) => {
          const generation = await lockNotesGeneration(tx, originalHome.workspaceId, 'share');
          const notes = await findDatabaseById(tx, originalHome.notes.id);
          const folders = await findDatabaseById(tx, originalHome.folders.id);
          if (!notes || !folders) throw new NotesGenerationChanged();
          return buildPage(tx, { ...originalHome, notes, folders }, generation);
        })
      : await buildPage(getDb(), originalHome);
    res.json(page);
  } catch (error: unknown) {
    if (
      (error instanceof NotesGenerationUnavailable || error instanceof NotesGenerationChanged) &&
      (await refused(error, res))
    )
      return;
    log.general.error({ err: error }, 'Failed to sync notes');
    res.status(500).json({ error: 'Failed to sync notes' });
  }
});

/** POST /notes — create a note; with the device's id, a retry answers 200 with the note. */
router.post('/', async (req: Request, res: Response) => {
  let home: NotesHome | undefined;
  try {
    const expected = requestGeneration(req);
    const body = noteCreateSchema.parse(req.body);
    home = await homeOf(req);
    const notesHome = home;
    const afterCommit: Array<() => void> | undefined = expected === undefined ? undefined : [];
    const { id, existed, note } = await getDb().transaction(async (tx) => {
      if (expected !== undefined)
        await lockNotesGeneration(tx, notesHome.workspaceId, 'share', expected);
      const created = await createNote(tx, notesHome, body, req.user?.id as string, afterCommit);
      if (!created.existed) await noteChanged(tx, notesHome, created.id, 'created');
      return {
        ...created,
        note: expected === undefined ? undefined : await readNote(notesHome, created.id, tx),
      };
    });
    if (afterCommit)
      notifyCommitted(existed ? afterCommit : [...afterCommit, () => changed(notesHome)]);
    else if (!existed) changed(home);
    res
      .status(existed ? 200 : 201)
      .json({ note: expected === undefined ? await readNote(home, id) : note });
  } catch (error: unknown) {
    if (await refused(error, res, home)) return;
    log.general.error({ err: error }, 'Failed to create a note');
    res.status(500).json({ error: 'Failed to create a note' });
  }
});

/** POST /notes/reorder { ids } — orders by position in `ids`. */
router.post('/reorder', async (req: Request, res: Response) => {
  try {
    const { ids } = z.object({ ids: z.array(idSchema).max(5000) }).parse(req.body);
    const home = await homeOf(req);
    await reorderNotes(getDb(), home, ids);
    changed(home);
    res.json({ success: true });
  } catch (error: unknown) {
    if (await refused(error, res)) return;
    log.general.error({ err: error }, 'Failed to reorder notes');
    res.status(500).json({ error: 'Failed to reorder notes' });
  }
});

// ── Labels ───────────────────────────────────────────────────────────

router.get('/labels', async (req: Request, res: Response) => {
  try {
    const home = await homeOf(req);
    res.json({ labels: labelOptions(home).map(toLabel) });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to list labels');
    res.status(500).json({ error: 'Failed to list labels' });
  }
});

router.post('/labels', async (req: Request, res: Response) => {
  try {
    const body = noteLabelWriteSchema.parse(req.body);
    const home = await homeOf(req);
    const option = await createLabel(getDb(), home, body);
    changed(home);
    res.status(201).json({ label: toLabel(option) });
  } catch (error: unknown) {
    if (await refused(error, res)) return;
    log.general.error({ err: error }, 'Failed to create a label');
    res.status(500).json({ error: 'Failed to create a label' });
  }
});

router.patch('/labels/:id', async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: z.string().min(1).max(200) }).parse(req.params);
    // Either field alone: a rename, or a new colour.
    const body = noteLabelWriteSchema.partial().parse(req.body);
    const home = await homeOf(req);
    const option = await updateLabel(getDb(), home, id, body);
    if (!option) {
      res.status(404).json({ error: 'Label not found' });
      return;
    }
    changed(home);
    res.json({ label: toLabel(option) });
  } catch (error: unknown) {
    if (await refused(error, res)) return;
    log.general.error({ err: error }, 'Failed to update a label');
    res.status(500).json({ error: 'Failed to update a label' });
  }
});

router.delete('/labels/:id', async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: z.string().min(1).max(200) }).parse(req.params);
    const home = await homeOf(req);
    if (!(await deleteLabel(getDb(), home, id))) {
      res.status(404).json({ error: 'Label not found' });
      return;
    }
    changed(home);
    res.json({ success: true });
  } catch (error: unknown) {
    if (await refused(error, res)) return;
    log.general.error({ err: error }, 'Failed to delete a label');
    res.status(500).json({ error: 'Failed to delete a label' });
  }
});

// ── Folders ──────────────────────────────────────────────────────────

router.get('/folders', async (req: Request, res: Response) => {
  try {
    const home = await homeOf(req);
    res.json({ folders: await listFolders(getDb(), home) });
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to list folders');
    res.status(500).json({ error: 'Failed to list folders' });
  }
});

router.post('/folders', async (req: Request, res: Response) => {
  try {
    const body = noteFolderWriteSchema.parse(req.body);
    const home = await homeOf(req);
    const id = await createFolder(getDb(), home, body);
    changed(home, home.folders.id);
    const folder = (await listFolders(getDb(), home)).find((f) => f.id === id);
    res.status(201).json({ folder });
  } catch (error: unknown) {
    if (await refused(error, res)) return;
    log.general.error({ err: error }, 'Failed to create a folder');
    res.status(500).json({ error: 'Failed to create a folder' });
  }
});

router.patch('/folders/:id', async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: idSchema }).parse(req.params);
    // Either field alone: a rename, or a move.
    const body = noteFolderWriteSchema.partial().parse(req.body);
    const home = await homeOf(req);
    if (!(await updateFolder(getDb(), home, id, body))) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }
    changed(home, home.folders.id);
    const folder = (await listFolders(getDb(), home)).find((f) => f.id === id);
    res.json({ folder });
  } catch (error: unknown) {
    if (await refused(error, res)) return;
    log.general.error({ err: error }, 'Failed to update a folder');
    res.status(500).json({ error: 'Failed to update a folder' });
  }
});

router.delete('/folders/:id', async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: idSchema }).parse(req.params);
    const home = await homeOf(req);
    if (!(await deleteFolder(getDb(), home, id))) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }
    changed(home, home.folders.id);
    changed(home);
    res.json({ success: true });
  } catch (error: unknown) {
    if (await refused(error, res)) return;
    log.general.error({ err: error }, 'Failed to delete a folder');
    res.status(500).json({ error: 'Failed to delete a folder' });
  }
});

// ── The whole account ────────────────────────────────────────────────

/** GET /notes/export — every note (trash included), label and folder, as JSON to keep. */
router.get('/export', async (req: Request, res: Response) => {
  try {
    const home = await homeOf(req);
    const db = getDb();
    const rows = await db
      .select()
      .from(pages)
      .where(and(eq(pages.databaseId, home.notes.id), eq(pages.template, false)))
      .orderBy(asc(pages.createdAt));
    const body: NotesExport = {
      exportedAt: new Date().toISOString(),
      notes: await readNotes(db, home, rows),
      labels: labelOptions(home).map(toLabel),
      folders: await listFolders(db, home),
    };
    res.json(body);
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to export notes');
    res.status(500).json({ error: 'Failed to export notes' });
  }
});

/**
 * POST /notes/erase { confirm: 'DELETE' } — every note, label and folder, for
 * good. The rest of the workspace (pages, other databases) is left alone:
 * erasing Noted's data is not resetting the workspace.
 */
router.post('/erase', async (req: Request, res: Response) => {
  try {
    const body = z.object({ confirm: z.literal('DELETE') }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Send { confirm: 'DELETE' } to erase every note" });
      return;
    }
    const home = await homeOf(req);
    const erased = await eraseNotes(getDb(), home);
    changed(home);
    changed(home, home.folders.id);
    res.json({ success: true, erased });
  } catch (error: unknown) {
    if (await refused(error, res)) return;
    log.general.error({ err: error }, 'Failed to erase notes');
    res.status(500).json({ error: 'Failed to erase notes' });
  }
});

// ── One note ─────────────────────────────────────────────────────────

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: idSchema }).parse(req.params);
    const note = await readNote(await homeOf(req), id);
    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    res.json({ note });
  } catch (error: unknown) {
    if (await refused(error, res)) return;
    log.general.error({ err: error }, 'Failed to read a note');
    res.status(500).json({ error: 'Failed to read a note' });
  }
});

/**
 * PATCH /notes/:id — write the fields sent; absent ones are left alone. With
 * `baseUpdatedAt`, a note changed since is answered 409 with the note.
 */
router.patch('/:id', async (req: Request, res: Response) => {
  let home: NotesHome | undefined;
  let id: string | undefined;
  try {
    const expected = requestGeneration(req);
    id = z.object({ id: idSchema }).parse(req.params).id;
    const body = noteWriteSchema.parse(req.body);
    home = await homeOf(req);
    const [notesHome, noteId] = [home, id];
    const afterCommit: Array<() => void> | undefined = expected === undefined ? undefined : [];
    const result = await getDb().transaction(async (tx) => {
      if (expected !== undefined)
        await lockNotesGeneration(tx, notesHome.workspaceId, 'share', expected);
      const found = await updateNote(
        tx,
        notesHome,
        noteId,
        body,
        req.user?.id as string,
        afterCommit,
      );
      if (found) await noteChanged(tx, notesHome, noteId, patchChange(body));
      const note =
        expected !== undefined && found ? await readNote(notesHome, noteId, tx) : undefined;
      return { found, note };
    });
    if (!result.found) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    if (afterCommit) notifyCommitted([...afterCommit, () => changed(notesHome)]);
    else changed(home);
    res.json({ note: expected === undefined ? await readNote(home, id) : result.note });
  } catch (error: unknown) {
    if (await refused(error, res, home, id)) return;
    log.general.error({ err: error }, 'Failed to update a note');
    res.status(500).json({ error: 'Failed to update a note' });
  }
});

/** DELETE /notes/:id — for good (the trash is `trashed`); syncing clients get a tombstone. */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const expected = requestGeneration(req);
    const { id } = z.object({ id: idSchema }).parse(req.params);
    const home = await homeOf(req);
    const deleted = await getDb().transaction(async (tx) => {
      if (expected !== undefined)
        await lockNotesGeneration(tx, home.workspaceId, 'share', expected);
      const found = await deleteNote(tx, home, id);
      if (found) await noteChanged(tx, home, id, 'deleted');
      return found;
    });
    if (!deleted) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    changed(home);
    res.json({ success: true });
  } catch (error: unknown) {
    if (await refused(error, res)) return;
    log.general.error({ err: error }, 'Failed to delete a note');
    res.status(500).json({ error: 'Failed to delete a note' });
  }
});

export default router;
