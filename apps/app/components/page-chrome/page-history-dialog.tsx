import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { AppShellPanel, AppShellPanels, useAppShellPanel } from '@oxy.so/bloom/app-shell';
import { toast } from '@oxy.so/bloom/toast';
import { Button, CloseButton } from '@oxy.so/bloom/button';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Item } from '@oxy.so/bloom/item';
import { Loading } from '@oxy.so/bloom/loading';
import { PageFooter } from '@oxy.so/bloom/page-footer';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { Text } from '@oxy.so/bloom/typography';
import { SharedBlockTree } from '@/components/sharing/shared-block-renderer';
import { useTranslation } from '@/hooks/useTranslation';
import { usePageVersions, usePageVersion, useRestoreVersion } from '@/lib/hooks/use-page-extras';
import { usePage } from '@/lib/hooks/use-pages';
import { hasRole } from '@/lib/hooks/workspace-roles';
import { profileName, useMemberProfiles } from '@/lib/hooks/use-member-profiles';
import type { Page } from '@/lib/types/pages';

/** Exact local dates remain distinguishable even when versions were saved minutes apart. */
export function historyVersionTime(iso: string, locale: string, unknown: string) {
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : unknown;
}

function HistoryPanel({
  title,
  subtitle,
  children,
  onBack,
  backLabel,
  onClose,
  closeLabel,
  closeOnlyWhenAlone = false,
  disabled = false,
  actions,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  onClose: () => void;
  closeLabel: string;
  closeOnlyWhenAlone?: boolean;
  disabled?: boolean;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  const { alone } = useAppShellPanel();
  return (
    <Screen
      scroll="content"
      navigationScope="isolated"
      bottomBar={footer}
      header={
        <PageHeader
          presentation="bar"
          border="always"
          title={
            <Text variant="body-medium" numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
          }
          subtitle={subtitle}
          onBack={alone ? onBack : undefined}
          backLabel={backLabel}
          actions={
            <>
              {actions}
              {!closeOnlyWhenAlone || alone ? (
                <CloseButton
                  onPress={onClose}
                  disabled={disabled}
                  accessibilityLabel={closeLabel}
                  size="md"
                />
              ) : null}
            </>
          }
        />
      }
    >
      {children}
    </Screen>
  );
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
  const [panel, setPanel] = useState(initialVersionId ? 'preview' : 'versions');
  const selectedId = selected ?? list.data?.versions[0]?.id ?? '';
  const preview = usePageVersion(page.id, selectedId);
  const profiles = useMemberProfiles(list.data?.versions.map((version) => version.createdBy) ?? []);
  const profilesById = new Map(profiles.data?.map((profile) => [profile.id, profile]));
  const access = usePage(page.id);
  const canRestore =
    !access.isError && access.fetchStatus === 'idle' && hasRole(access.data?.role, 'editor');
  const restore = useRestoreVersion(page);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState(false);
  const control = useDialogControl();
  const mounted = useRef(true);
  const restoring = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selectedVersion =
    preview.data?.version ?? list.data?.versions.find((version) => version.id === selectedId);
  const versionTime = selectedVersion
    ? historyVersionTime(selectedVersion.createdAt, locale, t('pages.history.unknownDate'))
    : t('pages.history.preview');
  const cancelRestore = () => {
    if (restore.isPending || restoring.current) return;
    setConfirmId(null);
    setRestoreError(false);
    setPanel('preview');
  };
  const close = () => {
    if (restore.isPending || restoring.current) return;
    if (confirmId) cancelRestore();
    else control.close();
  };
  const restoreSelected = async () => {
    if (!canRestore || restore.isPending || restoring.current || !confirmId) return;
    restoring.current = true;
    setRestoreError(false);
    try {
      await restore.mutateAsync(confirmId);
      if (!mounted.current) return;
      setConfirmId(null);
      toast.success(t('pages.history.restored'));
      control.close();
    } catch {
      if (mounted.current) setRestoreError(true);
    } finally {
      restoring.current = false;
    }
  };
  if (!list.canEdit) return null;
  return (
    <Dialog
      control={control}
      startOpen
      onClose={onClose}
      dismissOnBackdrop={!confirmId && !restore.isPending}
      presentation="fullscreen"
      label={t('pages.history.title')}
      scrollable={false}
      contentPadding={0}
    >
      <AppShellPanels
        scope="local"
        appearance="plain"
        collapseBelow="md"
        show={panel}
        testID="history-panels"
      >
        <AppShellPanel id="versions" width={320} minWidth={240} appearance="plain">
          <HistoryPanel
            title={confirmId ? t('pages.history.confirmTitle') : page.title || t('pages.untitled')}
            subtitle={confirmId ? versionTime : t('pages.history.title')}
            onClose={close}
            closeLabel={t(confirmId ? 'pages.history.cancelRestore' : 'pages.history.close')}
            closeOnlyWhenAlone
            disabled={restore.isPending}
            footer={
              confirmId ? (
                <PageFooter
                  actions={
                    <View className="flex-1 gap-2">
                      <Button
                        disabled={!canRestore || restore.isPending}
                        onPress={() => void restoreSelected()}
                      >
                        {t(restore.isPending ? 'common.processing' : 'pages.history.restore')}
                      </Button>
                      <Button
                        appearance="outline"
                        tone="neutral"
                        disabled={restore.isPending}
                        onPress={cancelRestore}
                      >
                        {t('common.cancel')}
                      </Button>
                    </View>
                  }
                />
              ) : undefined
            }
          >
            {confirmId ? (
              <ScreenScrollView
                contentContainerClassName="p-6 gap-4"
                testID="history-restore-review"
              >
                <Text variant="body-medium" accessibilityRole="header">
                  {t('pages.history.restoreScope')}
                </Text>
                <Text variant="body-regular">{t('pages.history.confirmBody')}</Text>
                <Item
                  title={versionTime}
                  subtitle={
                    profileName(profilesById.get(selectedVersion?.createdBy ?? '')) ??
                    t('pages.info.unknownMember')
                  }
                />
                {restoreError ? (
                  <Text accessibilityRole="alert" variant="body-regular">
                    {t('pages.history.restoreFailed')}
                  </Text>
                ) : null}
              </ScreenScrollView>
            ) : (
              <ScreenScrollView contentContainerClassName="p-3 gap-2" testID="history-version-list">
                {list.isLoading ? (
                  <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
                ) : list.isError ? (
                  <>
                    <Text variant="body-regular" accessibilityRole="alert">
                      {t('pages.history.loadFailed')}
                    </Text>
                    <Button appearance="outline" tone="neutral" onPress={() => list.refetch()}>
                      {t('pages.publish.retry')}
                    </Button>
                  </>
                ) : !list.data?.versions.length ? (
                  <EmptyState variant="compact" title={t('pages.history.empty')} />
                ) : (
                  list.data.versions.map((version) => {
                    const name =
                      profileName(profilesById.get(version.createdBy)) ??
                      t('pages.info.unknownMember');
                    const time = historyVersionTime(
                      version.createdAt,
                      locale,
                      t('pages.history.unknownDate'),
                    );
                    return (
                      <Item
                        key={version.id}
                        title={time}
                        subtitle={name}
                        selected={selectedId === version.id}
                        accessibilityLabel={t('pages.history.entry', {
                          time,
                          name,
                          count: version.blockCount,
                        })}
                        accessibilityHint={t('pages.history.preview')}
                        onPress={() => {
                          setSelected(version.id);
                          setPanel('preview');
                        }}
                      />
                    );
                  })
                )}
              </ScreenScrollView>
            )}
          </HistoryPanel>
        </AppShellPanel>
        <AppShellPanel id="preview" minWidth={0} appearance="plain">
          <HistoryPanel
            title={versionTime}
            onBack={confirmId ? undefined : () => setPanel('versions')}
            backLabel={t('pages.history.back')}
            onClose={close}
            closeLabel={t(confirmId ? 'pages.history.cancelRestore' : 'pages.history.close')}
            disabled={restore.isPending}
            actions={
              selectedId && !confirmId ? (
                <Button
                  disabled={!canRestore || restore.isPending || !preview.data || preview.isError}
                  onPress={() => {
                    setRestoreError(false);
                    setConfirmId(selectedId);
                    setPanel('versions');
                  }}
                >
                  {t('pages.history.beginRestore')}
                </Button>
              ) : undefined
            }
          >
            <ScreenScrollView
              key={selectedId}
              contentContainerClassName="p-6 gap-4"
              testID="history-version-preview"
            >
              {!selectedId ? (
                <EmptyState variant="compact" title={t('pages.history.empty')} />
              ) : preview.isLoading ? (
                <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
              ) : preview.isError ? (
                <>
                  <Text variant="body-regular" accessibilityRole="alert">
                    {t('pages.history.loadFailed')}
                  </Text>
                  <Button appearance="outline" tone="neutral" onPress={() => preview.refetch()}>
                    {t('pages.publish.retry')}
                  </Button>
                </>
              ) : preview.data ? (
                <View
                  className="gap-6 self-center w-full"
                  style={page.fullWidth ? undefined : { maxWidth: 768 }}
                >
                  <Text variant="caption-1-regular" className="text-muted-foreground">
                    {t('pages.history.contentOnly')}
                  </Text>
                  <SharedBlockTree
                    blocks={preview.data.blocks}
                    font={page.font}
                    fileScope={{ kind: 'page', pageId: page.id }}
                  />
                </View>
              ) : null}
            </ScreenScrollView>
          </HistoryPanel>
        </AppShellPanel>
      </AppShellPanels>
    </Dialog>
  );
}
