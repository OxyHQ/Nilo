/**
 * System databases: databases Nilo keeps in a personal workspace for an app
 * built on it (`databases.system_key`). Noted's notes are the rows of `notes`,
 * filed in the rows of `note_folders`, and `routes/notes.ts` reads and writes
 * them by the fixed property ids below. `calendar` is the workspace's own
 * calendar (`routes/calendar.ts`, `docs/calendar.md`), made on first use.
 *
 * They are ordinary databases to everyone else: the owner opens, filters and
 * views them in Nilo like any other, and may add properties and views of
 * their own. What they cannot do is delete one, or remove or reshape a
 * property the app reads (`systemPropertyChangeError`), because the app would
 * lose the field without being told.
 */
import { NOTE_COLORS, type NoteColor } from '@oxy.so/nilo-contracts';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { PgHandle } from '../../db/client.js';
import {
  type DatabaseProperty,
  type DatabaseSchema,
  databases,
  type SelectColor,
  type SystemDatabaseKey,
} from '../../db/schema/databases.js';
import { pages, transactionTime } from '../../db/schema/pages.js';
import {
  type DatabaseRecord,
  demoteOtherDefaultViews,
  findDatabaseById,
  insertDatabase,
  insertDatabaseView,
} from '../../repositories/databases.js';
import { createDefaultViewForDatabase } from './create.js';
import { NAME_PROPERTY_ID } from './schema-defaults.js';

/** How a note colour shows in Nilo, whose palette is smaller. */
const NOTE_COLOR_IN_NILO: Record<NoteColor, SelectColor> = {
  default: 'default',
  teal: 'green',
  blue: 'blue',
  green: 'green',
  yellow: 'yellow',
  red: 'red',
  purple: 'purple',
  pink: 'pink',
  sky: 'blue',
  orange: 'orange',
  mint: 'green',
  pumpkin: 'orange',
  brown: 'brown',
};

export function noteColorInNilo(color: NoteColor | null): SelectColor {
  return color ? NOTE_COLOR_IN_NILO[color] : 'default';
}

/** The property ids of `notes`. `name` is the shared Name property, mirrored to the title. */
export const NOTE_PROPERTY = {
  name: NAME_PROPERTY_ID,
  color: 'note_color',
  labels: 'note_labels',
  folder: 'note_folder',
  pinned: 'note_pinned',
  archived: 'note_archived',
  kind: 'note_kind',
  attachments: 'note_attachments',
} as const;

/** The property ids of `note_folders`: a folder's subfolders and its parent are one two-way relation. */
export const FOLDER_PROPERTY = {
  name: NAME_PROPERTY_ID,
  parent: 'folder_parent',
  subfolders: 'folder_subfolders',
} as const;

/**
 * The property ids of `calendar`, the personal workspace's own calendar
 * (`docs/calendar.md`): an event is a row, its time the When date property.
 */
export const CALENDAR_PROPERTY = {
  name: NAME_PROPERTY_ID,
  when: 'event_when',
  location: 'event_location',
  url: 'event_url',
  description: 'event_description',
  attendees: 'event_attendees',
  color: 'event_color',
  recurrence: 'event_repeat',
  uid: 'event_uid',
  /**
   * A series' exceptions (`formatExceptions`): a subscribed calendar's only,
   * which reads them from its feed's EXDATEs and changed occurrences.
   */
  exceptions: 'event_exceptions',
} as const;

/** The colours a new calendar's events can take, in Nilo's palette. */
const CALENDAR_COLOR_OPTIONS: { id: string; name: string; color: SelectColor }[] = [
  { id: 'blue', name: 'Blue', color: 'blue' },
  { id: 'green', name: 'Green', color: 'green' },
  { id: 'yellow', name: 'Yellow', color: 'yellow' },
  { id: 'orange', name: 'Orange', color: 'orange' },
  { id: 'red', name: 'Red', color: 'red' },
  { id: 'pink', name: 'Pink', color: 'pink' },
  { id: 'purple', name: 'Purple', color: 'purple' },
  { id: 'brown', name: 'Brown', color: 'brown' },
  { id: 'gray', name: 'Gray', color: 'gray' },
];

function calendarSchema(): DatabaseSchema {
  return {
    properties: [
      { id: CALENDAR_PROPERTY.name, name: 'Name', type: 'text' },
      { id: CALENDAR_PROPERTY.when, name: 'When', type: 'date', config: { includeTime: true } },
      { id: CALENDAR_PROPERTY.location, name: 'Location', type: 'text' },
      { id: CALENDAR_PROPERTY.url, name: 'Meeting link', type: 'url' },
      { id: CALENDAR_PROPERTY.description, name: 'Description', type: 'text' },
      { id: CALENDAR_PROPERTY.attendees, name: 'Attendees', type: 'person' },
      {
        id: CALENDAR_PROPERTY.color,
        name: 'Color',
        type: 'select',
        config: { options: CALENDAR_COLOR_OPTIONS.map((o) => ({ ...o })) },
      },
      { id: CALENDAR_PROPERTY.recurrence, name: 'Repeat', type: 'text' },
      { id: CALENDAR_PROPERTY.uid, name: 'iCal UID', type: 'text' },
    ],
  };
}

