import React from 'react';
import { View, ScrollView, Pressable, Platform, Linking } from 'react-native';
import { useOxy } from '@oxy.so/services/ui/client';
import { Button } from '@oxy.so/bloom/button';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useJoinShareLink } from '@/lib/hooks/use-page-permissions';
import { useLocalSearchParams, useRouter } from 'expo-router';
import axios from 'axios';
import { NiloWordmark } from '@/components/nilo-wordmark';
import { useTranslation } from '@/hooks/useTranslation';
import { apiErrorMessage } from '@/lib/api/error-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSharedPage, type SharedPage } from '@/lib/hooks/use-share-links';
import { SharedBlockTree } from '@/components/sharing/shared-block-renderer';
import { IconDisplay } from '@/components/page-chrome/icon-display';

interface ShareLoadStateProps {
  title: string;
  body: string;
}

function ShareLoadState({ title, body }: ShareLoadStateProps) {
  return (
    <View className="flex-1 items-center justify-center px-6">
      <View className="w-full max-w-md">
        <EmptyState title={title} description={body} />
      </View>
    </View>
  );
}

function ShareFooter() {
  const { t } = useTranslation();
  const handlePress = React.useCallback(() => {
    const url = 'https://nilo.so';
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener');
      }
      return;
    }
    Linking.openURL(url).catch(() => {
      /* user-driven, ignore failure */
    });
  }, []);

  return (
    <Pressable
      onPress={handlePress}
      className="flex-row items-center justify-center gap-2 py-4"
      accessibilityRole="link"
      accessibilityLabel={t('pages.share.madeWithNilo')}
    >
      <Text className="text-xs text-muted-foreground">{t('pages.share.madeWith')}</Text>
      <NiloWordmark width={70} />
    </Pressable>
  );
}

export default function PublicSharePage() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { isAuthenticated } = useOxy();
  const router = useRouter();
  const join = useJoinShareLink();
  const params = useLocalSearchParams<{ token: string }>();
  const token = typeof params.token === 'string' ? params.token : null;

  const { data, isLoading, isError, error } = useSharedPage(token);

  if (!token) {
    return (
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <ShareLoadState title={t('pages.share.invalidTitle')} body={t('pages.share.invalidBody')} />
        <ShareFooter />
      </View>
    );
  }

  if (isLoading) {
    return (
      <View
        className="flex-1 bg-background items-center justify-center"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
      </View>
    );
  }

  const joinStatus = axios.isAxiosError(join.error) ? join.error.response?.status : null;
  if (isError || !data || joinStatus === 404 || joinStatus === 410) {
    const status = joinStatus ?? (axios.isAxiosError(error) ? error.response?.status : null);
    let title = t('pages.share.unavailableTitle');
    let body = t('pages.share.unavailableBody');
    if (status === 404) {
      title = t('pages.share.notFoundTitle');
      body = t('pages.share.notFoundBody');
    } else if (status === 410) {
      title = t('pages.share.expiredTitle');
      body = t('pages.share.expiredBody');
    } else if (error) {
      body = apiErrorMessage(error, body);
    }
    return (
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <ShareLoadState title={title} body={body} />
        <ShareFooter />
      </View>
    );
  }

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 py-8 sm:px-8 sm:py-12 md:px-12"
      >
        <View className="w-full max-w-3xl mx-auto gap-4">
          {data.share.scope !== 'read' ? (
            <Text className="text-sm text-muted-foreground">{t('sharing.joinExplanation')}</Text>
          ) : null}
          {isAuthenticated ? (
            <View className="gap-2 items-start">
              <Button
                appearance="solid"
                tone="accent"
                accessibilityLabel={t('sharing.openInNilo')}
                disabled={join.isPending}
                loading={join.isPending}
                onPress={() =>
                  join.mutate(token, { onSuccess: ({ pageId }) => router.push(`/p/${pageId}`) })
                }
              >
                {t('sharing.openInNilo')}
              </Button>
              {join.isError ? (
                <Text accessibilityRole="alert" className="text-sm text-destructive">
                  {t('sharing.joinFailed')}
                </Text>
              ) : null}
            </View>
          ) : null}
          <SharedPageHeader page={data.page} token={token} />
          <View className="gap-1.5">
            <SharedBlockTree
              blocks={data.blocks}
              synced={data.synced}
              fileScope={{ kind: 'share', token }}
            />
          </View>
        </View>
      </ScrollView>
      <ShareFooter />
    </View>
  );
}

function SharedPageHeader({ page, token }: { page: SharedPage['page']; token: string }) {
  const { t } = useTranslation();
  return (
    <View className="gap-2">
      {page.icon ? (
        <IconDisplay value={page.icon} size={40} fileScope={{ kind: 'share', token }} />
      ) : null}
      <Text className="text-3xl font-bold text-foreground sm:text-4xl">
        {page.title?.trim() ? page.title : t('pages.untitled')}
      </Text>
    </View>
  );
}
