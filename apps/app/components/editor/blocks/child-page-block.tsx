import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { isEntityId } from '@oxy.so/nilo-contracts';
import { RiFileTextLine } from '@oxy.so/bloom/icons/RiFileTextLine';
import { Text } from '@oxy.so/bloom/typography';
import { IconDisplay } from '@/components/page-chrome/icon-display';
import { useTranslation } from '@/hooks/useTranslation';
import { usePage } from '@/lib/hooks/use-pages';
import { useColorScheme } from '@/lib/useColorScheme';
import type { BlockComponentProps } from './types';

/** What a block holds before its page exists (the contract's default). */
const PLACEHOLDER_ID = '000000000000000000000000';

/**
 * A subpage shown in its parent (Notion's "Page" block): its icon and title,
 * opening it. Removing the block leaves the page where it is, a subpage in
 * the sidebar; a page in the trash says so.
 */
export function ChildPageBlock({ block }: BlockComponentProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const pageId = typeof block.content.pageId === 'string' ? block.content.pageId : '';
  const resolved = pageId !== PLACEHOLDER_ID && isEntityId(pageId);
  const query = usePage(resolved ? pageId : undefined);

  if (!resolved || query.isError) {
    return (
      <View className="flex-row items-center gap-2 px-2 py-1">
        <RiFileTextLine width={16} height={16} fill={colors.mutedForeground} />
        <Text className="text-sm text-muted-foreground">
          {t(resolved ? 'editor.blocks.childPage.missing' : 'editor.blocks.childPage.creating')}
        </Text>
      </View>
    );
  }

  const page = query.data?.page;
  const title = page ? page.title || t('pages.untitled') : t('editor.blocks.loading');
  const trashed = page?.archived;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={title}
      onPress={() => router.push({ pathname: '/(app)/p/[pageId]', params: { pageId } })}
      className="flex-row items-center gap-2 rounded-md px-2 py-1 hover:bg-muted active:bg-muted"
    >
      {page?.icon ? (
        <IconDisplay value={page.icon} size={18} pageId={pageId} />
      ) : (
        <RiFileTextLine width={18} height={18} fill={colors.foreground} />
      )}
      <Text
        className={
          trashed
            ? 'shrink text-base font-medium text-muted-foreground line-through'
            : 'shrink text-base font-medium text-foreground underline decoration-border'
        }
        numberOfLines={1}
      >
        {title}
      </Text>
      {trashed ? (
        <Text className="text-xs text-muted-foreground">
          {t('editor.blocks.childPage.trashed')}
        </Text>
      ) : null}
    </Pressable>
  );
}
