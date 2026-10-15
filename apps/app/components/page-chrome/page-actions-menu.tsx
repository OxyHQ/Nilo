import { apiErrorMessage } from '@/lib/api/error-message';
import { usePageFollow, useSetPageFollow } from '@/lib/hooks/use-page-follow';
import { saveExport } from '@/lib/save-export';
import { PageHistoryDialog } from './page-history-dialog';
import { ReminderDialog } from '@/components/reminders/reminder-dialog';
import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { MoreHorizontal } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxy.so/services';
import { toast } from '@oxy.so/bloom/toast';
import { Popover, PopoverTrigger, PopoverContent, PopoverSeparator } from '@oxy.so/bloom/popover';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Switch } from '@/components/ui/switch';
import { AiPageAction } from './ai-page-action';
import { CanvasSwitch } from './canvas-switch';
import { OfflineSwitch } from './offline-switch';
import { PAGE_FONT_FAMILIES } from '@/lib/fonts';
import { cn } from '@/lib/utils';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useColorScheme } from '@/lib/useColorScheme';
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
  const { colors } = useColorScheme();
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
  const [deleteOpen, setDeleteOpen] = React.useState(false);

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
          <Pressable
            accessibilityLabel={t('pages.actions.menu')}
            accessibilityRole="button"
            className="h-9 w-9 items-center justify-center rounded-lg hover:bg-muted"
          >
            <MoreHorizontal size={16} color={colors.foreground} />
          </Pressable>
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
                <View className="flex-row gap-2">
                  {(['default', 'serif', 'mono'] as const).map((font) => (
                    <Button
                      key={font}
                      variant="ghost"
                      className={cn(
                        'h-auto flex-1 gap-1 px-1 py-2',
                        (page.font ?? 'default') === font && 'bg-muted',
                      )}
                      disabled={updatePage.isPending}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: (page.font ?? 'default') === font }}
                      accessibilityLabel={t(`pages.style.${font}`)}
                      onPress={() =>
                        updatePage.mutate(
                          { id: page.id, font },
                          {
                            onError: () => toast.error(t('pages.style.updateFailed')),
                          },
                        )
                      }
                    >
                      <Text className="text-2xl" style={{ fontFamily: PAGE_FONT_FAMILIES[font] }}>
                        {t('pages.style.sample')}
                      </Text>
                      <Text className="text-xs">{t(`pages.style.${font}`)}</Text>
                    </Button>
                  ))}
                </View>
                {(['smallText', 'fullWidth', 'locked'] as const).map((field) => (
                  <View key={field} className="flex-row items-center justify-between gap-3">
                    <Text className="text-sm">{t(`pages.style.${field}`)}</Text>
                    <Switch
                      value={Boolean(page[field])}
                      disabled={updatePage.isPending}
                      accessibilityLabel={t(`pages.style.${field}`)}
                      onValueChange={(value) =>
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
                      setDeleteOpen(true);
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

      <ConfirmationDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('pages.deleteDialog.title')}
        description={t('pages.deleteDialog.description', {
          title: page.title || t('pages.untitled'),
        })}
        confirmText={t('common.delete')}
        confirmVariant="destructive"
        onConfirm={handleHardDelete}
      />
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
    <Button
      variant="ghost"
      className="justify-start"
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
    >
      <Text className={cn('text-sm', destructive && 'text-destructive')}>{label}</Text>
    </Button>
  );
}
