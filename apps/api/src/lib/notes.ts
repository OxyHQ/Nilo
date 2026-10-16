/**
 * Writing notes, labels and folders (`routes/notes.ts`).
 *
 * A note write is one transaction on the note's row: the page is locked, the
 * caller's `baseUpdatedAt` is checked against it, then its fields, its
 * reminder and its app data are written, and its blocks last, as one change to
 * the page's document (`replacePageBlocks`), its rows projected in the same
 * transaction, so the page keeps its history. Once the transaction committed
 * the change goes to the page's room, so an editor open on the note in Nilo
 * receives it; never before, or a device could keep a change that rolled back.
 */
import { randomUUID } from 'node:crypto';
import type {
  NoteBlock,
  NoteCreate,
  NoteFolderWrite,
  NoteLabelWrite,
  NoteWrite,
} from '@oxy.so/nilo-contracts';
import { sqlColumnName } from '@oxy.so/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { NiloDatabase, PgHandle } from '../db/client.js';
import { reminders } from '../db/schema/collab.js';
import { type DatabaseSchema, databases, type SelectOption } from '../db/schema/databases.js';
import {
  type PageProperties,
  pageAppData,
  pages,
  pageTombstones,
  transactionTime,
} from '../db/schema/pages.js';
import { findDatabaseById } from '../repositories/databases.js';
import {
  findFolderRow,
  findNoteRow,
  labelColor,
  labelOptions,
  type NotesHome,
} from '../repositories/notes.js';
import {
  deletePageTree,
  lockPage,
  nextDatabaseRowOrder,
  type PageRow,
  recordTombstones,
} from '../repositories/pages.js';
import { broadcastDocUpdate } from '../collab/page-docs.js';
import { getIO } from '../socket.js';
import { replacePageBlocks, TransactionRejected } from './block-transactions.js';
import { syncRelations } from './databases/relations.js';
import type { FileValue } from './databases/property-values.js';
import { createRow } from './databases/rows.js';
import { FOLDER_PROPERTY, NOTE_PROPERTY } from './databases/system.js';

/** A write the caller has to fix or rebase; `current` is the note as it stands, for a 409. */
export class NoteRejected extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Far enough for any plan; the same bound as `routes/reminders.ts`. */
const REMINDER_MAX_AHEAD_MS = 5 * 366 * 24 * 60 * 60 * 1000;

/**
 * Lock a system database's row until the transaction ends: `update` while its
 * labels or folders change, `share` while a note is checked against them, so
 * a note never ends up naming a label or folder deleted alongside.
 */
async function lockDatabase(tx: PgHandle, id: string, mode: 'update' | 'share'): Promise<void> {
  await tx.select({ id: databases.id }).from(databases).where(eq(databases.id, id)).for(mode);
}

/** The row properties a note write sets, validated against the user's labels and folders. */
async function propertiesOf(
  db: PgHandle,
  home: NotesHome,
  page: PageRow,
  write: NoteWrite,
): Promise<PageProperties> {
  const properties: PageProperties = {};
  if (write.title !== undefined) properties[NOTE_PROPERTY.name] = { text: write.title };
  if (write.color !== undefined) properties[NOTE_PROPERTY.color] = { optionId: write.color };
  if (write.kind !== undefined) properties[NOTE_PROPERTY.kind] = { optionId: write.kind };
  if (write.pinned !== undefined) properties[NOTE_PROPERTY.pinned] = { checked: write.pinned };
  if (write.archived !== undefined) {
    properties[NOTE_PROPERTY.archived] = { checked: write.archived };
  }
  if (write.labels !== undefined) {
    await lockDatabase(db, home.notes.id, 'share');
    const fresh = await findDatabaseById(db, home.notes.id);
    if (fresh) home.notes = fresh;
    const known = new Set(labelOptions(home).map((option) => option.id));
    const unknown = write.labels.find((id) => !known.has(id));
    if (unknown) throw new NoteRejected(400, `Unknown label ${unknown}`, 'UNKNOWN_LABEL');
    properties[NOTE_PROPERTY.labels] = { optionIds: [...new Set(write.labels)] };
  }
  if (write.folderId !== undefined) {
    await lockDatabase(db, home.folders.id, 'share');
    if (write.folderId && !(await findFolderRow(db, home, write.folderId))) {
      throw new NoteRejected(400, `Unknown folder ${write.folderId}`, 'UNKNOWN_FOLDER');
    }
    properties[NOTE_PROPERTY.folder] = { pageIds: write.folderId ? [write.folderId] : [] };
  }
  if (write.attachments !== undefined) {
    // Noted's attachments are the Oxy files; links added in Nilo stay, and a
    // file keeps the name it had.
    const current = (
      (page.properties[NOTE_PROPERTY.attachments] as { files?: FileValue[] } | undefined)?.files ??
      []
    ).filter((file) => file && typeof file === 'object');
    const named = new Map(
      current.flatMap((file) => (file.fileId ? [[file.fileId, file.name] as const] : [])),
    );
    properties[NOTE_PROPERTY.attachments] = {
      files: [
        ...current.filter((file) => !file.fileId),
        ...[...new Set(write.attachments)].map((fileId) => ({
          name: named.get(fileId) ?? '',
          fileId,
        })),
      ],
    };
  }
  return properties;
}

