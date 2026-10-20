import { apiErrorMessage } from '@/lib/api/error-message';
import { usePageFollow, useSetPageFollow } from '@/lib/hooks/use-page-follow';
import { saveExport } from '@/lib/save-export';
import { PageHistoryDialog } from './page-history-dialog';
import { ReminderDialog } from '@/components/reminders/reminder-dialog';
import * as React from 'react';
import { useCopyPageLink } from '@/components/sharing/use-copy-page-link';
import { RiMoreLine } from '@oxy.so/bloom/icons/RiMoreLine';
import { useRouter } from 'expo-router';
import { toast } from '@oxy.so/bloom/toast';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@oxy.so/bloom/dropdown-menu';
import { Button } from '@oxy.so/bloom/button';
import { AiPageAction } from './ai-page-action';
import { CanvasSwitch } from './canvas-switch';
import { OfflineSwitch } from './offline-switch';
import { useTranslation } from '@/hooks/useTranslation';
import { useDeletePage, useDuplicatePage, useUpdatePage } from '@/lib/hooks/use-pages';
import { EXPORT_FORMATS, type ExportFormat } from '@/lib/export-formats';
import { useExportPage } from '@/lib/hooks/use-page-transfer';
import { ImportPagesDialog } from './import-pages-dialog';
import type { Page } from '@/lib/types/pages';
import { MoveToDialog } from './move-to-dialog';
import { useTrashedPageActions } from './trashed-page';

interface PageActionsMenuProps {
  page: Page;
  readOnly?: boolean;
  onOpenActivity?: () => void;
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

export function PageActionsMenu({ page, readOnly = false, onOpenActivity }: PageActionsMenuProps) {
  const router = useRouter();
  const follow = usePageFollow(page.id);
  const setFollow = useSetPageFollow(page.id);
  const { t } = useTranslation();
  const duplicatePage = useDuplicatePage();
  const updatePage = useUpdatePage();
  const deletePage = useDeletePage();
  const exportPage = useExportPage();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [remindersOpen, setRemindersOpen] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);

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

  const handleCopyLink = useCopyPageLink(page.id);

