import { View } from 'react-native';
import { Link } from 'expo-router';
import { isEntityId } from '@oxy.so/nilo-contracts';
import { LinkButton } from '@oxy.so/bloom/button';
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
    <Link href={`/p/${pageId}`} asChild>
      <LinkButton
        accessibilityRole="link"
        accessibilityLabel={title}
        linkTone={trashed ? 'secondary' : 'text'}
        underline={trashed ? 'none' : 'rest'}
        textVariant="body-medium"
        textStyle={trashed ? { textDecorationLine: 'line-through' } : undefined}
        numberOfLines={1}
        style={{ alignSelf: 'stretch', justifyContent: 'flex-start' }}
        renderLeadingIcon={({ size, color }) =>
          page?.icon ? (
            <IconDisplay value={page.icon} size={size} pageId={pageId} />
          ) : (
            <RiFileTextLine width={size} height={size} fill={color} />
          )
        }
        trailing={
          trashed ? (
            <Text variant="caption-1-regular" className="text-muted-foreground">
              {t('editor.blocks.childPage.trashed')}
            </Text>
          ) : undefined
        }
      >
        {title}
      </LinkButton>
    </Link>
  );
}
