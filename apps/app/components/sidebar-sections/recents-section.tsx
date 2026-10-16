import * as React from 'react';
import { View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { FileText, Clock } from 'lucide-react-native';
import { Item } from '@oxy.so/bloom/item';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useUIStore } from '@/lib/stores/ui-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { usePages } from '@/lib/hooks/use-pages';
import type { Page } from '@/lib/types/pages';

/**
 * Recents — top 5 recently-opened pages from the persisted UI store. Renders
 * inline (no collapsible header) above the Favorites section so it stays
 * visually distinct from the main page tree.
 *
 * Hidden when there are no recent visits.
 */
export function RecentsSection() {
  const router = useRouter();
  const pathname = usePathname();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const recentPageIds = useUIStore((s) => s.recentPageIds);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data } = usePages(currentWorkspaceId);

  const pages = React.useMemo<Page[]>(() => {
    if (!data?.pages) return [];
    const byId = new Map<string, Page>();
    for (const p of data.pages) byId.set(p.id, p);
    const out: Page[] = [];
    for (const id of recentPageIds) {
      const p = byId.get(id);
      if (p && !p.archived) out.push(p);
      if (out.length >= 5) break;
    }
    return out;
  }, [data?.pages, recentPageIds]);

  if (pages.length === 0) return null;

  return (
    <View className="px-1 py-1">
      <View className="flex-row items-center gap-1 px-3 pb-1">
        <Clock size={10} color={colors.mutedForeground} />
        <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('sidebar.recent')}
        </Text>
      </View>
      <View>
        {pages.map((p) => {
          const isActive = pathname === `/p/${p.id}`;
          const title = p.title.trim() || t('pages.untitled');
          return (
            <Item
              key={p.id}
              density="compact"
              active={isActive}
              onPress={() => router.push(`/p/${p.id}`)}
              accessibilityLabel={t('pages.openPage', { title })}
              leading={
                <View className="h-5 w-5 items-center justify-center">
                  {p.icon ? (
                    <Text className="text-sm leading-5 text-foreground">{p.icon}</Text>
                  ) : (
                    <FileText size={13} color={colors.mutedForeground} />
                  )}
                </View>
              }
              title={title}
            />
          );
        })}
      </View>
    </View>
  );
}
