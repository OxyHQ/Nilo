import * as React from 'react';
import { MessageSquare } from 'lucide-react-native';
import { Button } from '@oxy.so/bloom/button';
import { useBlockComments } from '@/lib/hooks/use-comments';
import { useTranslation } from '@/hooks/useTranslation';

interface CommentIndicatorProps {
  blockId: string;
  onPress: () => void;
  /** When true, always renders the chrome (even with zero comments) so hover
   * affordances can attach to it. The badge dot is hidden if count === 0. */
  alwaysVisible?: boolean;
}

/**
 * Block-level comment indicator. Shows a tiny "💬 N" badge when the block
 * has non-resolved comments. Clicking opens the panel scoped to that block.
 *
 * Renders inert (returns null) when there are no comments and
 * `alwaysVisible` is false — the editor uses `alwaysVisible` for the always-
 * present "+ Comment" hover affordance.
 */
export function CommentIndicator({ blockId, onPress, alwaysVisible }: CommentIndicatorProps) {
  const { t } = useTranslation();
  const { data } = useBlockComments(blockId);

  const openCount = React.useMemo(() => {
    const comments = data?.comments ?? [];
    // Count top-level threads that are not resolved.
    return comments.filter((c) => c.parentCommentId === null && c.resolvedAt === null).length;
  }, [data?.comments]);

  if (!alwaysVisible && openCount === 0) return null;

  return (
    <Button
      appearance="subtle"
      tone={openCount > 0 ? 'accent' : 'neutral'}
      size="xs"
      onPress={onPress}
      accessibilityLabel={
        openCount > 0
          ? t('comments.indicator.count', { count: openCount })
          : t('comments.indicator.add')
      }
      renderLeadingIcon={({ size, color }) => <MessageSquare size={size} color={color} />}
    >
      {openCount > 0 ? String(openCount) : t('comments.indicator.label')}
    </Button>
  );
}
