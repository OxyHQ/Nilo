/**
 * Where an inline comment's text is now. A comment keeps the offsets its
 * text had when it was written and the text itself (`CommentAnchor`); edits
 * before it move it, so the text is looked for again: where it was, else the
 * nearest place it is, else it is gone ("original text changed").
 */
import type { EditorStore } from '@oxy.so/bloom-editor';
import { segmentsToPlainText } from '@oxy.so/bloom-text/model';
import type { CommentAnchor } from '@/lib/types/comments';

/** The most text a comment may quote (the API's limit). */
export const MAX_QUOTE_LENGTH = 2000;

/** The anchor for `start`–`end` of a block's text, or null for nothing worth quoting. */
export function anchorFor(text: string, start: number, end: number): CommentAnchor | null {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(text.length, Math.max(start, end));
  const quote = text.slice(from, to);
  if (!quote.trim() || quote.length > MAX_QUOTE_LENGTH) return null;
  return { start: from, end: to, quote };
}

/** Where the anchored text is in `text` now, or null when it is no longer there. */
export function locateAnchor(
  text: string,
  anchor: CommentAnchor,
): { start: number; end: number } | null {
  const { start, end, quote } = anchor;
  if (text.slice(start, end) === quote) return { start, end };
  let best: number | null = null;
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    if (best === null || Math.abs(at - start) < Math.abs(best - start)) best = at;
  }
  return best === null ? null : { start: best, end: best + quote.length };
}

/** A block's text as offsets count it (the editor's own measure). */
export function blockText(store: EditorStore, blockId: string): string | null {
  const block = store.doc.blocks[blockId];
  return block?.text ? segmentsToPlainText(block.text) : null;
}

/**
 * The text selected in the editor, as a comment's anchor: in `blockId` when
 * given (a block's menu acts on its own block), null when nothing is selected
 * there.
 */
export function selectionAnchor(
  store: EditorStore,
  blockId?: string,
): { blockId: string; anchor: CommentAnchor } | null {
  const selection = store.selection;
  if (selection?.kind !== 'text' || selection.start === selection.end) return null;
  if (blockId !== undefined && selection.blockId !== blockId) return null;
  const text = blockText(store, selection.blockId);
  const anchor = text === null ? null : anchorFor(text, selection.start, selection.end);
  return anchor ? { blockId: selection.blockId, anchor } : null;
}
