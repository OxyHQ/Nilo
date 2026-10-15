import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { useColorScheme } from '@/lib/useColorScheme';
import { useBreadcrumb } from '@/lib/hooks/use-pages';
import type { BlockComponentProps } from './types';

/**
 * Breadcrumb block — renders the path from the workspace root to the current
 * page. Auto-derived from the block's `pageId` with one breadcrumb request,
 * shared with the page header's.
 */
export function BreadcrumbBlock({ block }: BlockComponentProps) {
  const { colors } = useColorScheme();
  const pageId = block.pageId;
  const { data } = useBreadcrumb(pageId);
  const trail = data?.breadcrumb;

  if (!trail) {
    return (
      <View className="my-1">
        <Text className="text-xs text-muted-foreground">Loading path…</Text>
      </View>
    );
  }

  return (
    <View className="flex-row items-center flex-wrap gap-1 my-1">
      {trail.map((p, idx) => (
        <View key={p.id} className="flex-row items-center gap-1">
          <Pressable onPress={() => router.push(`/p/${p.id}`)}>
            <Text className="text-xs text-muted-foreground hover:text-foreground">
              {p.title || 'Untitled'}
            </Text>
          </Pressable>
          {idx < trail.length - 1 ? (
            <ChevronRight size={12} color={colors.mutedForeground} />
          ) : null}
        </View>
      ))}
    </View>
  );
}
