/**
 * System databases: databases Nilo keeps in a personal workspace for an app
 * built on it (`databases.system_key`). Noted's notes are the rows of `notes`,
 * filed in the rows of `note_folders`, and `routes/notes.ts` reads and writes
 * them by the fixed property ids below.
 *
 * They are ordinary databases to everyone else: the owner opens, filters and
 * views them in Nilo like any other, and may add properties and views of
 * their own. What they cannot do is delete one, or remove or reshape a
 * property the app reads (`systemPropertyChangeError`), because the app would
 * lose the field without being told.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import type { PgHandle } from '../../db/client.js';
import {
  type DatabaseProperty,
  type DatabaseSchema,
  databases,
  type SelectColor,
  type SystemDatabaseKey,
} from '../../db/schema/databases.js';
import {
  type DatabaseRecord,
  findDatabaseById,
  insertDatabaseView,
} from '../../repositories/databases.js';
import { createDefaultViewForDatabase } from './create.js';
import { NAME_PROPERTY_ID } from './schema-defaults.js';

/** The note colours (`@noted/shared-types` `NOTE_COLORS`): each is a Color option's id. */
export const NOTE_COLORS = [
  'default',
  'teal',
  'blue',
  'green',
  'yellow',
  'red',
  'purple',
  'pink',
  'sky',
  'orange',
  'mint',
  'pumpkin',
  'brown',
] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export const NOTE_KINDS = ['note', 'voice'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

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
