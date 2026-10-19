import { View } from 'react-native';
import { router } from 'expo-router';
import { Breadcrumb, BreadcrumbItem } from '@oxy.so/bloom/breadcrumb';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useBreadcrumb } from '@/lib/hooks/use-pages';
import type { BlockComponentProps } from './types';

/**
 * Breadcrumb block — renders the path from the workspace root to the current
 * page. Auto-derived from the block's `pageId` with one breadcrumb request,
 * shared with the page header's.
 */
export function BreadcrumbBlock({ block }: BlockComponentProps) {
  const { t } = useTranslation();
  const pageId = block.pageId;
  const { data } = useBreadcrumb(pageId);
  const trail = data?.breadcrumb;

  if (!trail) {
    return (
      <View className="my-1">
        <Text className="text-xs text-muted-foreground">
          {t('editor.blocks.breadcrumb.loading')}
        </Text>
      </View>
    );
  }

  return (
    <Breadcrumb style={{ marginVertical: 4 }}>
      {trail.map((p) => (
        <BreadcrumbItem key={p.id} onPress={() => router.push(`/p/${p.id}`)}>
          {p.title || t('pages.untitled')}
        </BreadcrumbItem>
      ))}
    </Breadcrumb>
  );
}
