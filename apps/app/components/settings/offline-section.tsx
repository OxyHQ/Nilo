import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Text } from '@/components/ui/text';
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
  const [confirmClear, setConfirmClear] = useState(false);
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
          <Text className="text-sm font-medium">
            {t('settings.offline.total', {
              count: pages.length,
              size: formatSize(total, locale),
            })}
          </Text>
          <View className="rounded-lg border border-border">
            {pages.map((page, i) => (
              <OfflineRow key={page.pageId} page={page} last={i === pages.length - 1} />
            ))}
          </View>
          <Button
            variant="outline"
            className="self-start"
            onPress={() => setConfirmClear(true)}
            accessibilityLabel={t('settings.offline.removeAll')}
          >
            <Text className="text-sm text-destructive">{t('settings.offline.removeAll')}</Text>
          </Button>
        </>
      )}
      <ConfirmationDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={t('settings.offline.removeAllTitle')}
        description={t('settings.offline.removeAllDescription')}
        confirmText={t('settings.offline.removeAll')}
        confirmVariant="destructive"
        onConfirm={() => offlinePages.clear()}
      />
    </View>
  );
}

function OfflineRow({ page, last }: { page: OfflineEntry; last: boolean }) {
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
    <View
      className={`flex-row items-center gap-3 px-3 py-2.5 ${last ? '' : 'border-b border-border'}`}
    >
      <Pressable
        className="flex-1 gap-0.5"
        accessibilityRole="link"
        accessibilityLabel={t('settings.offline.open', { title })}
        onPress={() => router.push(`/p/${page.pageId}`)}
      >
        <Text className="text-sm font-medium" numberOfLines={1}>
          {title}
        </Text>
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {[why, formatSize(page.bytes, locale), saved].join(' · ')}
        </Text>
      </Pressable>
      {pinned ? (
        <Button
          variant="ghost"
          size="sm"
          accessibilityLabel={t('settings.offline.remove', { title })}
          onPress={() => {
            void offlinePages.setPinned(page.pageId, false);
          }}
        >
          <Text className="text-sm">{t('settings.offline.removeOne')}</Text>
        </Button>
      ) : null}
    </View>
  );
}
