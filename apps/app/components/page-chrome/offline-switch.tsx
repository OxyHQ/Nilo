import { DropdownMenuCheckboxItem } from '@oxy.so/bloom/dropdown-menu';
import { useTranslation } from '@/hooks/useTranslation';
import { useOfflinePage } from '@/lib/editor/use-offline-pages';
import type { Page } from '@/lib/types/pages';

/** Keep the page on this device to open without a connection (iOS and Android). */
export function OfflineSwitch({ page }: { page: Page }) {
  const { t } = useTranslation();
  const offline = useOfflinePage(page.id, { title: page.title, workspaceId: page.workspaceId });
  if (!offline.supported) return null;
  return (
    <DropdownMenuCheckboxItem
      indicatorPosition="trailing"
      checked={offline.pinned}
      accessibilityLabel={t('pages.offline.available')}
      onCheckedChange={(value) => {
        void offline.setPinned(value);
      }}
    >
      {t('pages.offline.available')}
    </DropdownMenuCheckboxItem>
  );
}
