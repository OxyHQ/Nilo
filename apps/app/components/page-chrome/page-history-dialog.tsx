import { useState } from 'react';
import { View, ScrollView, ActivityIndicator } from 'react-native';
import { toast } from '@oxy.so/bloom/toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
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

export function PageHistoryDialog({ page, onClose }: { page: Page; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const list = usePageVersions(page.id);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedId = selected ?? list.data?.versions[0]?.id ?? '';
  const preview = usePageVersion(page.id, selectedId);
  const members = useWorkspaceMembers(page.workspaceId);
  const access = usePage(page.id);
  const canRestore = !access.isError && hasRole(access.data?.role, 'editor');
  const restore = useRestoreVersion(page);
  const [confirm, setConfirm] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !restore.isPending) {
          if (confirm) setConfirm(false);
          else onClose();
        }
      }}
    >
      <DialogContent className={page.fullWidth ? 'max-w-full' : 'max-w-3xl'}>
        {confirm ? (
          <View className="gap-4">
            <DialogHeader>
              <DialogTitle>{t('pages.history.confirmTitle')}</DialogTitle>
              <DialogDescription>{t('pages.history.confirmBody')}</DialogDescription>
            </DialogHeader>
            <Button
              disabled={!canRestore || restore.isPending}
              onPress={async () => {
                if (!canRestore || restore.isPending || !selectedId) return;
                try {
                  await restore.mutateAsync(selectedId);
                  setConfirm(false);
                  toast.success(t('pages.history.restored'));
                } catch {
                  toast.error(t('pages.history.restoreFailed'));
                }
              }}
              accessibilityLabel={t('pages.history.restore')}
            >
              <Text>{t(restore.isPending ? 'common.processing' : 'pages.history.restore')}</Text>
            </Button>
            <Button
              variant="outline"
              disabled={restore.isPending}
              onPress={() => setConfirm(false)}
            >
              <Text>{t('common.cancel')}</Text>
            </Button>
          </View>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('pages.history.title')}</DialogTitle>
              <DialogDescription>{t('pages.history.description')}</DialogDescription>
            </DialogHeader>
            <ScrollView
              style={{ maxHeight: 540, flexShrink: 1 }}
              contentContainerClassName="gap-4"
              keyboardShouldPersistTaps="handled"
            >
              {list.isLoading ? (
                <ActivityIndicator accessibilityLabel={t('common.loading')} />
              ) : list.isError ? (
                <View className="gap-2">
                  <Text accessibilityRole="alert">{t('pages.history.loadFailed')}</Text>
                  <Button variant="outline" onPress={() => list.refetch()}>
                    <Text>{t('pages.publish.retry')}</Text>
                  </Button>
                </View>
              ) : !list.data?.versions.length ? (
                <Text>{t('pages.history.empty')}</Text>
              ) : (
                <View className="gap-2">
                  {list.data.versions.map((version) => {
                    const member = members.data?.find(
                      (entry) => entry.userId === version.createdBy,
                    );
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
                      <Button
                        key={version.id}
                        variant={selectedId === version.id ? 'secondary' : 'ghost'}
                        className="h-auto py-3 justify-start"
                        onPress={() => setSelected(version.id)}
                        accessibilityLabel={label}
                        accessibilityState={{ selected: selectedId === version.id }}
                      >
                        <Text className="web:whitespace-normal">{label}</Text>
                      </Button>
                    );
                  })}
                </View>
              )}
              {selectedId ? (
                <View className="border-t border-border pt-4 gap-3">
                  <Text accessibilityRole="header" className="font-semibold">
                    {t('pages.history.preview')}
                  </Text>
                  {preview.isLoading ? (
                    <ActivityIndicator accessibilityLabel={t('common.loading')} />
                  ) : preview.isError ? (
                    <View className="gap-2">
                      <Text accessibilityRole="alert">{t('pages.history.loadFailed')}</Text>
                      <Button variant="outline" onPress={() => preview.refetch()}>
                        <Text>{t('pages.publish.retry')}</Text>
                      </Button>
                    </View>
                  ) : preview.data ? (
                    <SharedBlockTree blocks={preview.data.blocks} font={page.font} />
                  ) : null}
                </View>
              ) : null}
            </ScrollView>
            {selectedId ? (
              <Button
                disabled={!canRestore || restore.isPending || !preview.data || preview.isError}
                onPress={() => setConfirm(true)}
                accessibilityLabel={t('pages.history.restore')}
              >
                <Text>{t('pages.history.restore')}</Text>
              </Button>
            ) : null}
            {!canRestore ? (
              <Text className="text-sm text-muted-foreground">
                {t('pages.history.noPermission')}
              </Text>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