function folderSchema(foldersId: string): DatabaseSchema {
  return {
    properties: [
      { id: FOLDER_PROPERTY.name, name: 'Name', type: 'text' },
      {
        id: FOLDER_PROPERTY.parent,
        name: 'Parent folder',
        type: 'relation',
        config: {
          targetDatabaseId: foldersId,
          twoWay: true,
          syncedPropertyId: FOLDER_PROPERTY.subfolders,
        },
      },
      {
        id: FOLDER_PROPERTY.subfolders,
        name: 'Subfolders',
        type: 'relation',
        config: {
          targetDatabaseId: foldersId,
          twoWay: true,
          syncedPropertyId: FOLDER_PROPERTY.parent,
        },
      },
    ],
  };
}

function noteSchema(foldersId: string): DatabaseSchema {
  const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    properties: [
      { id: NOTE_PROPERTY.name, name: 'Name', type: 'text' },
      {
        id: NOTE_PROPERTY.color,
        name: 'Color',
        type: 'select',
        config: {
          options: NOTE_COLORS.map((color) => ({
            id: color,
            name: capitalized(color),
            color: noteColorInNilo(color),
          })),
        },
      },
      { id: NOTE_PROPERTY.labels, name: 'Labels', type: 'multi_select', config: { options: [] } },
      {
        id: NOTE_PROPERTY.folder,
        name: 'Folder',
        type: 'relation',
        config: { targetDatabaseId: foldersId },
      },
      { id: NOTE_PROPERTY.pinned, name: 'Pinned', type: 'checkbox' },
      { id: NOTE_PROPERTY.archived, name: 'Archived', type: 'checkbox' },
      {
        id: NOTE_PROPERTY.kind,
        name: 'Kind',
        type: 'select',
        config: {
          options: [
            { id: 'note', name: 'Note', color: 'default' },
            { id: 'voice', name: 'Voice', color: 'purple' },
          ],
        },
      },
      { id: NOTE_PROPERTY.attachments, name: 'Attachments', type: 'files' },
    ],
  };
}

/**
 * The properties of a system database that are the app's, by id, and whether
 * the owner may still edit their options (a label is the user's to rename,
 * colour or add; the colours and kinds are fixed).
 */
const SYSTEM_PROPERTIES: Record<SystemDatabaseKey, Record<string, { optionsEditable: boolean }>> = {
  notes: {
    [NOTE_PROPERTY.name]: { optionsEditable: false },
    [NOTE_PROPERTY.color]: { optionsEditable: false },
    [NOTE_PROPERTY.labels]: { optionsEditable: true },
    [NOTE_PROPERTY.folder]: { optionsEditable: false },
    [NOTE_PROPERTY.pinned]: { optionsEditable: false },
    [NOTE_PROPERTY.archived]: { optionsEditable: false },
    [NOTE_PROPERTY.kind]: { optionsEditable: false },
    [NOTE_PROPERTY.attachments]: { optionsEditable: false },
  },
  note_folders: {
    [FOLDER_PROPERTY.name]: { optionsEditable: false },
    [FOLDER_PROPERTY.parent]: { optionsEditable: false },
    [FOLDER_PROPERTY.subfolders]: { optionsEditable: false },
  },
  calendar: {
    [CALENDAR_PROPERTY.name]: { optionsEditable: false },
    [CALENDAR_PROPERTY.when]: { optionsEditable: false },
    [CALENDAR_PROPERTY.location]: { optionsEditable: false },
    [CALENDAR_PROPERTY.url]: { optionsEditable: false },
    [CALENDAR_PROPERTY.description]: { optionsEditable: false },
    [CALENDAR_PROPERTY.attendees]: { optionsEditable: false },
    [CALENDAR_PROPERTY.color]: { optionsEditable: true },
    [CALENDAR_PROPERTY.recurrence]: { optionsEditable: false },
    [CALENDAR_PROPERTY.uid]: { optionsEditable: false },
  },
};

/**
 * Why a change to a system database's property is refused, or null when it is
 * allowed. Renaming is always allowed: the app reads ids, not names.
 */
