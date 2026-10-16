/**
 * Noted's notes, as Nilo notes: the conversion `scripts/import-noted.ts` runs
 * on every note it copies. Pure, so what an imported note becomes can be read
 * and tested without either database.
 *
 * Noted's body is plain text with a small Markdown subset, and its checklist
 * a separate list; in Nilo both are blocks, the checklist as `todo` blocks
 * after the text, where Noted showed it.
 */
import {
  type BlockNode,
  markdownToBlocks,
  NOTE_COLORS,
  type NoteBlock,
  type NoteColor,
  type NoteCreate,
  normalizeContent,
} from '@oxy.so/nilo-contracts';
import { uuidv7 } from '@oxy.so/db';

/** A note as Noted stores it (`notes` row), the columns the import reads. */
export interface NotedNote {
  id: string;
  oxyUserId: string;
  kind: string;
  title: string;
  body: string;
  checklist: { id?: string; text?: string; checked?: boolean }[];
  color: string;
  labels: string[];
  folderId: string | null;
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  attachments: string[];
  reminderAt: Date | null;
  reminderSentAt: Date | null;
  sortOrder: number;
  createdAt: Date;
}

export interface NotedLabel {
  id: string;
  name: string;
  color: string | null;
}

export interface NotedFolder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface NotedRevision {
  noteId: string;
  title: string;
  body: string;
  checklist: NotedNote['checklist'];
  createdAt: Date;
}

/** Noted's own colour coercion (`@noted/shared-types` `normalizeNoteColor`). */
const LEGACY_COLORS: Record<string, NoteColor> = {
  darkblue: 'blue',
  amber: 'pumpkin',
  gray: 'default',
};

export function notedColor(color: unknown): NoteColor {
  if (typeof color === 'string') {
    if ((NOTE_COLORS as readonly string[]).includes(color)) return color as NoteColor;
    if (color in LEGACY_COLORS) return LEGACY_COLORS[color] as NoteColor;
  }
  return 'default';
}

/** Block trees, flat, with fresh ids: parents before children, siblings in order. */
function flatten(nodes: readonly BlockNode[], parentBlockId: string | null = null): NoteBlock[] {
  return nodes.flatMap((node, order) => {
    const id = uuidv7();
    return [
      {
        id,
        parentBlockId,
        type: node.type,
        content: normalizeContent(node.type, node.content),
        order,
      },
      ...flatten(node.children, id),
    ];
  });
}

/** A Noted body and checklist, as a Nilo note's blocks. */
export function notedBlocks(body: string, checklist: NotedNote['checklist']): NoteBlock[] {
  const text = body.trim() ? markdownToBlocks(body) : [];
  const todos: BlockNode[] = checklist
    .filter((item) => (item.text ?? '').trim() !== '' || item.checked)
    .map((item) => ({
      type: 'todo',
      content: { text: item.text ?? '', checked: item.checked === true },
      children: [],
    }));
  return flatten([...text, ...todos]);
}

/**
 * The note to create in Nilo, under Noted's id. Labels and folders are given
 * by their Nilo ids (`labelIds`, `folderIds` map Noted's); one that did not
 * come across is left out rather than failing the note. A reminder is left to
 * the caller, which also has to say whether it already went off.
 */
export function notedNoteToCreate(
  note: NotedNote,
  maps: { labelIds: ReadonlyMap<string, string>; folderIds: ReadonlyMap<string, string> },
  appData: Record<string, unknown> | null,
): NoteCreate {
  return {
    id: note.id,
    title: note.title,
    blocks: notedBlocks(note.body, note.checklist),
    color: notedColor(note.color),
    labels: note.labels.flatMap((id) => {
      const mapped = maps.labelIds.get(id);
      return mapped ? [mapped] : [];
    }),
    folderId: note.folderId ? (maps.folderIds.get(note.folderId) ?? null) : null,
    pinned: note.pinned,
    archived: note.archived,
    trashed: note.trashed,
    kind: note.kind === 'voice' ? 'voice' : 'note',
    attachments: note.attachments,
    order: note.sortOrder,
    ...(appData && { appData: { data: appData, baseRevision: 0 } }),
  };
}

/** Folders in an order that creates every parent before its children. */
export function foldersParentsFirst(folders: readonly NotedFolder[]): NotedFolder[] {
  const ids = new Set(folders.map((f) => f.id));
  const placed = new Set<string>();
  const ordered: NotedFolder[] = [];
  let pending = [...folders];
  while (pending.length > 0) {
    const ready = pending.filter(
      (f) => !f.parentId || !ids.has(f.parentId) || placed.has(f.parentId),
    );
    // A cycle left in Noted's data: what remains goes to the top level.
    const next = ready.length > 0 ? ready : pending.map((f) => ({ ...f, parentId: null }));
    for (const folder of next) {
      ordered.push(folder);
      placed.add(folder.id);
    }
    const done = new Set(next.map((f) => f.id));
    pending = pending.filter((f) => !done.has(f.id));
  }
  return ordered;
}