/** The owner's reminder on the note: replaced, or removed when `reminderAt` is null. */
async function writeReminder(
  db: PgHandle,
  home: NotesHome,
  pageId: string,
  reminderAt: string | null,
): Promise<void> {
  const remindAt = reminderAt ? new Date(reminderAt) : null;
  if (remindAt && remindAt.getTime() - Date.now() > REMINDER_MAX_AHEAD_MS) {
    throw new NoteRejected(400, 'A reminder can be at most five years ahead');
  }
  // The same time again is no change: a client resending the note's fields
  // must not bring back a reminder that already went off.
  const [latest] = await db
    .select({ remindAt: reminders.remindAt })
    .from(reminders)
    .where(
      and(
        eq(reminders.pageId, pageId),
        eq(reminders.userId, home.ownerId),
        isNull(reminders.blockId),
      ),
    )
    .orderBy(desc(reminders.createdAt))
    .limit(1);
  if ((latest?.remindAt.getTime() ?? null) === (remindAt?.getTime() ?? null)) return;
  await db
    .delete(reminders)
    .where(
      and(
        eq(reminders.pageId, pageId),
        eq(reminders.userId, home.ownerId),
        isNull(reminders.blockId),
      ),
    );
  if (remindAt) {
    await db.insert(reminders).values({ userId: home.ownerId, pageId, remindAt });
  }
}

/** Noted's data about the note, written whole when the caller's revision is still current. */
async function writeAppData(
  db: PgHandle,
  pageId: string,
  appData: NonNullable<NoteWrite['appData']>,
): Promise<void> {
  const [current] = await db
    .select({ revision: pageAppData.revision })
    .from(pageAppData)
    .where(and(eq(pageAppData.pageId, pageId), eq(pageAppData.app, 'noted')))
    .for('update');
  if ((current?.revision ?? 0) !== appData.baseRevision) {
    throw new NoteRejected(409, 'The note changed since that revision', 'STALE_APP_DATA');
  }
  const revision = appData.baseRevision + 1;
  await db
    .insert(pageAppData)
    .values({ pageId, app: 'noted', data: appData.data, revision })
    .onConflictDoUpdate({
      target: [pageAppData.pageId, pageAppData.app],
      set: { data: appData.data, revision },
    });
}

/**
 * The note's blocks made `target`: one change to the page's document, its
 * rows projected in this transaction. The change is returned, for the room
 * once the transaction committed (`broadcastWritten`).
 */
async function writeBlocks(
  db: PgHandle,
  pageId: string,
  target: readonly NoteBlock[],
  actorId: string,
): Promise<Uint8Array | null> {
  return replacePageBlocks(db, { pageId, target, actorId, broadcast: false });
}

/** Tell the note's room what changed, now that it committed. */
function broadcastWritten(pageId: string, update: Uint8Array | null): void {
  if (update) broadcastDocUpdate(getIO(), pageId, update);
}

