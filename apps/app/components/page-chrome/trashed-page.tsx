import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { RiArrowGoBackLine } from '@oxy.so/bloom/icons/RiArrowGoBackLine';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { Button } from '@oxy.so/bloom/button';
import { confirm } from '@oxy.so/bloom/surfaces';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { apiErrorMessage } from '@/lib/api/error-message';
import { useDeletePage, useUpdatePage } from '@/lib/hooks/use-pages';
import { useWorkspaceRole } from '@/lib/hooks/use-workspaces';
import type { Page } from '@/lib/types/pages';

/**
 * What can be done with a page in the trash: restore it (its subpages come
 * back with it) or, for a workspace owner — whom the server requires — delete
 * it for good, after asking.
 */
export function useTrashedPageActions(page: Pick<Page, 'id' | 'title' | 'workspaceId'>) {
  const { t } = useTranslation();
  const router = useRouter();
  const updatePage = useUpdatePage();
  const deletePage = useDeletePage();
  const canDeleteForever = useWorkspaceRole(page.workspaceId) === 'owner';

  const restore = React.useCallback(() => {
    updatePage.mutate(
      { id: page.id, archived: false },
      {
        onSuccess: () => toast.success(t('pages.toasts.restored')),
        onError: (err) => toast.error(apiErrorMessage(err, t('pages.toasts.restoreFailed'))),
      },
    );
  }, [updatePage, page.id, t]);

  const deleteForever = React.useCallback(async () => {
    const confirmed = await confirm({
      title: t('pages.deleteDialog.title'),
      description: t('pages.deleteDialog.description', {
        title: page.title || t('pages.untitled'),
      }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!confirmed) return;
    deletePage.mutate(
      { id: page.id, workspaceId: page.workspaceId, hard: true },
      {
        onSuccess: () => {
          toast.success(t('pages.toasts.deletedPermanently'));
          router.replace('/trash');
        },
        onError: (err) => toast.error(apiErrorMessage(err, t('pages.toasts.deleteFailed'))),
      },
    );
  }, [deletePage, page.id, page.title, page.workspaceId, router, t]);

  return { restore, deleteForever, canDeleteForever, busy: updatePage.isPending };
}

/** Above a page in the trash: it is read there, and restored to be edited. */
export function TrashedPageBanner({ page, canEdit }: { page: Page; canEdit: boolean }) {
  const { t } = useTranslation();
  const { restore, deleteForever, canDeleteForever, busy } = useTrashedPageActions(page);
  return (
    <View
      accessibilityRole="alert"
      className="flex-row flex-wrap items-center justify-center gap-3 border-b border-border bg-muted px-4 py-2"
    >
      <Text className="text-sm">{t('pages.inTrash')}</Text>
      {canEdit ? (
        <View className="flex-row gap-2">
          <Button
            appearance="subtle"
            size="sm"
            leadingIcon={RiArrowGoBackLine}
            disabled={busy}
            onPress={restore}
          >
            {t('trash.restorePage')}
          </Button>
          {canDeleteForever ? (
            <Button
              appearance="subtle"
              size="sm"
              leadingIcon={RiDeleteBin6Line}
              onPress={() => void deleteForever()}
            >
              {t('pages.actions.deletePermanently')}
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
