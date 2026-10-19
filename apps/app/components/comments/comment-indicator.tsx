import * as React from 'react';
import { View } from 'react-native';
import { RiMessage2Line } from '@oxy.so/bloom/icons/RiMessage2Line';
import { Button } from '@oxy.so/bloom/button';
import type { Comment } from '@/lib/types/comments';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * Open threads per block: top-level comments on a block not resolved. A reply
 * is part of its thread, not one more.
 */
export function openCommentCounts(
  comments: readonly Pick<Comment, 'blockId' | 'parentCommentId' | 'resolvedAt'>[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    if (!comment.blockId || comment.parentCommentId !== null || comment.resolvedAt !== null)
      continue;
    counts.set(comment.blockId, (counts.get(comment.blockId) ?? 0) + 1);
  }
  return counts;
}

/** What blocks carry a marker, and what pressing one does. */
interface BlockComments {
  counts: ReadonlyMap<string, number>;
  open: (blockId: string) => void;
}

const BlockCommentsContext = React.createContext<BlockComments | null>(null);

/** The page's open threads by block, for the markers drawn on its blocks. */
export function BlockCommentsProvider({
  counts,
  open,
  children,
}: BlockComments & { children: React.ReactNode }) {
  const value = React.useMemo(() => ({ counts, open }), [counts, open]);
  return <BlockCommentsContext.Provider value={value}>{children}</BlockCommentsContext.Provider>;
}

/**
 * A block's marker: "💬 N" when it has open threads, opening the comment
 * panel on that block. Nothing for a block without any, or outside a page
 * whose comments are shown.
 */
export function BlockCommentMarker({ blockId }: { blockId: string }) {
  const comments = React.useContext(BlockCommentsContext);
  const count = comments?.counts.get(blockId) ?? 0;
  if (!comments || count === 0) return null;
  return (
    <View className="mt-1 flex-row justify-end">
      <CommentIndicator count={count} onPress={() => comments.open(blockId)} />
    </View>
  );
}

export function CommentIndicator({ count, onPress }: { count: number; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      appearance="subtle"
      tone="accent"
      size="xs"
      onPress={onPress}
      accessibilityLabel={t('comments.indicator.count', { count })}
      leadingIcon={RiMessage2Line}
    >
      {String(count)}
    </Button>
  );
}