/**
 * The blocks sent form a tree: unique ids, parents among them (or none), no
 * cycle: a forest that is not one could not be written as it was sent.
 */
function checkBlockTree(blocks: readonly NoteBlock[]): void {
  const parentOf = new Map(blocks.map((block) => [block.id, block.parentBlockId]));
  if (parentOf.size !== blocks.length) {
    throw new NoteRejected(400, 'Two blocks share an id', 'INVALID_BLOCKS');
  }
  for (const block of blocks) {
    const seen = new Set<string>();
    let current: string | null = block.id;
    while (current !== null) {
      if (seen.has(current)) {
        throw new NoteRejected(400, 'The blocks nest in a cycle', 'INVALID_BLOCKS');
      }
      seen.add(current);
      const parent = parentOf.get(current);
      if (parent === undefined) {
        throw new NoteRejected(400, `Block parent ${current} is not sent`, 'INVALID_BLOCKS');
      }
      current = parent;
    }
  }
}

const hasFields = (write: NoteWrite) =>
  Object.keys(write).some((key) => key !== 'baseUpdatedAt' && key !== 'blocks');

/** Fields, reminder, app data, then blocks, on a row already locked and checked. */
async function writeNoteParts(
  tx: PgHandle,
  home: NotesHome,
  page: PageRow,
  write: NoteWrite,
  actorId: string,
): Promise<Uint8Array | null> {
  if (hasFields(write)) {
    const properties = await propertiesOf(tx, home, page, write);
    await tx
      .update(pages)
      .set({
        ...(write.title !== undefined && { title: write.title }),
        ...(write.order !== undefined && { order: write.order }),
        ...(write.trashed !== undefined && { archived: write.trashed }),
        properties: sql`${pages.properties} || ${JSON.stringify(properties)}::jsonb`,
        // Moves `updatedAt` too, which is what tells syncing clients.
        lastEditedBy: actorId,
      })
      .where(eq(pages.id, page.id));
    if (write.reminderAt !== undefined) await writeReminder(tx, home, page.id, write.reminderAt);
    if (write.appData) await writeAppData(tx, page.id, write.appData);
  }
  if (write.blocks) {
    checkBlockTree(write.blocks as NoteBlock[]);
    // The schema requires every field; `strict: false` widens the inferred type.
    return writeBlocks(tx, page.id, write.blocks as NoteBlock[], actorId);
  }
  return null;
}

/** Turn a block transaction's refusal into the note API's. */
function rejected(error: unknown): never {
  if (error instanceof TransactionRejected) {
    throw new NoteRejected(error.status, error.message, error.code);
  }
  throw error;
}

/**
 * Write `write` on the note `id`. Answers null when no such note exists;
 * throws `NoteRejected` 409 `STALE_NOTE` when `baseUpdatedAt` is not the
 * note's `updatedAt` any more.
 */
export async function updateNote(
  db: PgHandle,
  home: NotesHome,
  id: string,
  write: NoteWrite,
  actorId: string,
): Promise<boolean> {
  const written = await db
    .transaction(async (tx) => {
      const lock = await lockPage(tx, id);
      const page = lock ? await findNoteRow(tx, home, id) : null;
      if (!page) return null;
      if (page.locked) throw new NoteRejected(423, 'The note is locked', 'PAGE_LOCKED');
      if (
        write.baseUpdatedAt !== undefined &&
        new Date(write.baseUpdatedAt).getTime() !== page.updatedAt.getTime()
      ) {
        throw new NoteRejected(409, 'The note changed since that version', 'STALE_NOTE');
      }
      return { update: await writeNoteParts(tx, home, page, write, actorId) };
    })
    .catch(rejected);
  if (!written) return false;
  broadcastWritten(id, written.update);
  return true;
}

/**
 * Create a note, under the id the device chose when it has one. A retry of a
 * create whose answer was lost finds its note and changes nothing: `existed`.
 * Creates of one id run one after another (an advisory lock on it), so
 * concurrent retries all find the first. An id deleted for good stays
 * deleted (410): a device replaying an old create must not bring it back. An
 * id taken by any other page is refused without saying what it is.
 */
