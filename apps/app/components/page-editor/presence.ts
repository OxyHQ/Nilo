import type { BlockDecoration, EditorStore, TextRangeDecoration } from '@oxy.so/bloom-editor';
import type { BlockTextSelection, RelativeSelection } from '@oxy.so/bloom-editor/yjs';
import type { Collaborator } from '@/lib/editor/use-page-editor';

const PRESENCE_COLORS = ['blue', 'purple', 'green', 'orange', 'pink', 'red'] as const;
type PresencePalette = Readonly<Record<string, { text: string; background?: string }>>;

function colorName(userId: string): (typeof PRESENCE_COLORS)[number] {
  let hash = 0;
  for (const char of userId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
}

/** Identity, rather than room order, chooses the same named color in every surface. */
export function collaboratorColor(userId: string, colors: PresencePalette): string {
  return colors[colorName(userId)].text;
}

/** The soft shade of that color, behind the text someone has selected. */
export function collaboratorTint(userId: string, colors: PresencePalette): string {
  const color = colors[colorName(userId)];
  return color.background ?? color.text;
}

/** Where a collaborator's selection is in the page now; null when it cannot be told. */
export type LocateSelection = (selection: RelativeSelection) => BlockTextSelection | null;

/**
 * What each block shows of who else is on the page. Someone whose selection
 * is found in the text (`locate`, against the page's document as it is now)
 * is drawn there: their selection in their color's shade, their caret at its
 * end with their name. Otherwise — no selection told, or one this device
 * cannot place yet — the block carries an edge in their color, as before
 * text could be marked.
 */
export function collaboratorDecorations(
  collaborators: readonly Collaborator[],
  currentUserId: string | undefined,
  colors: PresencePalette,
  nameOf: (id: string) => string,
  previous: ReadonlyMap<string, BlockDecoration> = new Map(),
  locate: LocateSelection = () => null,
): Map<string, BlockDecoration> {
  const edges = new Map<string, string[]>();
  const ranges = new Map<string, { userId: string; range: TextRangeDecoration }[]>();
  const placed = new Set<string>();
  for (const { userId, blockId, selection } of collaborators) {
    if (userId === currentUserId || !blockId || placed.has(userId)) continue;
    const found = selection && selection.blockId === blockId ? locate(selection) : null;
    if (found && found.blockId === blockId) {
      placed.add(userId);
      const list = ranges.get(blockId) ?? [];
      list.push({
        userId,
        range: {
          start: found.start,
          end: found.end,
          ...(found.start !== found.end && { background: collaboratorTint(userId, colors) }),
          caret: { color: collaboratorColor(userId, colors), label: nameOf(userId) },
        },
      });
      ranges.set(blockId, list);
      continue;
    }
    const ids = edges.get(blockId) ?? [];
    if (!ids.includes(userId)) ids.push(userId);
    edges.set(blockId, ids);
  }
  const next = new Map<string, BlockDecoration>();
  for (const [blockId, ids] of edges) {
    ids.sort();
    // Bloom draws one edge per block. Keep every person's name when carets coincide.
    next.set(blockId, {
      color: collaboratorColor(ids[0], colors),
      label: ids.map(nameOf).join(', '),
    });
  }
  for (const [blockId, list] of ranges) {
    // The same order on every device, whatever the room's.
    list.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
    const edge = next.get(blockId);
    const names = list.map(({ userId }) => nameOf(userId));
    next.set(blockId, {
      ...edge,
      label: edge?.label ? [edge.label, ...names].join(', ') : names.join(', '),
      ranges: list.map(({ range }) => range),
    });
  }
  return keepUnchanged(next, previous);
}

/** An anchored comment's text, found again in its block (`lib/comments/anchor.ts`). */
export interface CommentHighlight {
  blockId: string;
  start: number;
  end: number;
}

/**
 * The edge Bloom draws on a block, for every block with open comments
 * (`counts`) as well: someone's caret wins where both are, being where they
 * are now. The text open comments are on (`highlights`) is shaded
 * (`background`) under any collaborator's selection there. Bloom has no place
 * for a count on a text block (`BlockCommentMarker` draws it on Nilo's own).
 */
export function withCommentDecorations(
  carets: ReadonlyMap<string, BlockDecoration>,
  counts: ReadonlyMap<string, number>,
  color: string,
  labelOf: (count: number) => string,
  previous: ReadonlyMap<string, BlockDecoration> = new Map(),
  highlights: readonly CommentHighlight[] = [],
  background: string = color,
): Map<string, BlockDecoration> {
  const merged = new Map(carets);
  for (const [blockId, count] of counts) {
    if (count <= 0) continue;
    const caret = merged.get(blockId);
    if (caret?.color) continue;
    // A caret drawn in the text leaves the edge to the comments.
    merged.set(blockId, { ...caret, color, label: caret?.label ?? labelOf(count) });
  }
  const shaded = new Map<string, TextRangeDecoration[]>();
  for (const { blockId, start, end } of highlights) {
    if (start >= end) continue;
    const list = shaded.get(blockId) ?? [];
    list.push({ start, end, background });
    shaded.set(blockId, list);
  }
  for (const [blockId, list] of shaded) {
    list.sort((a, b) => a.start - b.start || a.end - b.end);
    const decoration = merged.get(blockId);
    // Under the carets: Bloom shows the last range's colour where two overlap.
    merged.set(blockId, { ...decoration, ranges: [...list, ...(decoration?.ranges ?? [])] });
  }
  return keepUnchanged(merged, previous);
}

function sameRange(a: TextRangeDecoration, b: TextRangeDecoration): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.background === b.background &&
    a.caret?.color === b.caret?.color &&
    a.caret?.label === b.caret?.label
  );
}

function sameDecoration(a: BlockDecoration, b: BlockDecoration): boolean {
  if (a.color !== b.color || a.label !== b.label) return false;
  const left = a.ranges ?? [];
  const right = b.ranges ?? [];
  return left.length === right.length && left.every((range, i) => sameRange(range, right[i]));
}

/**
 * The decorations as `previous` held them where nothing changed: Bloom
 * re-renders a block only when its decoration is a new object.
 */
function keepUnchanged(
  next: Map<string, BlockDecoration>,
  previous: ReadonlyMap<string, BlockDecoration>,
): Map<string, BlockDecoration> {
  for (const [blockId, decoration] of next) {
    const old = previous.get(blockId);
    if (old && old !== decoration && sameDecoration(old, decoration)) next.set(blockId, old);
  }
  return next;
}

/**
 * Draw now, and again whenever the page's text changes (someone typed before
 * a selection or a commented passage) — not when only this member's own
 * selection moves. Once per burst, after the change is in the page's
 * document too: the binding writes it there after the store's listeners run,
 * and selections are placed by the document.
 */
export function redrawOnChange(store: EditorStore | null, draw: () => void): () => void {
  draw();
  if (!store) return () => {};
  let shown = store.doc;
  let queued = false;
  let live = true;
  const stop = store.subscribe(() => {
    if (store.doc === shown || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!live) return;
      shown = store.doc;
      draw();
    });
  });
  return () => {
    live = false;
    stop();
  };
}
