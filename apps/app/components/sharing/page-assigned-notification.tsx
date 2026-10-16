import { useUserById } from '@oxy.so/services';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { usePage } from '@/lib/hooks/use-pages';
import type { Notification } from '@/lib/hooks/use-notifications';

/** "Ana added you to Launch · Owner": someone put the reader in a person property of a row. */
export function PageAssignedNotification({ notification }: { notification: Notification }) {
  const { t } = useTranslation();
  const data = notification.data;
  const { data: profile } = useUserById(typeof data?.authorId === 'string' ? data.authorId : null);
  const { data: page } = usePage(typeof data?.pageId === 'string' ? data.pageId : undefined);
  const name =
    profile?.name?.full ||
    [profile?.name?.first, profile?.name?.last].filter(Boolean).join(' ') ||
    profile?.username ||
    t('notifications.someone');
  const property = typeof data?.propertyName === 'string' ? data.propertyName : '';
  return (
    <Text variant="body-regular">
      {t('notifications.assigned', { name, page: page?.page.title || t('pages.untitled') })}
      {property ? ` · ${property}` : ''}
    </Text>
  );
}