export function systemPropertyChangeError(
  database: { systemKey: SystemDatabaseKey | null },
  current: DatabaseProperty,
  next: DatabaseProperty | null,
): string | null {
  if (!database.systemKey) return null;
  const rule = SYSTEM_PROPERTIES[database.systemKey][current.id];
  if (!rule) return null;
  if (!next) return `${current.name} is used by the app and cannot be removed`;
  if (next.type !== current.type) return `${current.name} is used by the app; its type is fixed`;
  if (rule.optionsEditable) {
    const { options: _options, ...restNext } = next.config ?? {};
    const { options: _current, ...restCurrent } = current.config ?? {};
    if (JSON.stringify(restNext) !== JSON.stringify(restCurrent)) {
      return `${current.name} is used by the app; only its options can change`;
    }
    return null;
  }
  if (JSON.stringify(next.config ?? {}) !== JSON.stringify(current.config ?? {})) {
    return `${current.name} is used by the app; its settings are fixed`;
  }
  return null;
}

/**
 * A label's own note colour survives an edit of the property from Nilo, whose
 * app does not send it, while the option's Nilo colour is unchanged.
 */
export function keepNoteColors(current: DatabaseProperty, next: DatabaseProperty): void {
  const before = new Map((current.config?.options ?? []).map((o) => [o.id, o]));
  for (const option of next.config?.options ?? []) {
    const was = before.get(option.id);
    if (option.noteColor === undefined && was?.noteColor && was.color === option.color) {
      option.noteColor = was.noteColor;
    }
  }
}

/** Why a system database cannot be deleted or archived, or null for any other database. */
export function systemDatabaseDeleteError(database: {
  systemKey: SystemDatabaseKey | null;
}): string | null {
  return database.systemKey
    ? 'This database belongs to an app and cannot be deleted; reset the workspace instead'
    : null;
}

export async function findSystemDatabase(
  db: PgHandle,
  workspaceId: string,
  key: SystemDatabaseKey,
): Promise<DatabaseRecord | null> {
  const [row] = await db
    .select({ id: databases.id })
    .from(databases)
    .where(and(eq(databases.workspaceId, workspaceId), eq(databases.systemKey, key)))
    .limit(1);
  return row ? findDatabaseById(db, row.id) : null;
}

interface SystemDatabaseBuild {
  name: string;
  icon: string;
  schema: DatabaseSchema;
  /** Views beyond the default table. */
  views?: (tx: PgHandle, databaseId: string) => Promise<void>;
}

/**
 * The system database `key` of a workspace, created with its views when
 * missing. A concurrent creator settles on `databases_workspace_system_key`:
 * the losing insert waits for the winner, inserts nothing, and the read that
 * follows (a new statement, so a new snapshot) sees the winner's row.
 */
async function ensureSystemDatabase(
  db: PgHandle,
  workspace: { id: string; ownerId: string },
  key: SystemDatabaseKey,
  build: (id: string) => SystemDatabaseBuild,
): Promise<DatabaseRecord> {
  const existing = await findSystemDatabase(db, workspace.id, key);
  if (existing) return existing;
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(databases)
      .values({
        workspaceId: workspace.id,
        ownerId: workspace.ownerId,
        // Private to the owner: a personal workspace has no one else, and a
        // note stays the owner's even if that ever changes.
        teamspaceId: null,
        systemKey: key,
      })
      .onConflictDoNothing({
        target: [databases.workspaceId, databases.systemKey],
        where: isNotNull(databases.systemKey),
      })
      .returning({ id: databases.id });
    if (!created) {
      const winner = await findSystemDatabase(tx, workspace.id, key);
      if (!winner) throw new Error(`system database ${key} of ${workspace.id} missing`);
      return winner;
    }
    // The schema names the database's own id (a self relation), so it is
    // written once the id exists.
    const { name, icon, schema, views } = build(created.id);
    await tx
      .update(databases)
      .set({ name, icon, propertiesSchema: schema })
      .where(eq(databases.id, created.id));
    await createDefaultViewForDatabase(tx, created.id);
    await views?.(tx, created.id);
    const record = await findDatabaseById(tx, created.id);
    if (!record) throw new Error(`system database ${key} vanished while being created`);
    return record;
  });
}

/**
 * The notes and folders databases of a personal workspace, made when missing.
 * Folders first: the notes' Folder property points at them.
 */
export async function ensureNoteDatabases(
  db: PgHandle,
  workspace: { id: string; ownerId: string },
): Promise<{ notes: DatabaseRecord; folders: DatabaseRecord }> {
  const folders = await ensureSystemDatabase(db, workspace, 'note_folders', (id) => ({
    name: 'Folders',
    icon: '📁',
    schema: folderSchema(id),
  }));
  const notes = await ensureSystemDatabase(db, workspace, 'notes', () => ({
    name: 'Notes',
    icon: '🗒️',
    schema: noteSchema(folders.id),
    views: addNotesGalleryView,
  }));
  return { notes, folders };
}

/**
 * The personal workspace's own calendar, made on first use. Private to the
 * owner, like the notes; it opens on its Calendar view, with the table of
 * every event beside it.
 */
