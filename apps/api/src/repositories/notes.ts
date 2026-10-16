/**
 * Notes: the rows of a personal workspace's `notes` system database, read and
 * written as Noted sees them (`@nilo/contracts` `Note`). The mapping between a
 * note's fields and the row's properties is here and nowhere else; the ids it
 * relies on are `NOTE_PROPERTY` and `FOLDER_PROPERTY` (`lib/databases/system.ts`).
 */
import {
  NOTE_COLORS,
  NOTE_KINDS,
  type Note,
  type NoteBlock,
  type NoteColor,
  type NoteFolder,
  type NoteKind,
  type NoteLabel,
} from '@nilo/contracts';
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { PgHandle } from '../db/client.js';
import { reminders } from '../db/schema/collab.js';
import type { SelectColor, SelectOption } from '../db/schema/databases.js';
import {
  blocks,
  type PageProperties,
  pageAppData,
  pages,
  pageTombstones,
} from '../db/schema/pages.js';
import { relationIds } from '../lib/databases/relations.js';
import { FOLDER_PROPERTY, NOTE_PROPERTY, noteColorInNilo } from '../lib/databases/system.js';
import type { DatabaseRecord } from './databases.js';
import type { PageRow } from './pages.js';

/** The notes and folders databases a request works in. */
export interface NotesHome {
  workspaceId: string;
  ownerId: string;
  notes: DatabaseRecord;
  folders: DatabaseRecord;
}

// ── Reading a row as a note ──────────────────────────────────────────

const isNoteColor = (value: unknown): value is NoteColor =>
  (NOTE_COLORS as readonly unknown[]).includes(value);
const isNoteKind = (value: unknown): value is NoteKind =>
  (NOTE_KINDS as readonly unknown[]).includes(value);

const optionOf = (properties: PageProperties, id: string): unknown =>
  (properties[id] as { optionId?: unknown } | undefined)?.optionId;
const checkedOf = (properties: PageProperties, id: string): boolean =>
  (properties[id] as { checked?: unknown } | undefined)?.checked === true;

/** The Oxy file ids of the Attachments property; files given by link are not attachments. */
function attachmentsOf(properties: PageProperties): string[] {
  const files = (properties[NOTE_PROPERTY.attachments] as { files?: unknown } | undefined)?.files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((file) => {
    const fileId = (file as { fileId?: unknown }).fileId;
    return typeof fileId === 'string' ? [fileId] : [];
  });
}

/** What a note is made of besides its row. */
export interface NoteParts {
  blocks: NoteBlock[];
  reminderAt: Date | null;
  appData: { data: Record<string, unknown>; revision: number } | null;
}

export function toNote(page: PageRow, parts: NoteParts): Note {
  const properties = page.properties;
  const color = optionOf(properties, NOTE_PROPERTY.color);
  const kind = optionOf(properties, NOTE_PROPERTY.kind);
  const labels = (properties[NOTE_PROPERTY.labels] as { optionIds?: unknown } | undefined)
    ?.optionIds;
  return {
    id: page.id,
    title: page.title,
    blocks: parts.blocks,
    blocksVersion: page.blocksVersion,
    color: isNoteColor(color) ? color : 'default',
    labels: Array.isArray(labels) ? labels.filter((l): l is string => typeof l === 'string') : [],
    folderId: relationIds(properties[NOTE_PROPERTY.folder])[0] ?? null,
    pinned: checkedOf(properties, NOTE_PROPERTY.pinned),
    archived: checkedOf(properties, NOTE_PROPERTY.archived),
    trashed: page.archived,
    kind: isNoteKind(kind) ? kind : 'note',
    attachments: attachmentsOf(properties),
    reminderAt: parts.reminderAt?.toISOString() ?? null,
    order: page.order,
    appData: parts.appData,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
}

/** Everything but the row, for many notes at once: their blocks, the owner's reminders, the app data. */
export async function loadNoteParts(
  db: PgHandle,
  ownerId: string,
  pageIds: readonly string[],
): Promise<Map<string, NoteParts>> {
  const parts = new Map<string, NoteParts>(
    pageIds.map((id) => [id, { blocks: [], reminderAt: null, appData: null }]),
  );
  if (pageIds.length === 0) return parts;
  const ids = [...pageIds];

  const blockRows = await db
    .select({
      id: blocks.id,
      pageId: blocks.pageId,
      parentBlockId: blocks.parentBlockId,
      type: blocks.type,
      content: blocks.content,
      order: blocks.order,
    })
    .from(blocks)
    .where(inArray(blocks.pageId, ids))
    .orderBy(asc(blocks.order), asc(blocks.id));
  for (const { pageId, ...block } of blockRows) parts.get(pageId)?.blocks.push(block);

  // The note's reminder is the owner's latest on the page itself (not a block),
  // delivered or not: a note keeps showing when it was due.
  const reminderRows = await db
    .selectDistinctOn([reminders.pageId], {
      pageId: reminders.pageId,
      remindAt: reminders.remindAt,
    })
    .from(reminders)
    .where(
      and(inArray(reminders.pageId, ids), eq(reminders.userId, ownerId), isNull(reminders.blockId)),
    )
    .orderBy(reminders.pageId, desc(reminders.createdAt));
  for (const row of reminderRows) {
    const part = parts.get(row.pageId);
    if (part) part.reminderAt = row.remindAt;
  }

  const dataRows = await db
    .select()
    .from(pageAppData)
    .where(and(inArray(pageAppData.pageId, ids), eq(pageAppData.app, 'noted')));
  for (const row of dataRows) {
    const part = parts.get(row.pageId);
    if (part) part.appData = { data: row.data, revision: row.revision };
  }
  return parts;
}

export async function readNotes(
  db: PgHandle,
  home: NotesHome,
  rows: readonly PageRow[],
): Promise<Note[]> {
  const parts = await loadNoteParts(
    db,
    home.ownerId,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toNote(row, parts.get(row.id) as NoteParts));
}

/** A row of the notes database, or null when the id names anything else. */
export async function findNoteRow(
  db: PgHandle,
  home: NotesHome,
  id: string,
): Promise<PageRow | null> {
  const [row] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, id), eq(pages.databaseId, home.notes.id)))
    .limit(1);
  return row ?? null;
}