export async function createNote(
  db: PgHandle,
  home: NotesHome,
  input: NoteCreate,
  actorId: string,
): Promise<{ id: string; existed: boolean }> {
  const { id: requested, ...write } = input;
  const created = await db
    .transaction(async (tx) => {
      if (requested) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${requested}, 0))`);
        const [taken] = await tx
          .select({ databaseId: pages.databaseId })
          .from(pages)
          .where(eq(pages.id, requested));
        if (taken) {
          if (taken.databaseId === home.notes.id) {
            return { id: requested, existed: true, update: null };
          }
          throw new NoteRejected(409, 'That note id is already in use', 'ID_TAKEN');
        }
        const [tombstone] = await tx
          .select({ pageId: pageTombstones.pageId })
          .from(pageTombstones)
          .where(eq(pageTombstones.pageId, requested));
        if (tombstone) throw new NoteRejected(410, 'That note was deleted', 'NOTE_DELETED');
      }
      const page = await createRow(tx, home.notes, {
        ...(requested && { id: requested }),
        workspaceId: home.workspaceId,
        parentId: null,
        title: write.title ?? '',
        ownerId: home.ownerId,
        order: write.order ?? (await nextDatabaseRowOrder(tx, home.notes.id)),
        properties: {
          [NOTE_PROPERTY.color]: { optionId: 'default' },
          [NOTE_PROPERTY.kind]: { optionId: 'note' },
        },
      });
      const update = await writeNoteParts(tx, home, page, write, actorId);
      return { id: page.id, existed: false, update };
    })
    .catch(rejected);
  broadcastWritten(created.id, created.update);
  return { id: created.id, existed: created.existed };
}

/**
 * Every note and folder for good, and every label (`POST /notes/erase`), in
 * one transaction. The rows leave tombstones, so other devices drop them.
 */
export async function eraseNotes(
  db: NiloDatabase,
  home: NotesHome,
): Promise<{ notes: number; folders: number; labels: number }> {
  return db.transaction(async (tx) => {
    await lockDatabase(tx, home.notes.id, 'update');
    await lockDatabase(tx, home.folders.id, 'update');
    const notes = await tx
      .delete(pages)
      .where(eq(pages.databaseId, home.notes.id))
      .returning({ id: pages.id, databaseId: pages.databaseId });
    const folders = await tx
      .delete(pages)
      .where(eq(pages.databaseId, home.folders.id))
      .returning({ id: pages.id, databaseId: pages.databaseId });
    await recordTombstones(tx, [...notes, ...folders]);
    const fresh = await findDatabaseById(tx, home.notes.id);
    let labels = 0;
    if (fresh) {
      const config = labelsProperty(fresh.propertiesSchema);
      labels = config.options.length;
      config.options = [];
      await tx
        .update(databases)
        .set({ propertiesSchema: fresh.propertiesSchema })
        .where(eq(databases.id, home.notes.id));
      home.notes = fresh;
    }
    return { notes: notes.length, folders: folders.length, labels };
  });
}

/** Delete a note for good; its tombstone tells syncing clients. */
export async function deleteNote(db: PgHandle, home: NotesHome, id: string): Promise<boolean> {
  if (!(await findNoteRow(db, home, id))) return false;
  return (await deletePageTree(db, id)) > 0;
}

/**
 * Give notes the orders of their positions in `ids` (`POST /notes/reorder`).
 * One statement: the positions are a single rearrangement, which a concurrent
 * reader must not see half done.
 */
export async function reorderNotes(
  db: PgHandle,
  home: NotesHome,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const positions = sql.join(
    ids.map((id, index) => sql`(${id}::text, ${index}::double precision)`),
    sql`, `,
  );
  const order = sql.identifier(sqlColumnName(pages.order));
  const updatedAt = sql.identifier(sqlColumnName(pages.updatedAt));
  await db.execute(sql`
    update ${pages} set ${order} = ordering.position, ${updatedAt} = ${transactionTime}
    from (values ${positions}) as ordering(id, position)
    where ${pages.id} = ordering.id and ${pages.databaseId} = ${home.notes.id}
  `);
}

// ── Labels ───────────────────────────────────────────────────────────

/** Change the notes database's schema with its row locked, so two label edits cannot lose one. */
async function withNotesSchema<T>(
  db: PgHandle,
  home: NotesHome,
  change: (schema: DatabaseSchema, tx: PgHandle) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockDatabase(tx, home.notes.id, 'update');
    const fresh = await findDatabaseById(tx, home.notes.id);
    if (!fresh) throw new Error(`notes database ${home.notes.id} vanished`);
    const result = await change(fresh.propertiesSchema, tx);
    await tx
      .update(databases)
      .set({ propertiesSchema: fresh.propertiesSchema })
      .where(eq(databases.id, home.notes.id));
    home.notes = { ...fresh };
    return result;
  });
}

function labelsProperty(schema: DatabaseSchema) {
  const property = schema.properties.find((p) => p.id === NOTE_PROPERTY.labels);
  if (!property) throw new Error('the notes database has no Labels property');
  property.config = { ...property.config, options: property.config?.options ?? [] };
  return property.config as {
    options: NonNullable<NonNullable<typeof property.config>['options']>;
  };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function createLabel(
  db: PgHandle,
  home: NotesHome,
  input: NoteLabelWrite,
): Promise<SelectOption> {
  return withNotesSchema(db, home, async (schema) => {
    const config = labelsProperty(schema);
    if (config.options.some((option) => sameName(option.name, input.name))) {
      throw new NoteRejected(409, 'A label with that name exists', 'LABEL_EXISTS');
    }
    const option: SelectOption = {
      id: randomUUID(),
      name: input.name.trim(),
      color: labelColor(input.color),
      ...(input.color && { noteColor: input.color }),
    };
    config.options.push(option);
    return option;
  });
}

export async function updateLabel(
  db: PgHandle,
  home: NotesHome,
  id: string,
  input: Partial<NoteLabelWrite>,
): Promise<SelectOption | null> {
  return withNotesSchema(db, home, async (schema) => {
    const config = labelsProperty(schema);
    const option = config.options.find((o) => o.id === id);
    if (!option) return null;
    if (input.name !== undefined) {
      const name = input.name;
      if (config.options.some((o) => o.id !== id && sameName(o.name, name))) {
        throw new NoteRejected(409, 'A label with that name exists', 'LABEL_EXISTS');
      }
      option.name = name.trim();
    }
    if (input.color !== undefined) {
      option.color = labelColor(input.color);
      if (input.color) option.noteColor = input.color;
      else delete option.noteColor;
    }
    return { ...option };
  });
}

/** Remove a label, and from every note that has it. */
export async function deleteLabel(db: PgHandle, home: NotesHome, id: string): Promise<boolean> {
  return withNotesSchema(db, home, async (schema, tx) => {
    const config = labelsProperty(schema);
    const before = config.options.length;
    config.options = config.options.filter((o) => o.id !== id);
    if (config.options.length === before) return false;
    const labels = NOTE_PROPERTY.labels;
    await tx
      .update(pages)
      .set({
        properties: sql`jsonb_set(${pages.properties}, ARRAY[${labels}, 'optionIds']::text[], (${pages.properties} -> ${labels} -> 'optionIds') - ${id}::text)`,
      })
      .where(
        and(
          eq(pages.databaseId, home.notes.id),
          sql`${pages.properties} -> ${labels} -> 'optionIds' ? ${id}`,
        ),
      );
    return true;
  });
}

// ── Folders ──────────────────────────────────────────────────────────

const folderParent = (row: PageRow): string | null =>
  ((row.properties[FOLDER_PROPERTY.parent] as { pageIds?: string[] } | undefined)?.pageIds ??
    [])[0] ?? null;

/** Set a folder's parent, keeping the parent's Subfolders in step. */
async function setFolderParent(
  tx: PgHandle,
  home: NotesHome,
  row: PageRow,
  parentId: string | null,
): Promise<void> {
  const before = row.properties;
  const after = { ...before, [FOLDER_PROPERTY.parent]: { pageIds: parentId ? [parentId] : [] } };
  await tx
    .update(pages)
    .set({
      properties: sql`${pages.properties} || ${JSON.stringify({ [FOLDER_PROPERTY.parent]: after[FOLDER_PROPERTY.parent] })}::jsonb`,
    })
    .where(eq(pages.id, row.id));
  await syncRelations(tx, home.folders, row.id, before, after);
}

/** A parent for `folderId` that exists and is not the folder or inside it. */
async function checkParent(
  tx: PgHandle,
  home: NotesHome,
  folderId: string | null,
  parentId: string,
): Promise<void> {
  const seen = new Set<string>();
  let current: string | null = parentId;
  while (current) {
    if (current === folderId) {
      throw new NoteRejected(400, 'A folder cannot be moved into itself', 'FOLDER_CYCLE');
    }
    if (seen.has(current)) break;
    seen.add(current);
    const row = await findFolderRow(tx, home, current);
    if (!row) throw new NoteRejected(400, `Unknown folder ${current}`, 'UNKNOWN_FOLDER');
    current = folderParent(row);
  }
}

export async function createFolder(
  db: NiloDatabase,
  home: NotesHome,
  input: NoteFolderWrite,
): Promise<string> {
  return db.transaction(async (tx) => {
    // Folder changes run one at a time: two moves checked at once could each
    // pass the cycle check and make a loop together.
    await lockDatabase(tx, home.folders.id, 'update');
    if (input.parentId) await checkParent(tx, home, null, input.parentId);
    const row = await createRow(tx, home.folders, {
      workspaceId: home.workspaceId,
      parentId: null,
      title: input.name,
      ownerId: home.ownerId,
      order: await nextDatabaseRowOrder(tx, home.folders.id),
      properties: { [FOLDER_PROPERTY.name]: { text: input.name } },
    });
    if (input.parentId) await setFolderParent(tx, home, row, input.parentId);
    return row.id;
  });
}

export async function updateFolder(
  db: NiloDatabase,
  home: NotesHome,
  id: string,
  input: Partial<NoteFolderWrite>,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockDatabase(tx, home.folders.id, 'update');
    const row = await findFolderRow(tx, home, id);
    if (!row) return false;
    if (input.name !== undefined) {
      await tx
        .update(pages)
        .set({
          title: input.name,
          properties: sql`${pages.properties} || ${JSON.stringify({ [FOLDER_PROPERTY.name]: { text: input.name } })}::jsonb`,
        })
        .where(eq(pages.id, id));
    }
    if (input.parentId !== undefined && input.parentId !== folderParent(row)) {
      if (input.parentId) await checkParent(tx, home, id, input.parentId);
      await setFolderParent(tx, home, row, input.parentId);
    }
    return true;
  });
}

/**
 * Delete a folder. What was in it moves up a level, as in Noted: its
 * subfolders and its notes go to its parent (the top level when it had none).
 */
export async function deleteFolder(
  db: NiloDatabase,
  home: NotesHome,
  id: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockDatabase(tx, home.folders.id, 'update');
    const row = await findFolderRow(tx, home, id);
    if (!row) return false;
    const parentId = folderParent(row);
    const children = await tx
      .select()
      .from(pages)
      .where(
        and(
          eq(pages.databaseId, home.folders.id),
          sql`${pages.properties} -> ${FOLDER_PROPERTY.parent} -> 'pageIds' ? ${id}`,
        ),
      );
    for (const child of children) await setFolderParent(tx, home, child, parentId);
    const folder = NOTE_PROPERTY.folder;
    await tx
      .update(pages)
      .set({
        properties: sql`${pages.properties} || jsonb_build_object(${folder}::text, jsonb_build_object('pageIds', ${JSON.stringify(parentId ? [parentId] : [])}::jsonb))`,
      })
      .where(
        and(
          eq(pages.databaseId, home.notes.id),
          sql`${pages.properties} -> ${folder} -> 'pageIds' ? ${id}`,
        ),
      );
    // Its own parent's Subfolders lose it.
    if (parentId) await setFolderParent(tx, home, row, null);
    await deletePageTree(tx, id);
    return true;
  });
}
