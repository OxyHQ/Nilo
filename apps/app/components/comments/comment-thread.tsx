import { CommentReactions } from './comment-reactions';
import * as React from 'react';
import { View } from 'react-native';
import { RiCheckLine } from '@oxy.so/bloom/icons/RiCheckLine';
import { RiCornerDownRightLine } from '@oxy.so/bloom/icons/RiCornerDownRightLine';
import { RiMessage2Line } from '@oxy.so/bloom/icons/RiMessage2Line';
import { RiMoreLine } from '@oxy.so/bloom/icons/RiMoreLine';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { RiArrowGoBackLine } from '@oxy.so/bloom/icons/RiArrowGoBackLine';
import { Button } from '@oxy.so/bloom/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import { useOxy } from '@oxy.so/services';
import {
  useDeleteComment,
  useResolveComment,
  useUnresolveComment,
  useCreateComment,
  type CommentThread as CommentThreadType,
} from '@/lib/hooks/use-comments';
import { CommentContentView } from './comment-content';
import { CommentComposer } from './comment-composer';
import { useTranslation } from '@/hooks/useTranslation';
import i18n from '@/lib/i18n';

interface CommentThreadProps {
  canComment?: boolean;
  thread: CommentThreadType;
  workspaceId: string;
  pageId: string;
}

function relativeTime(iso: string): string {
  const time = new Date(iso).getTime();
  const diffSec = Math.round((Date.now() - time) / 1000);
  if (diffSec < 60) return i18n.t('comments.time.justNow');
  if (diffSec < 3600)
    return i18n.t('comments.time.minutesAgo', { count: Math.round(diffSec / 60) });
  if (diffSec < 86400)
    return i18n.t('comments.time.hoursAgo', { count: Math.round(diffSec / 3600) });
  const diffDay = Math.round(diffSec / 86400);
  if (diffDay < 7) return i18n.t('comments.time.daysAgo', { count: diffDay });
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Renders a single comment thread (top-level root + replies). Owns the
 * reply composer state and the per-comment action menu.
 */
export function CommentThread({
  thread,
  workspaceId,
  pageId,
  canComment = true,
}: CommentThreadProps) {
  const { user } = useOxy();
  const { t } = useTranslation();
  const [replyOpen, setReplyOpen] = React.useState(false);
  const resolveMutation = useResolveComment();
  const unresolveMutation = useUnresolveComment();
  const deleteMutation = useDeleteComment();
  const createMutation = useCreateComment();

  const isResolved = thread.root.resolvedAt !== null;

  const handleToggleResolve = () => {
    if (isResolved) {
      unresolveMutation.mutate({ id: thread.root.id, pageId });
    } else {
      resolveMutation.mutate({ id: thread.root.id, pageId });
    }
  };

  const handleSubmitReply = async (segments: import('@/lib/types/comments').CommentSegment[]) => {
    await createMutation.mutateAsync({
      pageId,
      blockId: thread.root.blockId,
      parentCommentId: thread.root.id,
      content: { segments },
    });
    setReplyOpen(false);
  };

  return (
    <View className="rounded-xl border border-border bg-card px-3 py-3 gap-2">
      <CommentRow
        comment={thread.root}
        currentUserId={canComment ? (user?.id ?? null) : null}
        pageId={pageId}
        blockId={thread.root.blockId}
        onDelete={() =>
          deleteMutation.mutate({
            id: thread.root.id,
            pageId,
            blockId: thread.root.blockId,
          })
        }
        rightSlot={
          canComment ? (
            <Button
              appearance="subtle"
              size="xs"
              onPress={handleToggleResolve}
              disabled={resolveMutation.isPending || unresolveMutation.isPending}
              accessibilityLabel={
                isResolved ? t('comments.thread.reopenThread') : t('comments.thread.resolveThread')
              }
              renderLeadingIcon={({ size, color }) =>
                isResolved ? (
                  <RiArrowGoBackLine width={size} height={size} fill={color} />
                ) : (
                  <RiCheckLine width={size} height={size} fill={color} />
                )
              }
            >
              {isResolved ? t('comments.thread.reopen') : t('comments.thread.resolve')}
            </Button>
          ) : null
        }
      />

      {thread.replies.length > 0 ? (
        <View className="pl-4 gap-2 border-l border-border/40">
          {thread.replies.map((reply) => (
            <CommentRow
              key={reply.id}
              comment={reply}
              currentUserId={canComment ? (user?.id ?? null) : null}
              pageId={pageId}
              blockId={reply.blockId}
              compact
              onDelete={() =>
                deleteMutation.mutate({
                  id: reply.id,
                  pageId,
                  blockId: reply.blockId,
                })
              }
            />
          ))}
        </View>
      ) : null}

      {canComment && !isResolved ? (
        replyOpen ? (
          <View className="pl-4">
            <CommentComposer
              workspaceId={workspaceId}
              placeholder={t('comments.thread.replyPlaceholder')}
              autoFocus
              onSubmit={handleSubmitReply}
              onCancel={() => setReplyOpen(false)}
              submitting={createMutation.isPending}
            />
          </View>
        ) : (
          <Button
            appearance="subtle"
            size="xs"
            className="self-start"
            onPress={() => setReplyOpen(true)}
            accessibilityLabel={t('comments.thread.replyToThread')}
            leadingIcon={RiCornerDownRightLine}
          >
            {t('comments.thread.reply')}
          </Button>
        )
      ) : null}
    </View>
  );
}

interface CommentRowProps {
  comment: import('@/lib/types/comments').Comment;
  currentUserId: string | null;
  pageId: string;
  blockId: string | null;
  compact?: boolean;
  onDelete: () => void;
  rightSlot?: React.ReactNode;
}

function CommentRow({ comment, currentUserId, compact, onDelete, rightSlot }: CommentRowProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const isAuthor = currentUserId === comment.authorId;

  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-2">
        <View
          className={
            compact
              ? 'h-5 w-5 items-center justify-center rounded-full bg-muted'
              : 'h-7 w-7 items-center justify-center rounded-full bg-muted'
          }
        >
          <RiMessage2Line
            width={compact ? 10 : 12}
            height={compact ? 10 : 12}
            fill={colors.mutedForeground}
          />
        </View>
        <Text variant="caption-1-medium">
          {/* Phase 2 backend returns authorId only; profile hydration arrives later. */}
          {isAuthor ? t('comments.thread.you') : shortAuthor(comment.authorId)}
        </Text>
        <Text className="text-[10px] text-muted-foreground">
          {relativeTime(comment.createdAt)}
          {comment.editedAt ? ` · ${t('comments.thread.edited')}` : ''}
        </Text>
        <View className="flex-1" />
        {rightSlot}
        {isAuthor ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                appearance="subtle"
                size="xs"
                iconOnly
                accessibilityLabel={t('comments.thread.moreActions')}
                leadingIcon={RiMoreLine}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onPress={onDelete}
                leading={<RiDeleteBin6Line size="xs" fill={colors.foreground} />}
              >
                {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </View>
      <View className="pl-7">
        <CommentContentView content={comment.content} />
        <CommentReactions comment={comment} canComment={currentUserId !== null} />
      </View>
    </View>
  );
}

function shortAuthor(authorId: string): string {
  // Keep long account identifiers compact when profile data is unavailable.
  if (authorId.length > 8) return `${authorId.slice(0, 6)}…`;
  return authorId;
}
