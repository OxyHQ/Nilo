/**
 * Copying a Noted account into its owner's personal workspace
 * (`scripts/import-noted.ts`). Idempotent: a note already in Nilo is left
 * alone, and labels and folders are matched by name before one is made, so
 * running it again after a partial run finishes the job and changes nothing
 * else. Notes keep their ids, so a device that synced them from Noted
 * recognises them in Nilo.
 *
 * Reads go through `NotedSource`, so the copy is tested against Postgres on
 * the Nilo side with Noted's data given in memory.
 */
import { eq } from 'drizzle-orm';
import type { NiloDatabase } from '../db/client.js';
import { reminders } from '../db/schema/collab.js';
import { pages, pageVersions } from '../db/schema/pages.js';
import {
  findFolderRow,
  findNoteRow,
  labelOptions,
  listFolders,
  type NotesHome,
} from '../repositories/notes.js';
import {
  foldersParentsFirst,
  type NotedFolder,
  type NotedLabel,
  type NotedNote,
  type NotedRevision,
  notedBlocks,
  notedColor,
  notedNoteToCreate,
} from './noted-import.js';
import { createFolder, createLabel, createNote } from './notes.js';

/** What the import reads from Noted, one account at a time. */
export interface NotedSource {
  users(): Promise<string[]>;
  labels(userId: string): Promise<NotedLabel[]>;
  folders(userId: string): Promise<NotedFolder[]>;
  /** Notes not deleted for good. */
  notes(userId: string): Promise<NotedNote[]>;
  revisions(userId: string, noteIds: readonly string[]): Promise<NotedRevision[]>;
  /** Recording artifacts and overrides per note, in Noted's wire shape. */
  appData(
    userId: string,
    noteIds: readonly string[],
  ): Promise<Map<string, { artifacts: unknown[]; itemOverrides: unknown[] }>>;
}

export interface ImportReport {
  userId: string;
  labels: { created: number; matched: number };
  folders: { created: number; matched: number };
  notes: { created: number; skipped: number; trashed: number };
  revisions: number;
  reminders: { pending: number; done: number };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Copy one Noted account into `home`. With `dryRun`, reads and converts but writes nothing. */
export async function importNotedAccount(
  db: NiloDatabase,
  source: NotedSource,
  home: NotesHome,
  options: { dryRun: boolean },
): Promise<ImportReport> {
  const userId = home.ownerId;
  const report: ImportReport = {
    userId,
    labels: { created: 0, matched: 0 },
    folders: { created: 0, matched: 0 },
    notes: { created: 0, skipped: 0, trashed: 0 },
    revisions: 0,
    reminders: { pending: 0, done: 0 },
  };

  const labelIds = new Map<string, string>();
  for (const label of await source.labels(userId)) {
    const existing = labelOptions(home).find((option) => sameName(option.name, label.name));
    if (existing) {
      labelIds.set(label.id, existing.id);
      report.labels.matched += 1;
      continue;
    }
    report.labels.created += 1;
    if (options.dryRun) {
      labelIds.set(label.id, label.id);
      continue;
    }
    const option = await createLabel(db, home, {
      name: label.name,
      color: label.color === null ? null : notedColor(label.color),
    });
    labelIds.set(label.id, option.id);
  }

  const folderIds = new Map<string, string>();
  const niloFolders = await listFolders(db, home);
  for (const folder of foldersParentsFirst(await source.folders(userId))) {
    const parentId = folder.parentId ? (folderIds.get(folder.parentId) ?? null) : null;
    const existing = niloFolders.find(
      (f) => sameName(f.name, folder.name) && f.parentId === parentId,
    );
    if (existing) {
      folderIds.set(folder.id, existing.id);
      report.folders.matched += 1;
      continue;
    }
    report.folders.created += 1;
    if (options.dryRun) {
      folderIds.set(folder.id, folder.id);
      continue;
    }
    const id = await createFolder(db, home, { name: folder.name, parentId });
    folderIds.set(folder.id, id);
    niloFolders.push({ id, name: folder.name, parentId });
  }

  const notes = await source.notes(userId);
  const fresh: NotedNote[] = [];
  for (const note of notes) {
    if (await findNoteRow(db, home, note.id)) report.notes.skipped += 1;
    else fresh.push(note);
  }
  const ids = fresh.map((note) => note.id);
  const appData = await source.appData(userId, ids);
  const revisions = await source.revisions(userId, ids);

  for (const note of fresh) {
    report.notes.created += 1;
    if (note.trashed) report.notes.trashed += 1;
    const data = appData.get(note.id);
    const create = notedNoteToCreate(note, { labelIds, folderIds }, data ? { ...data } : null);
    // A folder made in a dry run has no Nilo id to check against.
    if (options.dryRun) {
      if (note.reminderAt) {
        if (reminderDone(note)) report.reminders.done += 1;
        else report.reminders.pending += 1;
      }
      report.revisions += revisions.filter((r) => r.noteId === note.id).length;
      continue;
    }
    if (create.folderId && !(await findFolderRow(db, home, create.folderId))) {
      create.folderId = null;
    }
    // A reminder still to come is the note's like any other. One that went
    // off in Noted, or fell due while nobody was delivering, is copied as
    // delivered, in one write: never a moment when the sweep could ring it.
    const pending = note.reminderAt !== null && !reminderDone(note);
    await createNote(
      db,
      home,
      {
        ...create,
        ...(pending && note.reminderAt && { reminderAt: note.reminderAt.toISOString() }),
      },
      userId,
    );
    // When it was written in Noted, not when it was copied.
    await db.update(pages).set({ createdAt: note.createdAt }).where(eq(pages.id, note.id));
    if (pending) report.reminders.pending += 1;
    else if (note.reminderAt) {
      await db.insert(reminders).values({
        userId,
        pageId: note.id,
        remindAt: note.reminderAt,
        sentAt: note.reminderSentAt ?? new Date(),
      });
      report.reminders.done += 1;
    }
    for (const revision of revisions.filter((r) => r.noteId === note.id)) {
      await db.insert(pageVersions).values({
        pageId: note.id,
        blocksVersion: 0,
        blocks: notedBlocks(revision.body, revision.checklist),
        createdBy: userId,
        createdAt: revision.createdAt,
      });
      report.revisions += 1;
    }
  }
  return report;
}

const reminderDone = (note: NotedNote) =>
  note.reminderSentAt !== null || (note.reminderAt?.getTime() ?? 0) <= Date.now();
