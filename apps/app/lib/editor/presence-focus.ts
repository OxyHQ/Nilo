/**
 * Telling the page's room where this member is (`page:focus`): the block
 * their caret is in and what they have selected in its text, as Bloom's
 * relative positions (`selectionToRelative`), so every device draws it on the
 * same characters whatever was typed meanwhile (`components/page-editor/presence.ts`).
 */
import type { EditorStore } from '@oxy.so/bloom-editor';
import { type RelativeSelection, selectionToRelative } from '@oxy.so/bloom-editor/yjs';
import type * as Y from 'yjs';
import type { Collaborator } from './use-page-editor';

/** How often at most this member's selection is told to the room while it moves. */
export const SELECTION_BROADCAST_MS = 150;

/** Where this member is, as the room is told it (`page:focus`). */
export interface Focus {
  blockId: string | null;
  selection: RelativeSelection | null;
}

/**
 * Who is on the page once one of them has moved (`page:presence:focus`): in
 * their place, or added when their move arrives before the list that has them.
 */
export function withMove(list: readonly Collaborator[], moved: Collaborator): Collaborator[] {
  const at = list.findIndex(({ userId }) => userId === moved.userId);
  return at === -1 ? [...list, moved] : list.map((person, i) => (i === at ? moved : person));
}

/** The block and the text selected in `store`, as positions in `doc`. */
export function focusOf(store: EditorStore, doc: Y.Doc): Focus {
  const selection = store.selection;
  if (selection?.kind !== 'text') return { blockId: null, selection: null };
  const { blockId, start, end } = selection;
  return { blockId, selection: selectionToRelative(doc, { blockId, start, end }) };
}

/**
 * Tell the room which block this member is in and what they have selected,
 * whenever it changes: straight away after a pause, at most every
 * `SELECTION_BROADCAST_MS` while it moves (typing moves it each key), always
 * ending on where it settled. The offsets are compared, not the positions: a
 * position made again for the same offset is the same place.
 */
export function tellFocus(
  socket: { emit: (event: string, payload: unknown) => unknown },
  pageId: string,
  store: EditorStore,
  doc: Y.Doc,
  now: () => number = Date.now,
): () => void {
  // The room starts with this member in no block.
  let told = 'none';
  let lastSent = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const key = () => {
    const selection = store.selection;
    return selection?.kind === 'text'
      ? `${selection.blockId}:${selection.start}:${selection.end}`
      : 'none';
  };
  const send = () => {
    timer = undefined;
    const current = key();
    if (current === told) return;
    told = current;
    lastSent = now();
    socket.emit('page:focus', { pageId, ...focusOf(store, doc) });
  };
  const stop = store.subscribe(() => {
    if (timer !== undefined || key() === told) return;
    // Never from inside the store's change: the binding writes it into the
    // document after the store's listeners run, and positions are made there.
    timer = setTimeout(send, Math.max(0, lastSent + SELECTION_BROADCAST_MS - now()));
  });
  return () => {
    clearTimeout(timer);
    stop();
  };
}
