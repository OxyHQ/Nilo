import { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { toast } from '@oxy.so/bloom/toast';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, type DialogAction, useDialogControl } from '@oxy.so/bloom/dialog';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Item } from '@oxy.so/bloom/item';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { SharedBlockTree } from '@/components/sharing/shared-block-renderer';
import { useTranslation } from '@/hooks/useTranslation';
import { usePageVersions, usePageVersion, useRestoreVersion } from '@/lib/hooks/use-page-extras';
import { usePage } from '@/lib/hooks/use-pages';
import { hasRole } from '@/lib/hooks/workspace-roles';
import { memberProfileName, useWorkspaceMembers } from '@/lib/hooks/use-workspace-members';
import type { Page } from '@/lib/types/pages';

function relativeTime(iso: string, locale: string) {
  const seconds = Math.min(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds > -60) return format.format(seconds, 'second');
  if (seconds > -3600) return format.format(Math.round(seconds / 60), 'minute');
  if (seconds > -86400) return format.format(Math.round(seconds / 3600), 'hour');
  return format.format(Math.round(seconds / 86400), 'day');
}

export function PageHistoryDialog({
  page,
  onClose,
  initialVersionId,
}: {
  page: Page;
  onClose: () => void;
  initialVersionId?: string;
}) {
  const { t, locale } = useTranslation();
  const list = usePageVersions(page.id);
  const [selected, setSelected] = useState<string | null>(initialVersionId ?? null);
  const selectedId = selected ?? list.data?.versions[0]?.id ?? '';
  const preview = usePageVersion(page.id, selectedId);
  const members = useWorkspaceMembers(page.workspaceId);
  const access = usePage(page.id);
  const canRestore = !access.isError && hasRole(access.data?.role, 'editor');
  const restore = useRestoreVersion(page);
  const [confirm, setConfirm] = useState(false);
  const control = useDialogControl();
  const { width } = useWindowDimensions();

  const restoreSelected = async () => {
    if (!canRestore || restore.isPending || !selectedId) return;
    try {
      await restore.mutateAsync(selectedId);
      setConfirm(false);
      toast.success(t('pages.history.restored'));
    } catch {
      toast.error(t('pages.history.restoreFailed'));
    }
  };
  const actions: DialogAction[] | undefined = confirm
    ? [
        {
          label: t(restore.isPending ? 'common.processing' : 'pages.history.restore'),
          disabled: !canRestore || restore.isPending,
          shouldCloseOnPress: false,
          onPress: () => void restoreSelected(),
        },
        {
          label: t('common.cancel'),
          color: 'cancel',
          disabled: restore.isPending,
          shouldCloseOnPress: false,
          onPress: () => setConfirm(false),
        },
      ]
    : selectedId
      ? [
          {
            label: t('pages.history.restore'),
            disabled: !canRestore || restore.isPending || !preview.data || preview.isError,
            shouldCloseOnPress: false,
            onPress: () => setConfirm(true),
          },
        ]
      : undefined;

  return (
    <Dialog
      control={control}
      startOpen
      onClose={onClose}
      // The confirm step is left with its own Cancel, and nothing is dismissed
      // mid-restore.
      dismissOnBackdrop={!confirm && !restore.isPending}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={page.fullWidth ? width : 768}
      title={t(confirm ? 'pages.history.confirmTitle' : 'pages.history.title')}
      description={t(confirm ? 'pages.history.confirmBody' : 'pages.history.description')}
      actions={actions}
    >
      {confirm ? null : (
        <>
          <View className="gap-4">
            {list.isLoading ? (
              <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
            ) : list.isError ? (
              <View className="gap-2">
                <Text variant="body-regular" accessibilityRole="alert">
                  {t('pages.history.loadFailed')}
                </Text>
                <Button appearance="outline" tone="neutral" onPress={() => list.refetch()}>
                  {t('pages.publish.retry')}
                </Button>
              </View>
            ) : !list.data?.versions.length ? (
              <EmptyState variant="compact" title={t('pages.history.empty')} />
            ) : (
              <View className="gap-2">
                {list.data.versions.map((version) => {
                  const member = members.data?.find((entry) => entry.userId === version.createdBy);
                  const name =
                    (member && memberProfileName(member)) ||
                    version.createdBy ||
                    t('notifications.someone');
                  const label = t('pages.history.entry', {
                    time: relativeTime(version.createdAt, locale),
                    name,
                    count: version.blockCount,
                  });
                  return (
                    <Item
                      key={version.id}
                      title={label}
                      role="radio"
                      selected={selectedId === version.id}
                      onPress={() => setSelected(version.id)}
                      accessibilityLabel={label}
                    />
                  );
                })}
              </View>
            )}
            {selectedId ? (
              <View className="border-t border-border pt-4 gap-3">
                <Text accessibilityRole="header" variant="headline-semibold">
                  {t('pages.history.preview')}
                </Text>
                {preview.isLoading ? (
                  <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
                ) : preview.isError ? (
                  <View className="gap-2">
                    <Text variant="body-regular" accessibilityRole="alert">
                      {t('pages.history.loadFailed')}
                    </Text>
                    <Button appearance="outline" tone="neutral" onPress={() => preview.refetch()}>
                      {t('pages.publish.retry')}
                    </Button>
                  </View>
                ) : preview.data ? (
                  <SharedBlockTree
                    blocks={preview.data.blocks}
                    font={page.font}
                    fileScope={{ kind: 'page', pageId: page.id }}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
          {!canRestore ? (
            <Text className="text-sm text-muted-foreground">{t('pages.history.noPermission')}</Text>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
