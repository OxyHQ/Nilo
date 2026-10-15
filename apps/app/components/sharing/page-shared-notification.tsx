import { useUserById } from '@oxy.so/services';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { usePage } from '@/lib/hooks/use-pages';
import { WORKSPACE_ROLES } from '@/lib/hooks/workspace-roles';
import type { Notification } from '@/lib/hooks/use-notifications';

export function PageSharedNotification({ notification }: { notification: Notification }) {
  const { t } = useTranslation();
  const data = notification.data;
  const { data: profile } = useUserById(typeof data?.sharedBy === 'string' ? data.sharedBy : null);
  const { data: page } = usePage(typeof data?.pageId === 'string' ? data.pageId : undefined);
  const name =
    profile?.name?.full ||
    [profile?.name?.first, profile?.name?.last].filter(Boolean).join(' ') ||
    profile?.username ||
    t('notifications.someone');
  const role = WORKSPACE_ROLES.find((role) => role === data?.role);
  return (
    <Text className="text-sm text-foreground">
      {t('notifications.pageShared', { name, page: page?.page.title || t('pages.untitled') })}
      {role ? ` · ${t(`sharing.roles.${role}`)}` : ''}
    </Text>
  );
}
