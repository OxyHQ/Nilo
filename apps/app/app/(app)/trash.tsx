import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxy.so/services/ui/client';
import { RiArrowGoBackLine } from '@oxy.so/bloom/icons/RiArrowGoBackLine';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { Button } from '@oxy.so/bloom/button';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Item } from '@oxy.so/bloom/item';
import { Loading } from '@oxy.so/bloom/loading';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { confirm } from '@oxy.so/bloom/surfaces';
import { toast } from '@oxy.so/bloom/toast';
import { useTranslation } from '@/hooks/useTranslation';
import { apiErrorMessage } from '@/lib/api/error-message';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { useWorkspace } from '@/lib/hooks/use-workspaces';
import {
  useArchivedPages,
  useDeletePage,
  useEmptyTrash,
  useUpdatePage,
} from '@/lib/hooks/use-pages';
import { IconDisplay } from '@/components/page-chrome';
import type { Page } from '@/lib/types/pages';

/**
 * Trash route. Lists every archived page in the active workspace and lets
 * the user restore or permanently delete each one. Owners additionally see
 * an "Empty trash" button at the top.
 */
export default function TrashRoute() {
  const { t } = useTranslation();
  const { user } = useOxy();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: workspace } = useWorkspace(currentWorkspaceId ?? undefined);
  const { data, isLoading } = useArchivedPages(currentWorkspaceId);
  const updatePage = useUpdatePage();
  const deletePage = useDeletePage();
  const emptyTrash = useEmptyTrash();

  const pages = React.useMemo(() => {
    const list = data?.pages ?? [];
    return [...list].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [data?.pages]);

  const isOwner = workspace?.ownerId === user?.id;

  const handleRestore = React.useCallback(
    (page: Page) => {
      updatePage.mutate(
        { id: page.id, archived: false },
        {
          onSuccess: () => toast.success(t('pages.toasts.restored')),
          onError: (err) => toast.error(apiErrorMessage(err, t('pages.toasts.restoreFailed'))),
        },
      );
    },
    [updatePage, t],
  );

  const handleHardDelete = React.useCallback(
    async (target: Page) => {
      if (!currentWorkspaceId) return;
      const confirmed = await confirm({
        title: t('trash.deleteDialog.title'),
        description: t('trash.deleteDialog.description', {
          title: target.title || t('pages.untitled'),
        }),
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      });
      if (!confirmed) return;
      deletePage.mutate(
        { id: target.id, workspaceId: currentWorkspaceId, hard: true },
        {
          onSuccess: () => {
            toast.success(t('pages.toasts.deletedPermanently'));
          },
          onError: (err) => {
            toast.error(apiErrorMessage(err, t('pages.toasts.deleteFailed')));
          },
        },
      );
    },
    [currentWorkspaceId, deletePage, t],
  );

  const handleEmptyTrash = React.useCallback(async () => {
    if (!currentWorkspaceId) return;
    const confirmed = await confirm({
      title: t('trash.emptyDialog.title'),
      description: t('trash.emptyDialog.description', { count: pages.length }),
      confirmLabel: t('trash.emptyTrash'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!confirmed) return;
    emptyTrash.mutate(
      { workspaceId: currentWorkspaceId },
      {
        onSuccess: (result) => {
          toast.success(t('trash.removed', { count: result.deleted }));
        },
        onError: (err) => {
          toast.error(apiErrorMessage(err, t('trash.emptyFailed')));
        },
      },
    );
  }, [emptyTrash, currentWorkspaceId, pages.length, t]);

  if (!currentWorkspaceId) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <EmptyState description={t('trash.selectWorkspace')} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <PageHeader
        presentation="bar"
        border="always"
        // The app layout already pads this route below the status bar.
        safeArea={false}
        title={t('trash.title')}
        subtitle={t('trash.subtitle')}
        actions={
          isOwner ? (
            <Button
              appearance="outline"
              size="sm"
              onPress={handleEmptyTrash}
              disabled={emptyTrash.isPending || pages.length === 0}
              loading={emptyTrash.isPending}
              leadingIcon={RiDeleteBin6Line}
            >
              {t('trash.emptyTrash')}
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
        </View>
      ) : pages.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            // icon: Trash2
            description={t('trash.empty')}
          />
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4 py-3 md:px-8">
          {pages.map((page) => (
            <TrashRow
              key={page.id}
              page={page}
              onRestore={() => handleRestore(page)}
              onHardDelete={() => void handleHardDelete(page)}
              canHardDelete={isOwner || page.ownerId === user?.id}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

interface TrashRowProps {
  page: Page;
  onRestore: () => void;
  onHardDelete: () => void;
  canHardDelete: boolean;
}
function TrashRow({ page, onRestore, onHardDelete, canHardDelete }: TrashRowProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const title = page.title.trim() || t('pages.untitled');

  return (
    <View className="mb-2 rounded-md border border-border/40">
      <Item
        density="compact"
        onPress={() => router.push(`/p/${page.id}`)}
        accessibilityLabel={t('pages.openPage', { title })}
        leading={<IconDisplay value={page.icon} size={20} showPlaceholder pageId={page.id} />}
        title={title}
        subtitle={t('trash.archivedAt', { date: formatTime(page.updatedAt) })}
        trailing={
          <View className="flex-row items-center gap-2">
            <Button
              appearance="outline"
              size="sm"
              stopPropagation
              onPress={onRestore}
              accessibilityLabel={t('trash.restorePage')}
              leadingIcon={RiArrowGoBackLine}
            >
              {t('trash.restore')}
            </Button>
            {canHardDelete ? (
              <Button
                appearance="outline"
                tone="danger"
                size="sm"
                stopPropagation
                onPress={onHardDelete}
                accessibilityLabel={t('trash.deletePagePermanently')}
                leadingIcon={RiDeleteBin6Line}
              >
                {t('common.delete')}
              </Button>
            ) : null}
          </View>
        }
      />
    </View>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
