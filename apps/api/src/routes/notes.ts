/**
 * `/notes`: Noted's API. Every route works in the caller's personal workspace,
 * on its `notes` and `note_folders` system databases (`lib/databases/system.ts`),
 * which it provisions on first use. Contract: `@nilo/contracts` `notes.ts`.
 *
 * A note's history is the page's (`/pages/:id/versions`), and the routes for
 * it are not repeated here.
 */
import {
  type Note,
  noteCreateSchema,
  noteFolderWriteSchema,
  noteLabelWriteSchema,
  type NotesSyncPage,
  noteWriteSchema,
} from '@nilo/contracts';
import { isLiveEntityId } from '@oxy.so/db';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { announceChange } from '../collab/live-rooms.js';
import { getDb } from '../db/client.js';
import { PAGE_TOMBSTONE_RETENTION_MS } from '../db/schema/pages.js';
import { log } from '../lib/logger.js';
import {
  createFolder,
  createLabel,
  createNote,
  deleteFolder,
  deleteLabel,
  deleteNote,
  NoteRejected,
  reorderNotes,
  updateFolder,
  updateLabel,
  updateNote,
} from '../lib/notes.js';
import { authenticateToken } from '../middleware/auth.js';
import { ensurePersonalNotesHome } from '../middleware/workspace.js';
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

const idSchema = z.string().refine(isLiveEntityId, 'Invalid id');

const SYNC_DEFAULT_LIMIT = 200;
const SYNC_MAX_LIMIT = 500;

async function homeOf(req: Request): Promise<NotesHome> {
  return ensurePersonalNotesHome(req.user?.id as string);
}

async function readNote(home: NotesHome, id: string): Promise<Note | null> {
  const db = getDb();
  const row = await findNoteRow(db, home, id);
  if (!row) return null;
  const [note] = await readNotes(db, home, [row]);
  return note ?? null;
}

/** Answer a refused write, or report that the error was something else. */
async function refused(error: unknown, res: Response, home?: NotesHome, id?: string) {
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

const changed = (home: NotesHome, databaseId = home.notes.id) =>
  announceChange({ workspaceId: home.workspaceId, databaseId });

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
    const home = await homeOf(req);
    const db = getDb();

    const sameDatabase = cursor.d === undefined || cursor.d === home.notes.id;
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
            ...(since && { s: since.toISOString() }),
            u: last.updatedAt.toISOString(),
            i: last.id,
            t: end.toISOString(),
          }
        : { d: home.notes.id, s: end.toISOString() };

    const page: NotesSyncPage = {
      notes: await readNotes(db, home, rows),
      deleted,
      cursor: encodeCursor(next),
      hasMore,
      full,
      ...(!hasMore && {
        labels: labelOptions(home).map(toLabel),
        folders: await listFolders(db, home),
      }),
    };
    res.json(page);
  } catch (error: unknown) {
    log.general.error({ err: error }, 'Failed to sync notes');
    res.status(500).json({ error: 'Failed to sync notes' });
  }
});

/** POST /notes — create a note; with the device's id, a retry answers 200 with the note. */
router.post('/', async (req: Request, res: Response) => {
  let home: NotesHome | undefined;
  try {
    const body = noteCreateSchema.parse(req.body);
    home = await homeOf(req);
    const { id, existed } = await createNote(getDb(), home, body, req.user?.id as string);
    if (!existed) changed(home);
    res.status(existed ? 200 : 201).json({ note: await readNote(home, id) });
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
    const body = noteLabelWriteSchema.parse(req.body);
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
    const body = noteFolderWriteSchema.parse(req.body);
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
    id = z.object({ id: idSchema }).parse(req.params).id;
    const body = noteWriteSchema.parse(req.body);
    home = await homeOf(req);
    if (!(await updateNote(getDb(), home, id, body, req.user?.id as string))) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    changed(home);
    res.json({ note: await readNote(home, id) });
  } catch (error: unknown) {
    if (await refused(error, res, home, id)) return;
    log.general.error({ err: error }, 'Failed to update a note');
    res.status(500).json({ error: 'Failed to update a note' });
  }
});

/** DELETE /notes/:id — for good (the trash is `trashed`); syncing clients get a tombstone. */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = z.object({ id: idSchema }).parse(req.params);
    const home = await homeOf(req);
    if (!(await deleteNote(getDb(), home, id))) {
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
