import { useCommentsLive } from '@/lib/realtime/use-live-updates';
import * as React from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { RiChat3Line } from '@oxy.so/bloom/icons/RiChat3Line';
import { CloseButton } from '@oxy.so/bloom/button';
import { Dialog } from '@oxy.so/bloom/dialog';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxy.so/bloom/segmented-control';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import { groupIntoThreads, useCreateComment, usePageComments } from '@/lib/hooks/use-comments';
import { CommentComposer } from './comment-composer';
import { CommentThread } from './comment-thread';
import type { CommentAnchor, CommentSegment } from '@/lib/types/comments';
import { CommentQuote } from './comment-quote';
import { useTranslation } from '@/hooks/useTranslation';

type FilterMode = 'all' | 'open' | 'resolved';

interface CommentPanelProps {
  canComment?: boolean;
  pageId: string;
  workspaceId: string;
  open: boolean;
  onClose: () => void;
  /**
   * When set, scoped to comments on a specific block. The page-level
   * composer is hidden; the thread list filters to that block.
   */
  focusedBlockId?: string | null;
  /** The text the next comment is on (`focusedBlockId`'s), when asked for on a selection. */
  anchor?: CommentAnchor | null;
  /** The anchor was used, or put aside for a comment on the whole block. */
  onAnchorUsed?: () => void;
}

/**
 * Right-side comment panel. On web slides in from the right; on native it
 * presents as a modal sheet. Lists comment threads grouped by top-level
 * comment, with All / Open / Resolved filters and a page-level composer at
 * the bottom.
 */
export function CommentPanel({
  pageId,
  workspaceId,
  open,
  onClose,
  focusedBlockId,
  anchor = null,
  onAnchorUsed,
  canComment = true,
}: CommentPanelProps) {
  useCommentsLive(open ? pageId : undefined);
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [filter, setFilter] = React.useState<FilterMode>('open');
  const includeResolved = filter !== 'open';
  const { data, isLoading } = usePageComments(open ? pageId : undefined, includeResolved);
  const createMutation = useCreateComment();

  const threads = React.useMemo(() => {
    const comments = data?.comments ?? [];
    const filteredByBlock = focusedBlockId
      ? comments.filter(
          (c) =>
            c.blockId === focusedBlockId ||
            (c.parentCommentId !== null &&
              comments.some((p) => p.id === c.parentCommentId && p.blockId === focusedBlockId)),
        )
      : comments;
    const grouped = groupIntoThreads(filteredByBlock);
    if (filter === 'resolved') {
      return grouped.filter((t) => t.root.resolvedAt !== null);
    }
    if (filter === 'open') {
      return grouped.filter((t) => t.root.resolvedAt === null);
    }
    return grouped;
  }, [data?.comments, focusedBlockId, filter]);

  // An anchor is on its own block's text only.
  const quoted = focusedBlockId ? anchor : null;
  const handleSubmit = async (segments: CommentSegment[]) => {
    await createMutation.mutateAsync({
      pageId,
      blockId: focusedBlockId ?? null,
      parentCommentId: null,
      anchor: quoted,
      content: { segments },
    });
    if (quoted) onAnchorUsed?.();
  };

  const headerTitle = focusedBlockId ? t('comments.panel.blockTitle') : t('comments.panel.title');

  const body = (
    <View
      className={
        Platform.OS === 'web' ? 'h-full flex-1 border-l border-border bg-background' : 'flex-1'
      }
      style={Platform.OS === 'web' ? { width: 360, maxWidth: '100%' } : undefined}
    >
      <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
        <View className="flex-row items-center gap-2">
          <RiChat3Line size="sm" fill={colors.foreground} />
          <Text variant="body-semibold">{headerTitle}</Text>
        </View>
        <CloseButton onPress={onClose} accessibilityLabel={t('comments.panel.close')} />
      </View>

      <View className="border-b border-border px-4 py-2">
        <SegmentedControl
          type="tabs"
          size="sm"
          value={filter}
          onValueChange={(mode: FilterMode) => setFilter(mode)}
        >
          {(['open', 'all', 'resolved'] as FilterMode[]).map((mode) => (
            <SegmentedControlItem key={mode} value={mode}>
              <SegmentedControlItemText>
                {mode === 'open'
                  ? t('comments.filters.open')
                  : mode === 'all'
                    ? t('comments.filters.all')
                    : t('comments.filters.resolved')}
              </SegmentedControlItemText>
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="p-3 gap-3">
        {isLoading ? (
          <View className="items-center py-8">
            <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
          </View>
        ) : threads.length === 0 ? (
          <EmptyState
            variant="compact"
            // icon: CheckCheck
            description={
              filter === 'resolved'
                ? t('comments.panel.emptyResolved')
                : filter === 'open'
                  ? t('comments.panel.emptyOpen')
                  : t('comments.panel.emptyAll')
            }
          />
        ) : (
          threads.map((thread) => (
            <CommentThread
              key={thread.root.id}
              thread={thread}
              canComment={canComment}
              workspaceId={workspaceId}
              pageId={pageId}
            />
          ))
        )}
      </ScrollView>

      {canComment ? (
        <View className="border-t border-border p-3 gap-2">
          {quoted ? (
            <View className="flex-row items-start gap-2">
              <View className="flex-1">
                <CommentQuote blockId={focusedBlockId ?? null} anchor={quoted} />
              </View>
              <CloseButton
                onPress={() => onAnchorUsed?.()}
                accessibilityLabel={t('comments.panel.cancelQuote')}
              />
            </View>
          ) : null}
          <CommentComposer
            workspaceId={workspaceId}
            placeholder={
              quoted
                ? t('comments.panel.textPlaceholder')
                : focusedBlockId
                  ? t('comments.panel.blockPlaceholder')
                  : t('comments.panel.pagePlaceholder')
            }
            onSubmit={handleSubmit}
            submitting={createMutation.isPending}
          />
        </View>
      ) : null}
    </View>
  );

  if (Platform.OS === 'web') {
    if (!open) return null;
    return (
      <View style={styles.webOverlay} pointerEvents="box-none">
        <View style={styles.webPanel} pointerEvents="auto">
          {body}
        </View>
      </View>
    );
  }

  // Native: a bottom sheet. The route owns `open`, so this is Bloom's
  // controlled mode — a backdrop press or drag asks the route via `onClose`.
  return (
    <Dialog
      open={open}
      onClose={onClose}
      placement="bottom"
      scrollable={false}
      contentPadding={0}
      label={headerTitle}
    >
      {body}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  webOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
  },
  webPanel: {
    height: '100%',
  },
});