export async function ensureCalendarDatabase(
  db: PgHandle,
  workspace: { id: string; ownerId: string },
): Promise<DatabaseRecord> {
  return ensureSystemDatabase(db, workspace, 'calendar', () => ({
    name: 'Calendar',
    icon: '📅',
    schema: calendarSchema(),
    views: addCalendarView,
  }));
}

/**
 * The database a calendar subscription keeps (`lib/calendar/subscriptions.ts`):
 * what an iCalendar feed holds, at the system calendar's property ids, plus
 * the series' exceptions. Private to the subscriber and read-only to everyone
 * (`databases.read_only`): only the subscription's refreshes write it.
 */
export async function createSubscribedCalendarDatabase(
  db: PgHandle,
  input: { workspaceId: string; ownerId: string; name: string },
): Promise<DatabaseRecord> {
  const database = await insertDatabase(db, {
    workspaceId: input.workspaceId,
    name: input.name,
    icon: '🗓️',
    cover: null,
    ownerId: input.ownerId,
    propertiesSchema: {
      properties: [
        { id: CALENDAR_PROPERTY.name, name: 'Name', type: 'text' },
        { id: CALENDAR_PROPERTY.when, name: 'When', type: 'date', config: { includeTime: true } },
        { id: CALENDAR_PROPERTY.location, name: 'Location', type: 'text' },
        { id: CALENDAR_PROPERTY.url, name: 'Link', type: 'url' },
        { id: CALENDAR_PROPERTY.description, name: 'Description', type: 'text' },
        { id: CALENDAR_PROPERTY.recurrence, name: 'Repeat', type: 'text' },
        { id: CALENDAR_PROPERTY.exceptions, name: 'Exceptions', type: 'text' },
        { id: CALENDAR_PROPERTY.uid, name: 'iCal UID', type: 'text' },
      ],
    },
    isInline: false,
    parentPageId: null,
    teamspaceId: null,
    archived: false,
    readOnly: true,
  });
  await createDefaultViewForDatabase(db, database.id);
  await addCalendarView(db, database.id, [CALENDAR_PROPERTY.exceptions]);
  return database;
}

async function addCalendarView(
  db: PgHandle,
  calendarId: string,
  alsoHidden: readonly string[] = [],
): Promise<void> {
  const view = await insertDatabaseView(db, {
    databaseId: calendarId,
    name: 'Calendar',
    type: 'calendar',
    isDefault: true,
    filters: { kind: 'group', combinator: 'and', filters: [] },
    sorts: [],
    groupBy: null,
    hiddenProperties: [CALENDAR_PROPERTY.uid, CALENDAR_PROPERTY.recurrence, ...alsoHidden],
    frozenProperties: [],
    pageSize: 50,
    config: { datePropertyId: CALENDAR_PROPERTY.when },
    order: -1,
  });
  await demoteOtherDefaultViews(db, calendarId, view.id);
}

/** A gallery of the notes not archived, pinned first: how Noted shows them. */
async function addNotesGalleryView(db: PgHandle, notesId: string): Promise<void> {
  await insertDatabaseView(db, {
    databaseId: notesId,
    name: 'Gallery',
    type: 'gallery',
    isDefault: false,
    filters: {
      kind: 'group',
      combinator: 'and',
      filters: [
        { kind: 'condition', propertyId: NOTE_PROPERTY.archived, operator: 'is', value: false },
      ],
    },
    sorts: [{ propertyId: NOTE_PROPERTY.pinned, direction: 'desc' }],
    groupBy: null,
    hiddenProperties: [],
    frozenProperties: [],
    pageSize: 50,
    config: { coverSource: 'pageCover' },
    order: 1,
  });
}

/**
 * Whether `databaseId` is a system database: an app syncs its rows, so a
 * change it cannot see in the row's own fields (a body edited in the editor)
 * still has to reach it as a change of the database.
 */
export async function isSystemDatabase(db: PgHandle, databaseId: string | null): Promise<boolean> {
  if (!databaseId) return false;
  const [row] = await db
    .select({ id: databases.id })
    .from(databases)
    .where(and(eq(databases.id, databaseId), isNotNull(databases.systemKey)))
    .limit(1);
  return row !== undefined;
}

/**
 * Move a system database row's `updatedAt` for a change kept outside the row
 * (its owner's reminder), so the app's next sync picks the row up. Rows of
 * other databases are left alone: for them `updatedAt` is when the content
 * was last edited, and a reminder is not an edit.
 */
export async function touchSystemRow(db: PgHandle, pageId: string): Promise<void> {
  await db
    .update(pages)
    .set({ updatedAt: transactionTime })
    .where(
      and(
        eq(pages.id, pageId),
        inArray(
          pages.databaseId,
          db.select({ id: databases.id }).from(databases).where(isNotNull(databases.systemKey)),
        ),
      ),
    );
}
