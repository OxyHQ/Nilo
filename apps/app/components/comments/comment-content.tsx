import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { RiCalendarLine } from '@oxy.so/bloom/icons/RiCalendarLine';
import { RiFileTextLine } from '@oxy.so/bloom/icons/RiFileTextLine';
import { RiUserLine } from '@oxy.so/bloom/icons/RiUserLine';
import { Chip } from '@oxy.so/bloom/chip';
import { Text } from '@oxy.so/bloom/typography';
import { useOxy } from '@oxy.so/services';
import { useColorScheme } from '@/lib/useColorScheme';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import {
  isMentionSegment,
  type CommentContent as CommentContentType,
  type MentionSegment,
} from '@/lib/types/comments';

interface CommentContentProps {
  content: CommentContentType;
  /** Tailwind size class for the surrounding text. Defaults to text-sm. */
  textClassName?: string;
}

/**
 * Renders rich-text comment content with inline mention chips.
 *
 * Text segments preserve bold/italic/underline/strike/code/link annotations.
 * Mention chips are subtle pill components that are clickable: user mentions
 * open the Oxy account sheet, page mentions navigate to the target page,
 * date mentions are non-interactive but visually distinguished.
 */
export function CommentContentView({ content, textClassName }: CommentContentProps) {
  const segments = content.segments ?? [];
  return (
    <View className="flex-row flex-wrap">
      {segments.map((seg, idx) => {
        if (isMentionSegment(seg)) {
          // biome-ignore lint/suspicious/noArrayIndexKey: segments carry no id; the list is read-only and re-rendered whole when the comment changes
          return <MentionChip key={idx} mention={seg} />;
        }
        return (
          <Text
            // biome-ignore lint/suspicious/noArrayIndexKey: segments carry no id; the list is read-only and re-rendered whole when the comment changes
            key={idx}
            className={cn(
              'text-sm text-foreground',
              textClassName,
              seg.bold && 'font-bold',
              seg.italic && 'italic',
              seg.underline && 'underline',
              seg.strike && 'line-through',
              seg.code && 'font-mono bg-muted/60 rounded px-1',
            )}
          >
            {seg.text}
          </Text>
        );
      })}
    </View>
  );
}

function MentionChip({ mention }: { mention: MentionSegment }) {
  const router = useRouter();
  const { showBottomSheet } = useOxy();
  const { colors } = useColorScheme();
  const { t } = useTranslation();

  const Icon =
    mention.kind === 'user'
      ? RiUserLine
      : mention.kind === 'page'
        ? RiFileTextLine
        : RiCalendarLine;

  const handlePress = () => {
    if (mention.kind === 'page' && mention.id) {
      router.push(`/(app)/p/${mention.id}`);
      return;
    }
    if (mention.kind === 'user' && mention.id) {
      // Best-effort — the Oxy account sheet covers the current user only,
      // but for non-self mentions we degrade to a no-op (Phase 3 will add
      // a user-profile sheet via Oxy services).
      showBottomSheet?.('ManageAccount');
    }
  };

  return (
    <Chip
      size="sm"
      appearance="subtle"
      tone="accent"
      onPress={handlePress}
      leading={<Icon width={12} height={12} fill={colors.primary} />}
      accessibilityLabel={t('comments.mentionLabel', { name: mention.originalText })}
      style={{ marginHorizontal: 2 }}
    >
      {mention.kind === 'date' && mention.date
        ? formatDate(mention.date)
        : mention.originalText.replace(/^@/, '')}
    </Chip>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((part) => parseInt(part, 10));
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
