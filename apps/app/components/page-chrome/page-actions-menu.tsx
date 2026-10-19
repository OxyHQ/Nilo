import { apiErrorMessage } from '@/lib/api/error-message';
import { usePageFollow, useSetPageFollow } from '@/lib/hooks/use-page-follow';
import { saveExport } from '@/lib/save-export';
import { PageHistoryDialog } from './page-history-dialog';
import { ReminderDialog } from '@/components/reminders/reminder-dialog';
import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { RiMoreLine } from '@oxy.so/bloom/icons/RiMoreLine';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxy.so/services/ui/client';
import { toast } from '@oxy.so/bloom/toast';
import { Popover, PopoverTrigger, PopoverContent, PopoverSeparator } from '@oxy.so/bloom/popover';
import { Button } from '@oxy.so/bloom/button';
import { Item } from '@oxy.so/bloom/item';
import { RadioGroup } from '@oxy.so/bloom/radio';
import { confirm } from '@oxy.so/bloom/surfaces';
import { Switch } from '@oxy.so/bloom/switch';
import { Text } from '@oxy.so/bloom/typography';
import { AiPageAction } from './ai-page-action';
import { CanvasSwitch } from './canvas-switch';
import { OfflineSwitch } from './offline-switch';
import { PAGE_FONT_FAMILIES } from '@/lib/fonts';
import { useTranslation } from '@/hooks/useTranslation';
import { useDeletePage, useDuplicatePage, useUpdatePage } from '@/lib/hooks/use-pages';
import { EXPORT_FORMATS, type ExportFormat } from '@/lib/export-formats';
import { useExportPage } from '@/lib/hooks/use-page-transfer';
import { ImportPagesDialog } from './import-pages-dialog';
import type { Page } from '@/lib/types/pages';
import { MoveToDialog } from './move-to-dialog';

interface PageActionsMenuProps {
  page: Page;
  readOnly?: boolean;
}

/**
 * Three-dot menu in the page header. Wires together the existing mutations
 * and dialogs that the actions list expects (duplicate, move, favorite,
 * trash). Renders different items when the page is already archived.
 */
const EXPORT_LABELS: Record<ExportFormat, string> = {
  md: 'pages.export.markdown',
  html: 'pages.export.html',
  pdf: 'pages.export.pdf',
};

