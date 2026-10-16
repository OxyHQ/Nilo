import { View } from 'react-native';
import { Switch } from '@oxy.so/bloom/switch';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useOfflinePage } from '@/lib/editor/use-offline-pages';
import type { Page } from '@/lib/types/pages';

/** Keep the page on this device to open without a connection (iOS and Android). */
export function OfflineSwitch({ page }: { page: Page }) {
  const { t } = useTranslation();
  const offline = useOfflinePage(page.id, { title: page.title, workspaceId: page.workspaceId });
  if (!offline.supported) return null;
  return (
    <View className="gap-0.5 px-3 py-1.5">
      <View className="flex-row items-center justify-between gap-3">
        <Text variant="body-regular">{t('pages.offline.available')}</Text>
        <Switch
          checked={offline.pinned}
          accessibilityLabel={t('pages.offline.available')}
          onCheckedChange={(value) => {
            void offline.setPinned(value);
          }}
        />
      </View>
      <Text className="text-xs text-muted-foreground">{t('pages.offline.hint')}</Text>
    </View>
  );
}
