import { useNewPageStore } from '@/lib/stores/new-page-store';
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiTimeLine } from '@oxy.so/bloom/icons/RiTimeLine';
import { useOxy } from '@oxy.so/services/ui/client';
import { Button } from '@oxy.so/bloom/button';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { Card } from '@oxy.so/bloom/card';
import { ResponsiveGrid } from '@oxy.so/bloom/grid';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { useTranslation } from '@/hooks/useTranslation';
import { IconDisplay } from '@/components/page-chrome/icon-display';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { useRecentPageIds } from '@/lib/hooks/use-recent-pages';
import { usePages } from '@/lib/hooks/use-pages';
import { greetingFor, recentlyVisited } from '@/lib/home';
import { useColorScheme } from '@/lib/useColorScheme';
import type { Page } from '@/lib/types/pages';

/**
 * Home, as in Notion: a greeting, the pages last visited (on any device; this
 * device's own while offline) and a way to start a new page. An empty workspace is asked for its first page.
 */
export default function HomePage() {
  const { t } = useTranslation();
  const { isAuthenticated, user } = useOxy();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const recentPageIds = useRecentPageIds(currentWorkspaceId);
  const { data, isLoading } = usePages(currentWorkspaceId);
  const openNewPage = useNewPageStore((s) => s.open);

  const pages = data?.pages;
  const recent = React.useMemo(
    () => recentlyVisited(pages ?? [], recentPageIds),
    [pages, recentPageIds],
  );
  const hasPages = Boolean(pages?.some((page) => !page.archived));

  const handleCreate = () => {
    if (!currentWorkspaceId) return;
    openNewPage({ workspaceId: currentWorkspaceId, parentId: null });
  };

  if (!isAuthenticated || !currentWorkspaceId || isLoading || !hasPages) {
    return (
      <Screen className="items-center justify-center px-6">
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
                leadingIcon={RiAddLine}
              >
                {t('home.createFirstPage')}
              </Button>
            </>
          )}
        </View>
      </Screen>
    );
  }

  const name = user?.name?.first || user?.username;
  const greeting = greetingFor(new Date());

  return (
    <Screen
      scroll="auto"
      header={
        <PageHeader
          safeArea={false}
          title={
            name
              ? t(`home.greeting.${greeting}`, { name })
              : t(`home.greeting.${greeting}Anonymous`)
          }
          actions={
            <Button
              appearance="solid"
              tone="accent"
              onPress={handleCreate}
              accessibilityLabel={t('home.newPage')}
              leadingIcon={RiAddLine}
            >
              {t('home.newPage')}
            </Button>
          }
        />
      }
    >
      <ScreenScrollView contentContainerClassName="px-6 py-8 md:px-10">
        <View className="gap-3">
          <RecentHeading />
          {recent.length > 0 ? (
            <ResponsiveGrid minItemWidth={160} maxColumns={5} gap={12}>
              {recent.map((page) => (
                <RecentCard key={page.id} page={page} />
              ))}
            </ResponsiveGrid>
          ) : (
            <Text className="text-sm text-muted-foreground">{t('home.noRecent')}</Text>
          )}
        </View>
      </ScreenScrollView>
    </Screen>
  );
}

function RecentHeading() {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  return (
    <View className="flex-row items-center gap-1.5">
      <RiTimeLine width={14} height={14} fill={colors.mutedForeground} />
      <Text accessibilityRole="header" className="text-sm font-medium text-muted-foreground">
        {t('home.recentlyVisited')}
      </Text>
    </View>
  );
}

function RecentCard({ page }: { page: Page }) {
  const router = useRouter();
  const { t } = useTranslation();
  const title = page.title.trim() || t('pages.untitled');
  return (
    <Card
      onPress={() => router.push(`/p/${page.id}`)}
      accessibilityRole="link"
      accessibilityLabel={t('pages.openPage', { title })}
      className="gap-3 p-3"
    >
      <IconDisplay value={page.icon} size={28} showPlaceholder pageId={page.id} />
      <Text className="text-sm font-medium text-foreground" numberOfLines={2}>
        {title}
      </Text>
    </Card>
  );
}