export function PageActionsMenu({ page, readOnly = false }: PageActionsMenuProps) {
  const router = useRouter();
  const follow = usePageFollow(page.id);
  const setFollow = useSetPageFollow(page.id);
  const { t } = useTranslation();
  const { user } = useOxy();
  const duplicatePage = useDuplicatePage();
  const updatePage = useUpdatePage();
  const deletePage = useDeletePage();
  const exportPage = useExportPage();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [remindersOpen, setRemindersOpen] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);

  const isOwner = user?.id === page.ownerId;

  const handleDuplicate = React.useCallback(() => {
    duplicatePage.mutate(
      { id: page.id, workspaceId: page.workspaceId },
      {
        onSuccess: (created) => {
          toast.success(t('pages.toasts.duplicated'));
          router.push(`/p/${created.id}`);
        },
        onError: (err) => {
          toast.error(apiErrorMessage(err, t('pages.toasts.duplicateFailed')));
        },
      },
    );
  }, [duplicatePage, page.id, page.workspaceId, router, t]);

  const handleFavorite = React.useCallback(() => {
    updatePage.mutate({ id: page.id, favorited: !page.favorited });
  }, [updatePage, page.id, page.favorited]);

  const handleCopyLink = React.useCallback(async () => {
    const origin =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.origin
        : 'https://nilo.so';
    const url = `${origin}/p/${page.id}`;
    await Clipboard.setStringAsync(url);
    toast.success(t('pages.toasts.linkCopied'));
  }, [page.id, t]);

  const handleExport = async (format: ExportFormat) => {
    try {
      const { blob, filename } = await exportPage.mutateAsync({
        id: page.id,
        format,
        fallback: t('pages.untitled'),
      });
      await saveExport({ blob, filename });
      toast.success(t('pages.export.downloaded'));
    } catch {
      toast.error(t('pages.toasts.exportFailed'));
    }
  };

  const handleMoveToTrash = React.useCallback(() => {
    deletePage.mutate(
      { id: page.id, workspaceId: page.workspaceId },
      {
        onSuccess: () => {
          toast.success(t('pages.toasts.movedToTrash'));
          router.replace('/(app)');
        },
        onError: (err) => {
          toast.error(err.message || t('pages.toasts.moveToTrashFailed'));
        },
      },
    );
  }, [deletePage, page.id, page.workspaceId, router, t]);

  const handleRestore = React.useCallback(() => {
    updatePage.mutate(
      { id: page.id, archived: false },
      {
        onSuccess: () => {
          toast.success(t('pages.toasts.restored'));
        },
      },
    );
  }, [updatePage, page.id, t]);

  const handleHardDelete = React.useCallback(() => {
    deletePage.mutate(
      { id: page.id, workspaceId: page.workspaceId, hard: true },
      {
        onSuccess: () => {
          toast.success(t('pages.toasts.deletedPermanently'));
          router.replace('/trash');
        },
        onError: (err) => {
          toast.error(err.message || t('pages.toasts.deleteFailed'));
        },
      },
    );
  }, [deletePage, page.id, page.workspaceId, router, t]);

  return (
    <>
      <Popover
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (open) void follow.refetch();
        }}
      >
        <PopoverTrigger asChild>
          <Button
            appearance="subtle"
            tone="neutral"
            iconOnly
            accessibilityLabel={t('pages.actions.menu')}
            leadingIcon={RiMoreLine}
          />
        </PopoverTrigger>
        <PopoverContent align="end" label={t('pages.actions.menu')} className="w-72">
          <ScrollView style={{ maxHeight: 560 }} keyboardShouldPersistTaps="handled">
            {!readOnly && !page.archived ? (
              <View className="gap-3 p-2">
                <Text
                  accessibilityRole="header"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t('pages.style.title')}
                </Text>
                <RadioGroup
                  variant="chip"
                  label={t('pages.style.title')}
                  className="flex-row gap-2"
                  optionStyle={{ flex: 1 }}
                  value={page.font ?? 'default'}
                  disabled={updatePage.isPending}
                  onValueChange={(font) =>
                    updatePage.mutate(
                      { id: page.id, font },
                      {
                        onError: () => toast.error(t('pages.style.updateFailed')),
                      },
                    )
                  }
                  options={(['default', 'serif', 'mono'] as const).map((font) => ({
                    value: font,
                    accessibilityLabel: t(`pages.style.${font}`),
                    labelContent: (
                      <View className="items-center gap-1">
                        <Text
                          className="text-2xl text-foreground"
                          style={{ fontFamily: PAGE_FONT_FAMILIES[font] }}
                        >
                          {t('pages.style.sample')}
                        </Text>
                        <Text variant="caption-1-regular">{t(`pages.style.${font}`)}</Text>
                      </View>
                    ),
                  }))}
                />
                {(['smallText', 'fullWidth', 'locked'] as const).map((field) => (
                  <View key={field} className="flex-row items-center justify-between gap-3">
                    <Text variant="body-regular">{t(`pages.style.${field}`)}</Text>
                    <Switch
                      checked={Boolean(page[field])}
                      disabled={updatePage.isPending}
                      accessibilityLabel={t(`pages.style.${field}`)}
                      onCheckedChange={(value) =>
                        updatePage.mutate(
                          { id: page.id, [field]: value },
                          {
                            onError: () => toast.error(t('pages.style.updateFailed')),
                          },
                        )
                      }
                    />
                  </View>
                ))}
                <CanvasSwitch page={page} />
                <PopoverSeparator />
              </View>
            ) : null}
            <OfflineSwitch page={page} />
            <Action
              label={t(
                follow.isError
                  ? 'pages.follow.retry'
                  : follow.data?.following
                    ? 'pages.follow.following'
                    : 'pages.follow.follow',
              )}
              disabled={follow.isFetching || follow.isPending || setFollow.isPending}
              onPress={() => {
                if (follow.isError) {
                  void follow.refetch();
                  return;
                }
                setFollow.mutate(!follow.data?.following, {
                  onError: () => toast.error(t('pages.follow.failed')),
                });
              }}
            />
            <Action
              label={t('pages.history.title')}
              onPress={() => {
                setMenuOpen(false);
                setHistoryOpen(true);
              }}
            />
            <Action
              label={t('pages.reminders.title')}
              onPress={() => {
                setMenuOpen(false);
                setRemindersOpen(true);
              }}
            />
            {!readOnly && !page.archived && !page.locked ? (
              <AiPageAction onOpen={() => setMenuOpen(false)} />
            ) : null}
            <Text className="px-3 pt-2 text-xs text-muted-foreground">
              {t('pages.export.title')}
            </Text>
            {EXPORT_FORMATS.map((format) => (
              <Action
                key={format}
                label={t(EXPORT_LABELS[format])}
                disabled={exportPage.isPending}
                onPress={() => {
                  void handleExport(format);
                }}
              />
            ))}
            {!readOnly && !page.archived ? (
              <>
                <Action
                  label={t('pages.import.intoPage')}
                  disabled={page.locked}
                  onPress={() => {
                    setMenuOpen(false);
                    setImportOpen(true);
                  }}
                />
                <PopoverSeparator />
                <Action
                  label={t(
                    page.template
                      ? 'pages.templates.makeRegular'
                      : page.databaseId
                        ? 'databases.templates.makeTemplate'
                        : 'pages.templates.makeTemplate',
                  )}
                  disabled={updatePage.isPending}
                  onPress={() =>
                    updatePage.mutate(
                      { id: page.id, template: !page.template },
                      {
                        onError: () => toast.error(t('pages.templates.updateFailed')),
                      },
                    )
                  }
                />
                <Action
                  label={t('pages.actions.duplicate')}
                  onPress={() => {
                    setMenuOpen(false);
                    handleDuplicate();
                  }}
                />
                <Action
                  label={t(
                    page.favorited
                      ? 'pages.actions.removeFromFavorites'
                      : 'pages.actions.addToFavorites',
                  )}
                  onPress={handleFavorite}
                />
                <Action
                  label={t('pages.actions.moveTo')}
                  onPress={() => {
                    setMenuOpen(false);
                    setMoveOpen(true);
                  }}
                />
                <Action label={t('pages.actions.copyLink')} onPress={handleCopyLink} />
                <PopoverSeparator />
                <Action
                  label={t('pages.actions.moveToTrash')}
                  destructive
                  onPress={() => {
                    setMenuOpen(false);
                    handleMoveToTrash();
                  }}
                />
              </>
            ) : !readOnly ? (
              <>
                <Action label={t('pages.actions.restoreFromTrash')} onPress={handleRestore} />
                {isOwner ? (
                  <Action
                    label={t('pages.actions.deletePermanently')}
                    destructive
                    onPress={() => {
                      setMenuOpen(false);
                      void confirm({
                        title: t('pages.deleteDialog.title'),
                        description: t('pages.deleteDialog.description', {
                          title: page.title || t('pages.untitled'),
                        }),
                        confirmLabel: t('common.delete'),
                        cancelLabel: t('common.cancel'),
                        destructive: true,
                      }).then((confirmed) => {
                        if (confirmed) handleHardDelete();
                      });
                    }}
                  />
                ) : null}
              </>
            ) : null}
          </ScrollView>
        </PopoverContent>
      </Popover>

      {importOpen ? (
        <ImportPagesDialog
          workspaceId={page.workspaceId}
          parentId={page.id}
          onClose={() => setImportOpen(false)}
        />
      ) : null}
      {historyOpen ? <PageHistoryDialog page={page} onClose={() => setHistoryOpen(false)} /> : null}
      {remindersOpen ? (
        <ReminderDialog pageId={page.id} onClose={() => setRemindersOpen(false)} />
      ) : null}
      <MoveToDialog open={moveOpen} onOpenChange={setMoveOpen} page={page} />
    </>
  );
}

function Action({
  label,
  onPress,
  disabled,
  destructive,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Item
      title={label}
      density="compact"
      role="menuitem"
      onPress={onPress}
      disabled={disabled}
      destructive={destructive}
      accessibilityLabel={label}
    />
  );
}
