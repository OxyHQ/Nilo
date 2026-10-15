import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { usePage } from '@/lib/hooks/use-pages';
import type { Notification } from '@/lib/hooks/use-notifications';

export function PageEditedNotification({ notification }: { notification: Notification }) {
  const { t } = useTranslation();
  const { data } = usePage(
    typeof notification.data?.pageId === 'string' ? notification.data.pageId : undefined,
  );
  return (
    <Text className="text-sm text-foreground">
      {t('notifications.pageEdited', { page: data?.page.title || t('pages.untitled') })}
    </Text>
  );
}