  const handleExport = async (format: ExportFormat, subpages = false) => {
    try {
      const { blob, filename } = await exportPage.mutateAsync({
        id: page.id,
        format,
        subpages,
        fallback: page.title || t('pages.untitled'),
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
          toast.error(apiErrorMessage(err, t('pages.toasts.moveToTrashFailed')));
        },
      },
    );
  }, [deletePage, page.id, page.workspaceId, router, t]);

  const trashed = useTrashedPageActions(page);

  return (
    <>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (open) void follow.refetch();
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            appearance="plain"
            tone="neutral"
            iconOnly
            accessibilityLabel={t('pages.actions.menu')}
            leadingIcon={RiMoreLine}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" label={t('pages.actions.menu')}>
          <DropdownMenuItem onPress={() => void handleCopyLink()}>
            {t('pages.actions.copyLink')}
          </DropdownMenuItem>
          {!page.archived ? (
            <DropdownMenuItem onPress={handleFavorite}>
              {t(
                page.favorited
                  ? 'pages.actions.removeFromFavorites'
                  : 'pages.actions.addToFavorites',
              )}
            </DropdownMenuItem>
          ) : null}
          {!readOnly && !page.archived ? (
            <>
              <DropdownMenuItem disabled={duplicatePage.isPending} onPress={handleDuplicate}>
                {t('pages.actions.duplicate')}
              </DropdownMenuItem>
              <DropdownMenuItem onPress={() => setMoveOpen(true)}>
                {t('pages.actions.moveTo')}
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          {onOpenActivity ? (
            <DropdownMenuItem onPress={onOpenActivity}>
              {t('pages.activity.title')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onPress={() => setHistoryOpen(true)}>
            {t('pages.history.title')}
          </DropdownMenuItem>
          <DropdownMenuItem onPress={() => setRemindersOpen(true)}>
            {t('pages.reminders.title')}
          </DropdownMenuItem>
          {!readOnly && !page.archived ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t('pages.style.title')}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent label={t('pages.style.title')}>
                <DropdownMenuRadioGroup
                  value={page.font ?? 'default'}
                  onValueChange={(font) => {
                    if (font === 'default' || font === 'serif' || font === 'mono') {
                      updatePage.mutate(
                        { id: page.id, font },
                        { onError: () => toast.error(t('pages.style.updateFailed')) },
                      );
                    }
                  }}
                >
                  {(['default', 'serif', 'mono'] as const).map((font) => (
                    <DropdownMenuRadioItem
                      key={font}
                      value={font}
                      indicatorPosition="trailing"
                      keepOpen
                      disabled={updatePage.isPending}
                    >
                      {t(`pages.style.${font}`)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                {(['smallText', 'fullWidth'] as const).map((field) => (
                  <DropdownMenuCheckboxItem
                    key={field}
                    indicatorPosition="trailing"
                    keepOpen
                    checked={Boolean(page[field])}
                    disabled={updatePage.isPending}
                    onCheckedChange={(value) =>
                      updatePage.mutate(
                        { id: page.id, [field]: value },
                        { onError: () => toast.error(t('pages.style.updateFailed')) },
                      )
                    }
                  >
                    {t(`pages.style.${field}`)}
                  </DropdownMenuCheckboxItem>
                ))}
                <CanvasSwitch page={page} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          {!readOnly && !page.archived && !page.locked ? (
            <AiPageAction onOpen={() => setMenuOpen(false)} />
          ) : null}
          <DropdownMenuCheckboxItem
            indicatorPosition="trailing"
            checked={Boolean(follow.data?.following)}
            disabled={follow.isFetching || follow.isPending || setFollow.isPending}
            onCheckedChange={(next) => {
              if (follow.isError) {
                void follow.refetch();
                return;
              }
              setFollow.mutate(next, { onError: () => toast.error(t('pages.follow.failed')) });
            }}
          >
            {t(
              follow.isError
                ? 'pages.follow.retry'
                : follow.data?.following
                  ? 'pages.follow.following'
                  : 'pages.follow.follow',
            )}
          </DropdownMenuCheckboxItem>
          <OfflineSwitch page={page} />
          {!readOnly && !page.archived ? (
            <DropdownMenuCheckboxItem
              indicatorPosition="trailing"
              checked={page.locked}
              disabled={updatePage.isPending}
              onCheckedChange={(locked) =>
                updatePage.mutate(
                  { id: page.id, locked },
                  { onError: () => toast.error(t('pages.style.updateFailed')) },
                )
              }
            >
              {t('pages.style.locked')}
            </DropdownMenuCheckboxItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{t('pages.export.title')}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent label={t('pages.export.title')}>
              {EXPORT_FORMATS.map((format) => (
                <DropdownMenuItem
                  key={format}
                  disabled={exportPage.isPending}
                  onPress={() => void handleExport(format)}
                >
                  {t(EXPORT_LABELS[format])}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              {(['md', 'html'] as const).map((format) => (
                <DropdownMenuItem
                  key={`${format}-subpages`}
                  disabled={exportPage.isPending}
                  onPress={() => void handleExport(format, true)}
                >
                  {t('pages.export.withSubpages', { format: t(EXPORT_LABELS[format]) })}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {!readOnly && !page.archived ? (
            <>
              <DropdownMenuItem disabled={page.locked} onPress={() => setImportOpen(true)}>
                {t('pages.import.intoPage')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={updatePage.isPending}
                onPress={() =>
                  updatePage.mutate(
                    { id: page.id, template: !page.template },
                    { onError: () => toast.error(t('pages.templates.updateFailed')) },
                  )
                }
              >
                {t(
                  page.template
                    ? 'pages.templates.makeRegular'
                    : page.databaseId
                      ? 'databases.templates.makeTemplate'
                      : 'pages.templates.makeTemplate',
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={deletePage.isPending}
                onPress={handleMoveToTrash}
              >
                {t('pages.actions.moveToTrash')}
              </DropdownMenuItem>
            </>
          ) : !readOnly ? (
            <>
              <DropdownMenuItem onPress={trashed.restore}>
                {t('pages.actions.restoreFromTrash')}
              </DropdownMenuItem>
              {trashed.canDeleteForever ? (
                <DropdownMenuItem
                  variant="destructive"
                  onPress={() => void trashed.deleteForever()}
                >
                  {t('pages.actions.deletePermanently')}
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

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
