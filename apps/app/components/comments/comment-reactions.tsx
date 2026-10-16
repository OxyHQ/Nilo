import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useOxy } from '@oxy.so/services';
import { useIsMutating } from '@tanstack/react-query';
import { SmilePlus } from 'lucide-react-native';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useCommentReaction } from '@/lib/hooks/use-comments';
import { profileName, useMemberProfiles } from '@/lib/hooks/use-member-profiles';
import type { Comment } from '@/lib/types/comments';
import { EMOJI_CATEGORIES } from '@/components/page-chrome/emoji-data';

const commonEmoji = new Set(['👍', '❤️', '🎉', '😂', '😮', '😢', '🔥', '👀']);
const emojiChoices = EMOJI_CATEGORIES.flatMap((category) => category.emojis).filter((entry) =>
  commonEmoji.has(entry.emoji),
);

export function CommentReactions({
  comment,
  canComment,
}: {
  comment: Comment;
  canComment: boolean;
}) {
  const { t } = useTranslation();
  const { user } = useOxy();
  const mutation = useCommentReaction();
  const pending =
    useIsMutating({
      mutationKey: ['comment-reaction'],
      predicate: (m) =>
        (m.state.variables as { comment?: Comment } | undefined)?.comment?.id === comment.id,
    }) > 0;
  const picker = useDialogControl();
  const [peopleEmoji, setPeopleEmoji] = useState<string | null>(null);
  const profiles = useMemberProfiles(comment.reactions.flatMap((r) => r.userIds));
  const people = comment.reactions
    .find((r) => r.emoji === peopleEmoji)
    ?.userIds.map(
      (id) =>
        profileName(profiles.data?.find((p) => p.id === id)) || t('comments.reactions.someone'),
    )
    .join(', ');
  const toggle = (emoji: string) => {
    if (!canComment || pending || !user?.id) return;
    mutation.mutate({
      comment,
      emoji,
      remove: comment.reactions.some((r) => r.emoji === emoji && r.userIds.includes(user.id)),
    });
    picker.close();
  };
  return (
    <View className="gap-1">
      <View className="flex-row flex-wrap items-center gap-1">
        {comment.reactions.map((reaction) => {
          const selected = Boolean(user?.id && reaction.userIds.includes(user.id));
          return (
            <Pressable
              key={reaction.emoji}
              accessibilityRole="button"
              accessibilityLabel={t('comments.reactions.toggle', {
                emoji: reaction.emoji,
                count: reaction.userIds.length,
              })}
              accessibilityState={{ selected, disabled: !canComment || pending }}
              onPress={() => toggle(reaction.emoji)}
              onLongPress={() => setPeopleEmoji(reaction.emoji)}
              onHoverIn={() => setPeopleEmoji(reaction.emoji)}
              onHoverOut={() => setPeopleEmoji(null)}
              className={`rounded-full border px-2 py-1 ${selected ? 'bg-accent border-primary' : 'bg-muted border-border'}`}
            >
              <Text variant="caption-1-regular">
                {reaction.emoji} {reaction.userIds.length}
              </Text>
            </Pressable>
          );
        })}
        {canComment ? (
          <Button
            appearance="subtle"
            size="sm"
            iconOnly
            disabled={pending}
            accessibilityLabel={t('comments.reactions.add')}
            onPress={() => picker.open()}
            renderLeadingIcon={({ size, color }) => <SmilePlus size={size} color={color} />}
          />
        ) : null}
      </View>
      {people ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('comments.reactions.closePeople')}
          onPress={() => setPeopleEmoji(null)}
        >
          <Text className="text-xs text-muted-foreground">{people}</Text>
        </Pressable>
      ) : null}
      {mutation.isError ? (
        <Text accessibilityRole="alert" className="text-xs text-destructive">
          {t('comments.reactions.failed')}
        </Text>
      ) : null}
      <Dialog
        control={picker}
        title={t('comments.reactions.add')}
        placement={{ base: 'bottom', md: 'center' }}
        maxWidth={320}
      >
        <View className="flex-row flex-wrap gap-2">
          {emojiChoices.map(({ emoji }) => (
            <Button
              key={emoji}
              appearance="subtle"
              accessibilityLabel={t('comments.reactions.choose', { emoji })}
              onPress={() => toggle(emoji)}
            >
              {emoji}
            </Button>
          ))}
        </View>
      </Dialog>
    </View>
  );
}
