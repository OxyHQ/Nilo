import { useCommentsLive } from '@/lib/realtime/use-live-updates';
import * as React from 'react';
import { View } from 'react-native';
import { RiChat3Line } from '@oxy.so/bloom/icons/RiChat3Line';
import { CloseButton } from '@oxy.so/bloom/button';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { PageFooter } from '@oxy.so/bloom/page-footer';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { useAppShellPanel } from '@oxy.so/bloom/app-shell/hooks';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectIcon,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
} from '@oxy.so/bloom/select';
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxy.so/bloom/segmented-control';
import { useColorScheme } from '@/lib/useColorScheme';
import { groupIntoThreads, useCreateComment, usePageComments } from '@/lib/hooks/use-comments';
import { CommentComposer } from './comment-composer';
import { CommentThread } from './comment-thread';
import type { CommentAnchor, CommentSegment } from '@/lib/types/comments';
import { CommentQuote } from './comment-quote';
import { useTranslation } from '@/hooks/useTranslation';
import { profileName, useMemberProfiles } from '@/lib/hooks/use-member-profiles';
import { threadIncludesPerson } from '@/lib/comments/thread-order';
import { useThreadOrder } from './use-thread-order';

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
 * The comments screen. The enclosing Bloom panel compositor owns its inline
 * or floating presentation; this screen owns one list and its composer.
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
  const { presentation } = useAppShellPanel();
  const [filter, setFilter] = React.useState<FilterMode>('open');
  const [personFilter, setPersonFilter] = React.useState({ pageId, id: '' });
  const person = personFilter.pageId === pageId ? personFilter.id : '';
  const { data, isLoading, isError, refetch } = usePageComments(open ? pageId : undefined, true);
  const createMutation = useCreateComment();
  const authorIds = React.useMemo(
    () => [...new Set((data?.comments ?? []).map((comment) => comment.authorId))],
    [data?.comments],
  );
  const { data: profiles } = useMemberProfiles(open ? authorIds : []);
  const personOptions = React.useMemo(
    () => [
      { value: '', label: t('comments.filters.everyone') },
      ...authorIds.map((id) => ({
        value: id,
        label: profileName(profiles?.find((profile) => profile.id === id)) ?? id,
      })),
    ],
    [authorIds, profiles, t],
  );
  const grouped = React.useMemo(() => groupIntoThreads(data?.comments ?? []), [data?.comments]);
  const ordered = useThreadOrder(grouped, pageId, open);

  const threads = React.useMemo(() => {
    return ordered.filter((thread) => {
      if (focusedBlockId && thread.root.blockId !== focusedBlockId) return false;
      if (person && !threadIncludesPerson(thread, person)) return false;
      return filter === 'all' || (filter === 'resolved') === (thread.root.resolvedAt !== null);
    });
  }, [ordered, focusedBlockId, filter, person]);

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

  return (
    <Screen
      scroll="auto"
      active={open}
      bottomBarKeyboardBehavior="follow"
      header={
        <PageHeader
          presentation="bar"
          safeArea={false}
          title={headerTitle}
          leading={<RiChat3Line size="sm" fill={colors.foreground} />}
          actions={
            presentation === 'floating' ? undefined : (
              <CloseButton onPress={onClose} accessibilityLabel={t('comments.panel.close')} />
            )
          }
          accessory={
            <View className="gap-2">
              <SegmentedControl
                type="tabs"
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
              {authorIds.length > 0 ? (
                <Select value={person} onValueChange={(id) => setPersonFilter({ pageId, id })}>
                  <SelectTrigger label={t('comments.filters.person')}>
                    <SelectValue placeholder={t('comments.filters.everyone')} />
                    <SelectIcon />
                  </SelectTrigger>
                  <SelectContent
                    label={t('comments.filters.person')}
                    items={personOptions}
                    renderItem={(item) => (
                      <SelectItem value={item.value} label={item.label}>
                        <SelectItemIndicator />
                        <SelectItemText>{item.label}</SelectItemText>
                      </SelectItem>
                    )}
                  />
                </Select>
              ) : null}
            </View>
          }
        />
      }
      bottomBar={
        canComment ? (
          <PageFooter>
            <View className="gap-2">
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
          </PageFooter>
        ) : null
      }
    >
      <ScreenScrollView contentContainerClassName="p-3 gap-3" keyboardShouldPersistTaps="handled">
        {isLoading ? (
          <View className="items-center py-8">
            <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
          </View>
        ) : isError ? (
          <EmptyState
            variant="compact"
            description={t('comments.panel.loadFailed')}
            action={{ label: t('common.tryAgain'), onPress: () => refetch() }}
          />
        ) : threads.length === 0 ? (
          <EmptyState
            variant="compact"
            // icon: CheckCheck
            description={
              person
                ? t('comments.panel.emptyPerson')
                : filter === 'resolved'
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
              profiles={profiles}
            />
          ))
        )}
      </ScreenScrollView>
    </Screen>
  );
}
