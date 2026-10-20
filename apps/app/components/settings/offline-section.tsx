import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@oxy.so/bloom/button';
import { SettingsCard, SettingsRow, SettingsSection } from '@oxy.so/bloom/settings-modal/modal';
import { confirm } from '@oxy.so/bloom/surfaces';
import { useTranslation } from '@/hooks/useTranslation';
import { type OfflineEntry, offlinePages } from '@/lib/editor/offline-pages';
import { useOfflinePageList } from '@/lib/editor/use-offline-pages';
import { isPageSessionOpen } from '@/lib/editor/shared-sessions';
import { useNiloSettings } from './settings-provider';

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

  if (!supported) return <SettingsSection description={t('settings.offline.webOnly')} />;

  const removeAll = async () => {
    const confirmed = await confirm({
      title: t('settings.offline.removeAllTitle'),
      description: t('settings.offline.removeAllDescription'),
      confirmLabel: t('settings.offline.removeAll'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (confirmed) await offlinePages.removeDownloads(isPageSessionOpen);
  };

  return (
    <SettingsSection
      label={
        pages.length > 0
          ? t('settings.offline.total', { count: pages.length, size: formatSize(total, locale) })
          : undefined
      }
      description={t('settings.offline.description')}
      action={
        pages.length > 0 ? (
          <Button
            appearance="outline"
            tone="danger"
            size="sm"
            accessibilityLabel={t('settings.offline.removeAll')}
            onPress={() => {
              void removeAll();
            }}
          >
            {t('settings.offline.removeAllShort')}
          </Button>
        ) : undefined
      }
    >
      <SettingsCard>
        {pages.length === 0 ? (
          <SettingsRow label={t('settings.offline.empty')} />
        ) : (
          pages.map((page) => <OfflineRow key={page.pageId} page={page} />)
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

function OfflineRow({ page }: { page: OfflineEntry }) {
  const { t, locale } = useTranslation();
  const { close } = useNiloSettings();
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
    <SettingsRow
      label={title}
      description={[why, formatSize(page.bytes, locale), saved].join(' · ')}
    >
      <View className="flex-row items-center gap-1">
        <Button
          appearance="plain"
          tone="neutral"
          size="sm"
          accessibilityRole="link"
          accessibilityLabel={t('settings.offline.open', { title })}
          onPress={() => {
            close();
            router.push(`/p/${page.pageId}`);
          }}
        >
          {t('settings.offline.openOne')}
        </Button>
        {pinned ? (
          <Button
            appearance="outline"
            tone="neutral"
            size="sm"
            accessibilityLabel={t('settings.offline.remove', { title })}
            onPress={() => {
              void offlinePages.setPinned(page.pageId, false);
            }}
          >
            {t('settings.offline.removeOne')}
          </Button>
        ) : null}
      </View>
    </SettingsRow>
  );
}