export type NoteView = 'active' | 'archived' | 'trashed';

/** `GET /notes`: one view of the notes, pinned first, then by order. */
export async function listNoteRows(
  db: PgHandle,
  home: NotesHome,
  filter: { view: NoteView; label?: string; folder?: string; pinned?: boolean },
): Promise<PageRow[]> {
  const conditions = [eq(pages.databaseId, home.notes.id), eq(pages.template, false)];
  const archivedProp = sql`coalesce((${pages.properties} -> ${NOTE_PROPERTY.archived} ->> 'checked')::boolean, false)`;
  if (filter.view === 'trashed') conditions.push(eq(pages.archived, true));
  else {
    conditions.push(eq(pages.archived, false));
    conditions.push(sql`${archivedProp} = ${filter.view === 'archived'}`);
  }
  if (filter.label) {
    conditions.push(
      sql`${pages.properties} -> ${NOTE_PROPERTY.labels} -> 'optionIds' ? ${filter.label}`,
    );
  }
  if (filter.folder) {
    conditions.push(
      sql`${pages.properties} -> ${NOTE_PROPERTY.folder} -> 'pageIds' ? ${filter.folder}`,
    );
  }
  if (filter.pinned !== undefined) {
    conditions.push(
      sql`coalesce((${pages.properties} -> ${NOTE_PROPERTY.pinned} ->> 'checked')::boolean, false) = ${filter.pinned}`,
    );
  }
  return db
    .select()
    .from(pages)
    .where(and(...conditions))
    .orderBy(
      desc(
        sql`coalesce((${pages.properties} -> ${NOTE_PROPERTY.pinned} ->> 'checked')::boolean, false)`,
      ),
      asc(pages.order),
      desc(pages.updatedAt),
    );
}

/**
 * The notes changed after `since` (all of them when null), keyset-paged on
 * `(updatedAt, id)` past `after`. One more than `limit` is read, only to know
 * whether another page follows.
 */
export async function noteRowsChangedSince(
  db: PgHandle,
  home: NotesHome,
  input: { since: Date | null; after: { updatedAt: Date; id: string } | null; limit: number },
): Promise<PageRow[]> {
  const conditions = [eq(pages.databaseId, home.notes.id), eq(pages.template, false)];
  if (input.since) conditions.push(gt(pages.updatedAt, input.since));
  if (input.after) {
    const after = or(
      gt(pages.updatedAt, input.after.updatedAt),
      and(eq(pages.updatedAt, input.after.updatedAt), gt(pages.id, input.after.id)),
    );
    if (after) conditions.push(after);
  }
  return db
    .select()
    .from(pages)
    .where(and(...conditions))
    .orderBy(asc(pages.updatedAt), asc(pages.id))
    .limit(input.limit + 1);
}

/** Notes deleted for good after `since`. */
export async function noteTombstonesSince(
  db: PgHandle,
  home: NotesHome,
  since: Date,
): Promise<string[]> {
  const rows = await db
    .select({ pageId: pageTombstones.pageId })
    .from(pageTombstones)
    .where(and(eq(pageTombstones.databaseId, home.notes.id), gt(pageTombstones.deletedAt, since)));
  return rows.map((row) => row.pageId);
}

// ── Labels: the options of the Labels property ───────────────────────

const SELECT_TO_NOTE: Record<SelectColor, NoteColor | null> = {
  default: null,
  gray: 'default',
  brown: 'brown',
  orange: 'orange',
  yellow: 'yellow',
  green: 'green',
  blue: 'blue',
  purple: 'purple',
  pink: 'pink',
  red: 'red',
};

export function labelOptions(home: NotesHome): SelectOption[] {
  const property = home.notes.propertiesSchema.properties.find(
    (p) => p.id === NOTE_PROPERTY.labels,
  );
  return property?.config?.options ?? [];
}

export const toLabel = (option: SelectOption): NoteLabel => ({
  id: option.id,
  name: option.name,
  color: SELECT_TO_NOTE[option.color] ?? null,
});

export const labelColor = (color: NoteColor | null | undefined): SelectColor =>
  noteColorInNilo(color ?? null);

// ── Folders: the rows of the folders database ────────────────────────

export async function listFolders(db: PgHandle, home: NotesHome): Promise<NoteFolder[]> {
  const rows = await db
    .select({ id: pages.id, title: pages.title, properties: pages.properties })
    .from(pages)
    .where(and(eq(pages.databaseId, home.folders.id), eq(pages.archived, false)))
    .orderBy(asc(pages.order), asc(pages.createdAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.title,
    parentId: relationIds(row.properties[FOLDER_PROPERTY.parent])[0] ?? null,
  }));
}

export async function findFolderRow(
  db: PgHandle,
  home: NotesHome,
  id: string,
): Promise<PageRow | null> {
  const [row] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, id), eq(pages.databaseId, home.folders.id)))
    .limit(1);
  return row ?? null;
}
