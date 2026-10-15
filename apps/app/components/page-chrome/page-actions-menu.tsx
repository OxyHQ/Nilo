import { PageHistoryDialog } from './page-history-dialog';
import { ReminderDialog } from '@/components/reminders/reminder-dialog';
import * as React from 'react';
import { Platform, Pressable } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { MoreHorizontal } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxy.so/services';
import { toast } from '@oxy.so/bloom/toast';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useDeletePage, useDuplicatePage, useUpdatePage } from '@/lib/hooks/use-pages';
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
export function PageActionsMenu({ page, readOnly = false }: PageActionsMenuProps) {
  const router = useRouter();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const { user } = useOxy();
  const duplicatePage = useDuplicatePage();
  const updatePage = useUpdatePage();
  const deletePage = useDeletePage();
  const exportPage = useExportPage();
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
          toast.error(err.message || t('pages.toasts.duplicateFailed'));
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

  const handleExport = async (format: 'md' | 'html') => {
    if (Platform.OS !== 'web') {
      toast.info(t('pages.export.webOnly'));
      return;
    }
    try {
      const { blob, filename } = await exportPage.mutateAsync({
        id: page.id,
        format,
        fallback: t('pages.untitled'),
      });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      try {
        link.href = href;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        // Give the browser time to start reading the download before releasing it.
        setTimeout(() => URL.revokeObjectURL(href), 60_000);
      }
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
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <Pressable
            accessibilityLabel={t('pages.actions.menu')}
            accessibilityRole="button"
            className="h-9 w-9 items-center justify-center rounded-lg hover:bg-muted"
          >
            <MoreHorizontal size={16} color={colors.foreground} />
          </Pressable>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item key="history" onSelect={() => setHistoryOpen(true)}>
            <DropdownMenu.ItemTitle>{t('pages.history.title')}</DropdownMenu.ItemTitle>
          </DropdownMenu.Item>
          <DropdownMenu.Item key="reminders" onSelect={() => setRemindersOpen(true)}>
            <DropdownMenu.ItemTitle>{t('pages.reminders.title')}</DropdownMenu.ItemTitle>
          </DropdownMenu.Item>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger key="export" disabled={exportPage.isPending}>
              <DropdownMenu.ItemTitle>{t('pages.export.title')}</DropdownMenu.ItemTitle>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent>
              <DropdownMenu.Item
                key="export-md"
                disabled={exportPage.isPending}
                onSelect={() => {
                  void handleExport('md');
                }}
              >
                <DropdownMenu.ItemTitle>{t('pages.export.markdown')}</DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                key="export-html"
                disabled={exportPage.isPending}
                onSelect={() => {
                  void handleExport('html');
                }}
              >
                <DropdownMenu.ItemTitle>{t('pages.export.html')}</DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>
          {!readOnly && !page.archived ? (
            <DropdownMenu.Item key="import" onSelect={() => setImportOpen(true)}>
              <DropdownMenu.ItemTitle>{t('pages.import.intoPage')}</DropdownMenu.ItemTitle>
            </DropdownMenu.Item>
          ) : null}
          {!readOnly && <DropdownMenu.Separator />}
          {readOnly ? null : !page.archived ? (
            <>
              <DropdownMenu.Item
                key="template"
                disabled={updatePage.isPending}
                onSelect={() =>
                  updatePage.mutate(
                    { id: page.id, template: !page.template },
                    { onError: () => toast.error(t('pages.templates.updateFailed')) },
                  )
                }
              >
                <DropdownMenu.ItemTitle>
                  {t(
                    page.template ? 'pages.templates.makeRegular' : 'pages.templates.makeTemplate',
                  )}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              <DropdownMenu.Item key="duplicate" onSelect={handleDuplicate}>
                <DropdownMenu.ItemIcon ios={{ name: 'doc.on.doc' }} />
                <DropdownMenu.ItemTitle>{t('pages.actions.duplicate')}</DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              <DropdownMenu.Item key="favorite" onSelect={handleFavorite}>
                <DropdownMenu.ItemIcon ios={{ name: page.favorited ? 'star.slash' : 'star' }} />
                <DropdownMenu.ItemTitle>
                  {page.favorited
                    ? t('pages.actions.removeFromFavorites')
                    : t('pages.actions.addToFavorites')}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              <DropdownMenu.Item key="move" onSelect={() => setMoveOpen(true)}>
                <DropdownMenu.ItemIcon ios={{ name: 'folder' }} />
                <DropdownMenu.ItemTitle>{t('pages.actions.moveTo')}</DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              <DropdownMenu.Item key="copy-link" onSelect={handleCopyLink}>
                <DropdownMenu.ItemIcon ios={{ name: 'link' }} />
                <DropdownMenu.ItemTitle>{t('pages.actions.copyLink')}</DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item key="trash" destructive onSelect={handleMoveToTrash}>
                <DropdownMenu.ItemIcon ios={{ name: 'trash' }} />
                <DropdownMenu.ItemTitle>{t('pages.actions.moveToTrash')}</DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
            </>
          ) : (
            <>
              <DropdownMenu.Item key="restore" onSelect={handleRestore}>
                <DropdownMenu.ItemIcon ios={{ name: 'arrow.uturn.backward' }} />
                <DropdownMenu.ItemTitle>
                  {t('pages.actions.restoreFromTrash')}
                </DropdownMenu.ItemTitle>
              </DropdownMenu.Item>
              {isOwner ? (
                <>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    key="hard-delete"
                    destructive
                    onSelect={() => setDeleteOpen(true)}
                  >
                    <DropdownMenu.ItemIcon ios={{ name: 'trash.slash' }} />
                    <DropdownMenu.ItemTitle>
                      {t('pages.actions.deletePermanently')}
                    </DropdownMenu.ItemTitle>
                  </DropdownMenu.Item>
                </>
              ) : null}
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>

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
