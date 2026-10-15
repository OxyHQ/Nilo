import { View } from 'react-native';
import { useOxy } from '@oxy.so/services';
import { Text } from '@/components/ui/text';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from '@/hooks/useTranslation';
import { usePage } from '@/lib/hooks/use-pages';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';
import { canRestrictPage } from '@/lib/hooks/page-access';
import {
  useSharedPages,
  useSetPageRestricted,
  type PagePermissions,
} from '@/lib/hooks/use-page-permissions';
import { InheritedPageLink } from './people-section';

export function GeneralAccess({
  permissions,
  onNavigate,
}: {
  permissions: PagePermissions;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useOxy();
  const { data } = usePage(permissions.pageId);
  const { data: workspaces } = useWorkspaces();
  const { data: shared } = useSharedPages();
  const mutation = useSetPageRestricted(permissions.pageId);
  const workspaceId = data?.page.workspaceId;
  const workspace =
    workspaces?.find((w) => w.id === workspaceId) ??
    shared?.shared.find((group) => group.workspace.id === workspaceId)?.workspace;
  const canRestrict = Boolean(
    data && canRestrictPage(permissions.role, data.page.ownerId, user?.id),
  );
  return (
    <View className="rounded-xl border border-border p-3 gap-2">
      <Text className="text-sm font-semibold text-foreground">{t('sharing.general.title')}</Text>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-sm text-foreground flex-1">
          {permissions.openToWorkspace
            ? t('sharing.general.everyone', {
                workspace: workspace?.name ?? t('workspace.fallbackName'),
              })
            : t('sharing.general.invitedOnly')}
        </Text>
        <Switch
          accessibilityLabel={t('sharing.general.restrict')}
          value={!permissions.openToWorkspace}
          disabled={!canRestrict || Boolean(permissions.restrictedFrom) || mutation.isPending}
          onValueChange={(restricted) => mutation.mutate(restricted)}
        />
      </View>
      {permissions.restrictedFrom ? (
        <View className="gap-1">
          <Text className="text-xs text-muted-foreground">{t('sharing.general.inherited')}</Text>
          <InheritedPageLink pageId={permissions.restrictedFrom} onNavigate={onNavigate} />
        </View>
      ) : !canRestrict ? (
        <Text className="text-xs text-muted-foreground">{t('sharing.general.adminOnly')}</Text>
      ) : null}
      <Text className="text-xs text-muted-foreground">{t('sharing.general.subtree')}</Text>
      {mutation.isError ? (
        <Text accessibilityRole="alert" className="text-xs text-destructive">
          {t('sharing.general.failed')}
        </Text>
      ) : null}
    </View>
  );
}
