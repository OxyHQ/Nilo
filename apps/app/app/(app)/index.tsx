import { useNewPageStore } from '@/lib/stores/new-page-store';
import * as React from 'react';
import { View } from 'react-native';
import { Plus } from 'lucide-react-native';
import { Redirect } from 'expo-router';
import { useOxy } from '@oxy.so/services';
import { Button } from '@oxy.so/bloom/button';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { usePages } from '@/lib/hooks/use-pages';

/**
 * Landing screen — if the user has pages in the active workspace, redirect
 * to the most recently updated one. Otherwise show a "create first page" CTA.
 */
export default function HomePage() {
  const { t } = useTranslation();
  const { isAuthenticated } = useOxy();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data, isLoading } = usePages(currentWorkspaceId);
  const openNewPage = useNewPageStore((s) => s.open);

  const mostRecent = React.useMemo(() => {
    if (!data?.pages || data.pages.length === 0) return null;
    const sorted = [...data.pages]
      .filter((p) => !p.archived)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return sorted[0] ?? null;
  }, [data?.pages]);

  if (mostRecent) {
    return <Redirect href={`/p/${mostRecent.id}`} />;
  }

  const handleCreate = () => {
    if (!currentWorkspaceId) return;
    openNewPage({ workspaceId: currentWorkspaceId, parentId: null });
  };

  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <View className="max-w-md items-center gap-4">
        <Text className="text-3xl font-semibold text-foreground text-center">Nilo</Text>

        {!isAuthenticated ? (
          <Text className="text-base text-muted-foreground text-center">
            {t('home.signInPrompt')}
          </Text>
        ) : !currentWorkspaceId ? (
          <Text className="text-base text-muted-foreground text-center">
            {t('home.selectWorkspace')}
          </Text>
        ) : isLoading ? (
          <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
        ) : (
          <>
            <Text className="text-base text-muted-foreground text-center">{t('home.empty')}</Text>
            <Button
              appearance="solid"
              tone="accent"
              size="lg"
              accessibilityLabel={t('home.createFirstPage')}
              onPress={handleCreate}
              renderLeadingIcon={({ size, color }) => <Plus size={size} color={color} />}
            >
              {t('home.createFirstPage')}
            </Button>
          </>
        )}
      </View>
    </View>
  );
}
