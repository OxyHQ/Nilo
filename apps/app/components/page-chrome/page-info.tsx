import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@oxy.so/bloom/button';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuthQuery } from '@/lib/hooks/create-query';
import { queryKeys } from '@/lib/hooks/query-keys';
import type { Page } from '@/lib/types/pages';
import { IconDisplay } from './icon-display';

export function PageInfo({ page }: { page: Page }) {
  return <Backlinks key={page.id} pageId={page.id} />;
}
function Backlinks({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const query = useAuthQuery<{
    backlinks: { page: Pick<Page, 'id' | 'title' | 'icon'>; text: string }[];
  }>(queryKeys.pages.backlinks(pageId), `/pages/${pageId}/backlinks`, undefined, {
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  if (query.isPending) return null;
  if (query.isError)
    return (
      <Button
        appearance="subtle"
        tone="neutral"
        size="sm"
        accessibilityLabel={t('pages.backlinks.retry')}
        onPress={() => void query.refetch()}
      >
        {t('pages.backlinks.retry')}
      </Button>
    );
  const backlinks = query.data?.backlinks ?? [];
  if (!backlinks.length) return null;
  const label = t('pages.backlinks.count', { count: backlinks.length });
  return (
    <View className="gap-2 py-3">
      <Button
        appearance="plain"
        tone="neutral"
        size="xs"
        className="self-start"
        accessibilityLabel={label}
        aria-expanded={expanded}
        onPress={() => setExpanded(!expanded)}
      >
        {label}
      </Button>
      {expanded
        ? backlinks.map(({ page, text }) => (
            <Pressable
              key={page.id}
              accessibilityRole="link"
              accessibilityLabel={page.title || t('pages.untitled')}
              onPress={() => router.push(`/p/${page.id}`)}
              className="rounded-md border border-border p-3 gap-1"
            >
              <View className="flex-row items-center gap-2">
                <IconDisplay value={page.icon} size={18} pageId={page.id} />
                <Text variant="body-medium">{page.title || t('pages.untitled')}</Text>
              </View>
              {text ? (
                <Text numberOfLines={2} className="text-xs text-muted-foreground">
                  {text}
                </Text>
              ) : null}
            </Pressable>
          ))
        : null}
    </View>
  );
}
