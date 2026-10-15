import { ActivityIndicator, Platform, ScrollView, View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import axios from 'axios';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PAGE_FONT_FAMILIES } from '@/lib/fonts';
import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { CoverDisplay } from '@/components/page-chrome/cover-display';
import { IconDisplay } from '@/components/page-chrome/icon-display';
import { useTranslation } from '@/hooks/useTranslation';
import { usePublicPage } from '@/lib/hooks/use-page-extras';
import { SharedBlockTree } from './shared-block-renderer';

export default function PublicSitePage() {
  const params = useLocalSearchParams<{ slug: string; pageId?: string }>();
  const slug = typeof params.slug === 'string' ? params.slug : '';
  const pageId = typeof params.pageId === 'string' ? params.pageId : undefined;
  const query = usePublicPage(slug, pageId);
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const data = !query.isError ? query.data : undefined;
  const missing =
    !slug || (axios.isAxiosError(query.error) && query.error.response?.status === 404);
  const title = data
    ? data.page.title || t('pages.untitled')
    : t(missing ? 'pages.publish.notFound' : 'pages.publish.title');
  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      {Platform.OS === 'web' ? (
        <Head>
          <title>{title}</title>
          <meta
            name="robots"
            content={data?.site.allowIndexing ? 'index,follow' : 'noindex,nofollow'}
          />
        </Head>
      ) : null}
      {query.isLoading ? (
        <ActivityIndicator accessibilityLabel={t('common.loading')} />
      ) : !data ? (
        <View className="flex-1 items-center justify-center p-6 gap-3">
          <Text accessibilityRole="header" className="text-xl font-semibold">
            {t(missing ? 'pages.publish.notFound' : 'pages.publish.loadFailed')}
          </Text>
          <Text>{t(missing ? 'pages.publish.notFoundBody' : 'pages.publish.tryAgain')}</Text>
          {!missing ? (
            <Button variant="outline" onPress={() => query.refetch()}>
              <Text>{t('pages.publish.retry')}</Text>
            </Button>
          ) : null}
        </View>
      ) : (
        <ScrollView contentContainerClassName="pb-12">
          <View className={cn('w-full mx-auto px-6 md:px-10', !data.page.fullWidth && 'max-w-3xl')}>
            <CoverDisplay value={data.page.cover} position={data.page.coverPosition} />
          </View>
          <View
            className={cn(
              'w-full mx-auto px-6 md:px-10 py-8 gap-5',
              !data.page.fullWidth && 'max-w-3xl',
            )}
          >
            <View
              className="flex-row flex-wrap gap-2"
              accessibilityLabel={t('pages.publish.breadcrumb')}
            >
              {data.breadcrumb.map((entry, index) => (
                <Link
                  key={entry.id}
                  href={index === 0 ? `/pub/${slug}` : `/pub/${slug}/${entry.id}`}
                  accessibilityLabel={t('pages.openPage', {
                    title: entry.title || t('pages.untitled'),
                  })}
                >
                  <Text className="text-sm text-muted-foreground underline">
                    {entry.title || t('pages.untitled')}
                  </Text>
                </Link>
              ))}
            </View>
            <IconDisplay value={data.page.icon} size={48} />
            <Text
              accessibilityRole="header"
              className="text-3xl font-bold"
              style={{ fontFamily: PAGE_FONT_FAMILIES[data.page.font ?? 'default'] }}
            >
              {title}
            </Text>
            <SharedBlockTree blocks={data.blocks} publicSlug={slug} font={data.page.font} />
            {data.children.length ? (
              <View className="border-t border-border pt-4 gap-3">
                <Text accessibilityRole="header" className="font-semibold">
                  {t('pages.publish.subpages')}
                </Text>
                {data.children.map((child) => (
                  <Link key={child.id} href={`/pub/${slug}/${child.id}`} asChild>
                    <Button
                      variant="ghost"
                      className="justify-start"
                      accessibilityRole="link"
                      accessibilityLabel={t('pages.openPage', {
                        title: child.title || t('pages.untitled'),
                      })}
                    >
                      <IconDisplay value={child.icon} size={18} showPlaceholder />
                      <Text>{child.title || t('pages.untitled')}</Text>
                    </Button>
                  </Link>
                ))}
              </View>
            ) : null}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
