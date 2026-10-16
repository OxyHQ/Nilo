import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@oxy.so/bloom/button';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';
import { confirm } from '@oxy.so/bloom/surfaces';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { type OfflineEntry, offlinePages } from '@/lib/editor/offline-pages';
import { useOfflinePageList } from '@/lib/editor/use-offline-pages';

/** A size in bytes the way people read one: 820 KB, 3.4 MB. */
export function formatSize(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toLocaleString(locale, { maximumFractionDigits: digits })} ${units[unit]}`;
}

/** The pages kept on this device, why, and what they take. */
export function OfflineSection() {
  const { t, locale } = useTranslation();
  const { supported, pages } = useOfflinePageList();
  const total = pages.reduce((sum, page) => sum + page.bytes, 0);

  if (!supported) {
    return <Text className="text-sm text-muted-foreground">{t('settings.offline.webOnly')}</Text>;
  }

  return (
    <View className="gap-4">
      <Text className="text-sm text-muted-foreground">{t('settings.offline.description')}</Text>
      {pages.length === 0 ? (
        <Text className="text-sm text-muted-foreground">{t('settings.offline.empty')}</Text>
      ) : (
        <>
          <SettingsListGroup
            title={t('settings.offline.total', {
              count: pages.length,
              size: formatSize(total, locale),
            })}
          >
            {pages.map((page) => (
              <OfflineRow key={page.pageId} page={page} />
            ))}
          </SettingsListGroup>
          <Button
            appearance="outline"
            tone="danger"
            className="self-start"
            onPress={async () => {
              const confirmed = await confirm({
                title: t('settings.offline.removeAllTitle'),
                description: t('settings.offline.removeAllDescription'),
                confirmLabel: t('settings.offline.removeAll'),
                cancelLabel: t('common.cancel'),
                destructive: true,
              });
              if (confirmed) await offlinePages.clear();
            }}
            accessibilityLabel={t('settings.offline.removeAll')}
          >
            {t('settings.offline.removeAll')}
          </Button>
        </>
      )}
    </View>
  );
}

function OfflineRow({ page }: { page: OfflineEntry }) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const title = page.title?.trim() || t('pages.untitled');
  const pinned = page.reasons.includes('pinned');
  const why = t(pinned ? 'settings.offline.pinned' : 'settings.offline.recent');
  const saved = page.savedAt
    ? t('settings.offline.savedAt', {
        when: new Date(page.savedAt).toLocaleString(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
      })
    : t('settings.offline.notSaved');
  return (
    <SettingsListItem
      title={title}
      description={[why, formatSize(page.bytes, locale), saved].join(' · ')}
      accessibilityRole="link"
      accessibilityLabel={t('settings.offline.open', { title })}
      onPress={() => router.push(`/p/${page.pageId}`)}
      showChevron={false}
      rightElement={
        pinned ? (
          <Button
            appearance="subtle"
            size="sm"
            stopPropagation
            accessibilityLabel={t('settings.offline.remove', { title })}
            onPress={() => {
              void offlinePages.setPinned(page.pageId, false);
            }}
          >
            {t('settings.offline.removeOne')}
          </Button>
        ) : undefined
      }
    />
  );
}
