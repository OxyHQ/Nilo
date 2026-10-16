/**
 * Notes: the contract of `/notes`, Nilo's API for Noted.
 *
 * A note is a row of the personal workspace's `notes` system database: a page
 * whose content is ordinary blocks (a checklist is `todo` blocks where they
 * stand) and whose fields are the database's properties. Noted keeps a copy
 * on the device and syncs it through `GET /notes/sync`.
 */
import { z } from 'zod';
import { type BlockContent, type BlockType, blockTypeSchema } from './blocks';

/** The note colours, each the id of an option of the notes' Color property. */
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

/** A block of a note, flat: the tree is `parentBlockId`, siblings go by `order`. */
export interface NoteBlock {
  id: string;
  parentBlockId: string | null;
  type: BlockType;
  content: BlockContent;
  order: number;
}

/** What Noted keeps about a note besides its content (recording artifacts and overrides). */
export interface NoteAppData {
  data: Record<string, unknown>;
  /** Moves on every write; a write made on an older one is refused. */
  revision: number;
}

export interface Note {
  id: string;
  title: string;
  blocks: NoteBlock[];
  /** The page's blocks version, for the editor's own transactions. */
  blocksVersion: number;
  color: NoteColor;
  /** Label ids (`NoteLabel.id`). */
  labels: string[];
  folderId: string | null;
  pinned: boolean;
  archived: boolean;
  /** In the trash: the page is archived. */
  trashed: boolean;
  kind: NoteKind;
  /** Oxy file ids. */
  attachments: string[];
  /**
   * The attachments Oxy has said it no longer serves — deleted, moved to their
   * owner's trash, or taken down (Oxy ADR 0043 file events): show them as
   * removed, never from a copy kept on the device.
   */
  removedAttachments: string[];
  /** The owner's reminder on the note, delivered or not; null when there is none. */
  reminderAt: string | null;
  order: number;
  appData: NoteAppData | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteLabel {
  id: string;
  name: string;
  color: NoteColor | null;
}

export interface NoteFolder {
  id: string;
  name: string;
  parentId: string | null;
}

/** A page of `GET /notes/sync`. */
export interface NotesSyncPage {
  notes: Note[];
  /** Notes deleted for good since the cursor. */
  deleted: string[];
  /** Every label and folder, on the last page of a pass. */
  labels?: NoteLabel[];
  folders?: NoteFolder[];
  /** The cursor for the next request: the next page, or the next pass. */
  cursor: string;
  hasMore: boolean;
  /**
   * This pass is the whole set, not changes: the client drops whatever it
   * holds that the pass does not return (a first sync, or a cursor older than
   * the server remembers deletions for).
   */
  full: boolean;
  /**
   * The cursor was for notes that no longer exist: the workspace was reset
   * since. The client drops everything it holds of them first — unsent edits
   * included, or uploading them would bring back what was reset — and then
   * takes this pass, which is the whole (new) set.
   */
  reset: boolean;
}

/** `GET /notes/export`: everything Noted keeps, to take away. */
export interface NotesExport {
  exportedAt: string;
  notes: Note[];
  labels: NoteLabel[];
  folders: NoteFolder[];
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const idSchema = z.string().min(1).max(200);

export const noteBlockSchema = z.object({
  id: z.string().regex(UUID_V7, 'Block ids are UUIDv7'),
  parentBlockId: z.string().regex(UUID_V7).nullable(),
  type: blockTypeSchema,
  content: z.record(z.unknown()),
  order: z.number().finite(),
});

/** A note's fields as written; every field is optional on a PATCH and absent means unchanged. */
export const noteWriteSchema = z
  .object({
    title: z.string().max(1000),
    blocks: z.array(noteBlockSchema).max(5000),
    color: z.enum(NOTE_COLORS),
    labels: z.array(idSchema).max(100),
    folderId: idSchema.nullable(),
    pinned: z.boolean(),
    archived: z.boolean(),
    trashed: z.boolean(),
    kind: z.enum(NOTE_KINDS),
    attachments: z.array(idSchema).max(100),
    reminderAt: z.string().datetime({ offset: true }).nullable(),
    order: z.number().finite(),
    /** The note's `updatedAt` this edit was made on; a stale one is answered 409 with the note. */
    baseUpdatedAt: z.string().datetime({ offset: true }),
    /** The app data, written whole, on top of `baseRevision`. */
    appData: z.object({
      data: z.record(z.unknown()),
      baseRevision: z.number().int().min(0),
    }),
  })
  .partial();
export type NoteWrite = z.infer<typeof noteWriteSchema>;

/** `POST /notes`: the fields, and optionally the id the device made the note under. */
export const noteCreateSchema = noteWriteSchema
  .omit({ baseUpdatedAt: true })
  .extend({ id: z.string().regex(UUID_V7, 'Note ids are UUIDv7').optional() });
export type NoteCreate = z.infer<typeof noteCreateSchema>;

export const noteLabelWriteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.enum(NOTE_COLORS).nullable().optional(),
});

export type NoteLabelWrite = z.infer<typeof noteLabelWriteSchema>;

export const noteFolderWriteSchema = z.object({
  name: z.string().trim().min(1).max(200),
  parentId: idSchema.nullable().optional(),
});
export type NoteFolderWrite = z.infer<typeof noteFolderWriteSchema>;
