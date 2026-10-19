import * as React from 'react';
import { View } from 'react-native';
import { useOxy } from '@oxy.so/services/ui/client';
import { usePages } from '@/lib/hooks/use-pages';
import type { Page } from '@/lib/types/pages';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { SidebarSection } from './sidebar-section';
import { useTranslation } from '@/hooks/useTranslation';
import { SidebarPageTree } from './sidebar-page-tree';

/**
 * Favorites — the pages the signed-in member starred (`favorited` is each
 * reader's own). Hidden entirely when there are none, so an empty section
 * does not clutter the sidebar.
 */
export function FavoritesSection() {
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { user } = useOxy();
  const { t } = useTranslation();
  const { data } = usePages(currentWorkspaceId);

  const favorites = React.useMemo<Page[]>(() => {
    if (!data?.pages) return [];
    return data.pages.filter((p) => p.favorited === true && !p.archived);
  }, [data?.pages]);

  if (favorites.length === 0) return null;
  if (!currentWorkspaceId || !user) return null;

  return (
    <SidebarSection sectionKey="favorites" title={t('sidebar.sections.favorites')}>
      <View className="px-1">
        <SidebarPageTree pages={favorites} workspaceId={currentWorkspaceId} enableDrag={false} />
      </View>
    </SidebarSection>
  );
}
