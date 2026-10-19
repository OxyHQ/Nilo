import { useSyncExternalStore } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Text } from '@oxy.so/bloom/typography';
import { useOptionalPageEditorContext } from '@/components/page-editor/page-editor-context';
import { useTranslation } from '@/hooks/useTranslation';
import { blockText, locateAnchor } from '@/lib/comments/anchor';
import type { CommentAnchor } from '@/lib/types/comments';
import { useColorScheme } from '@/lib/useColorScheme';

const noop = () => () => {};

/**
 * The text an inline comment is on, found again in the page as it is now
 * (`locateAnchor`): pressing it selects that text in the editor. Gone from
 * its block (or the block gone), it says the original text changed.
 *
 * Bloom draws decorations on whole blocks only, so the text is not
 * highlighted in the page: its block carries the comment edge, and the
 * quote is here.
 */
export function CommentQuote({
  blockId,
  anchor,
}: {
  blockId: string | null;
  anchor: CommentAnchor;
}) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const editor = useOptionalPageEditorContext();
  const store = editor?.store ?? null;
  // "start:end" where the text is, "gone", or "unknown" without the page's editor.
  const where = useSyncExternalStore(store?.subscribe ?? noop, () => {
    if (!store) return 'unknown';
    const text = blockId ? blockText(store, blockId) : null;
    const found = text === null ? null : locateAnchor(text, anchor);
    return found ? `${found.start}:${found.end}` : 'gone';
  });
  const changed = where === 'gone' || (blockId === null && where === 'unknown');
  const show = () => {
    if (!store || !blockId || where === 'gone' || where === 'unknown') return;
    const [start, end] = where.split(':').map(Number) as [number, number];
    if (Platform.OS === 'web') {
      document
        .getElementById(`bloom-block-${blockId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    store.setSelection({ kind: 'text', blockId, start, end });
    editor?.controller?.refocus();
  };
  const located = !changed && where !== 'unknown';
  return (
    <Pressable
      accessibilityRole={located ? 'button' : undefined}
      accessibilityLabel={located ? t('comments.thread.showText') : undefined}
      accessibilityHint={t('comments.thread.quote', { quote: anchor.quote })}
      disabled={!located}
      onPress={show}
      className="flex-row gap-2"
    >
      <View style={{ width: 3, borderRadius: 2, backgroundColor: colors.border }} />
      <View className="flex-1 gap-0.5">
        <Text
          className={changed ? 'text-sm text-muted-foreground line-through' : 'text-sm'}
          numberOfLines={3}
        >
          {anchor.quote}
        </Text>
        {changed ? (
          <Text className="text-xs text-muted-foreground">{t('comments.thread.textChanged')}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
