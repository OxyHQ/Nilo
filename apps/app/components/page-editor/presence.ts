import type { BlockDecoration } from '@oxy.so/bloom-editor';
import type { Collaborator } from '@/lib/editor/use-page-editor';

const PRESENCE_COLORS = ['blue', 'purple', 'green', 'orange', 'pink', 'red'] as const;
type PresencePalette = Readonly<Record<string, { text: string }>>;

/** Identity, rather than room order, chooses the same named color in every surface. */
export function collaboratorColor(userId: string, colors: PresencePalette): string {
  let hash = 0;
  for (const char of userId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return colors[PRESENCE_COLORS[hash % PRESENCE_COLORS.length]].text;
}

export function collaboratorDecorations(
  collaborators: readonly Collaborator[],
  currentUserId: string | undefined,
  colors: PresencePalette,
  nameOf: (id: string) => string,
  previous: ReadonlyMap<string, BlockDecoration> = new Map(),
): Map<string, BlockDecoration> {
  const grouped = new Map<string, string[]>();
  for (const { userId, blockId } of collaborators) {
    if (userId === currentUserId || !blockId) continue;
    const ids = grouped.get(blockId) ?? [];
    if (!ids.includes(userId)) ids.push(userId);
    grouped.set(blockId, ids);
  }
  return new Map(
    [...grouped].map(([blockId, ids]) => {
      ids.sort();
      // Bloom draws one edge per block. Keep every person's name when carets coincide.
      const color = collaboratorColor(ids[0], colors);
      const label = ids.map(nameOf).join(', ');
      const old = previous.get(blockId);
      return [blockId, old?.color === color && old.label === label ? old : { color, label }];
    }),
  );
}
