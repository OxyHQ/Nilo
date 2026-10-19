import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useUserById } from '@oxy.so/services/ui/client';
import { Button } from '@oxy.so/bloom/button';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { profileName } from '@/lib/hooks/use-member-profiles';
import { useAuthQuery } from '@/lib/hooks/create-query';
import { queryKeys } from '@/lib/hooks/query-keys';
import type { Page } from '@/lib/types/pages';
import { IconDisplay } from './icon-display';

export function relativeEditTime(iso: string, locale: string, now = Date.now()) {
  const seconds = Math.min(0, Math.round((Date.parse(iso) - now) / 1000));
  if (!Number.isFinite(seconds)) return '';
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds > -60) return format.format(seconds, 'second');
  if (seconds > -3600) return format.format(Math.round(seconds / 60), 'minute');
  if (seconds > -86400) return format.format(Math.round(seconds / 3600), 'hour');
  return format.format(Math.round(seconds / 86400), 'day');
}
export function PageInfo({ page }: { page: Page }) {
  const { t, locale } = useTranslation();
  const profile = useUserById(page.lastEditedBy ?? null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <View className="gap-2 py-3">
      <Text className="text-xs text-muted-foreground">
        {t(page.lastEditedBy ? 'pages.info.editedBy' : 'pages.info.edited', {
          time: relativeEditTime(page.updatedAt, locale, now),
          name: profileName(profile.data) ?? t('pages.info.unknownMember'),
        })}
      </Text>
      <Backlinks key={page.id} pageId={page.id} />
    </View>
  );
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
  const label = t('pages.backlinks.count', { count: backlinks.length });
  return (
    <View className="gap-2">
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
