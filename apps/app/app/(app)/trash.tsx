import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useOxy } from '@oxy.so/services';
import { RotateCcw, Trash2 } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { toast } from '@oxy.so/bloom/toast';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
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
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const { user } = useOxy();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: workspace } = useWorkspace(currentWorkspaceId ?? undefined);
  const { data, isLoading } = useArchivedPages(currentWorkspaceId);
  const updatePage = useUpdatePage();
  const deletePage = useDeletePage();
  const emptyTrash = useEmptyTrash();

  const [emptyOpen, setEmptyOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<Page | null>(null);

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
          onError: (err) => toast.error(err.message || t('pages.toasts.restoreFailed')),
        },
      );
    },
    [updatePage, t],
  );

  const handleHardDelete = React.useCallback(() => {
    if (!deleteTarget || !currentWorkspaceId) return;
    const target = deleteTarget;
    deletePage.mutate(
      { id: target.id, workspaceId: currentWorkspaceId, hard: true },
      {
        onSuccess: () => {
          toast.success(t('pages.toasts.deletedPermanently'));
        },
        onError: (err) => {
          toast.error(err.message || t('pages.toasts.deleteFailed'));
        },
      },
    );
    setDeleteTarget(null);
  }, [deleteTarget, currentWorkspaceId, deletePage, t]);

  const handleEmptyTrash = React.useCallback(() => {
    if (!currentWorkspaceId) return;
    emptyTrash.mutate(
      { workspaceId: currentWorkspaceId },
      {
        onSuccess: (result) => {
          toast.success(t('trash.removed', { count: result.deleted }));
        },
        onError: (err) => {
          toast.error(err.message || t('trash.emptyFailed'));
        },
      },
    );
  }, [emptyTrash, currentWorkspaceId, t]);

  if (!currentWorkspaceId) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="text-base text-muted-foreground">{t('trash.selectWorkspace')}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <View className="flex-row items-center justify-between border-b border-border/30 px-4 py-3 md:px-8">
        <View>
          <Text className="text-lg font-semibold text-foreground">{t('trash.title')}</Text>
          <Text className="text-xs text-muted-foreground">{t('trash.subtitle')}</Text>
        </View>
        {isOwner ? (
          <Button
            variant="outline"
            size="sm"
            onPress={() => setEmptyOpen(true)}
            disabled={emptyTrash.isPending || pages.length === 0}
            className="h-9"
          >
            <View className="flex-row items-center gap-1.5">
              <Trash2 size={14} color={colors.foreground} />
              <Text className="text-sm font-medium">{t('trash.emptyTrash')}</Text>
            </View>
          </Button>
        ) : null}
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : pages.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-sm text-muted-foreground">{t('trash.empty')}</Text>
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4 py-3 md:px-8">
          {pages.map((page) => (
            <TrashRow
              key={page.id}
              page={page}
              onRestore={() => handleRestore(page)}
              onHardDelete={() => setDeleteTarget(page)}
              canHardDelete={isOwner || page.ownerId === user?.id}
            />
          ))}
        </ScrollView>
      )}

      <ConfirmationDialog
        open={emptyOpen}
        onOpenChange={setEmptyOpen}
        title={t('trash.emptyDialog.title')}
        description={t('trash.emptyDialog.description', { count: pages.length })}
        confirmText={t('trash.emptyTrash')}
        confirmVariant="destructive"
        loading={emptyTrash.isPending}
        onConfirm={handleEmptyTrash}
      />
      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        title={t('trash.deleteDialog.title')}
        description={t('trash.deleteDialog.description', {
          title: deleteTarget?.title || t('pages.untitled'),
        })}
        confirmText={t('common.delete')}
        confirmVariant="destructive"
        loading={deletePage.isPending}
        onConfirm={handleHardDelete}
      />
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
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const title = page.title.trim() || t('pages.untitled');

  return (
    <View className="flex-row items-center gap-3 rounded-md border border-border/40 px-3 py-2 mb-2 hover:bg-muted/40">
      <Pressable
        onPress={() => router.push(`/p/${page.id}`)}
        accessibilityLabel={t('pages.openPage', { title })}
        className="h-8 w-8 items-center justify-center rounded-md"
      >
        <IconDisplay value={page.icon} size={20} showPlaceholder />
      </Pressable>
      <Pressable onPress={() => router.push(`/p/${page.id}`)} className="flex-1 min-w-0">
        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
          {title}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {t('trash.archivedAt', { date: formatTime(page.updatedAt) })}
        </Text>
      </Pressable>
      <Pressable
        onPress={onRestore}
        accessibilityLabel={t('trash.restorePage')}
        className="h-8 flex-row items-center gap-1 rounded-md border border-border px-2 hover:bg-muted"
      >
        <RotateCcw size={14} color={colors.foreground} />
        <Text className="text-xs font-medium text-foreground">{t('trash.restore')}</Text>
      </Pressable>
      {canHardDelete ? (
        <Pressable
          onPress={onHardDelete}
          accessibilityLabel={t('trash.deletePagePermanently')}
          className="h-8 flex-row items-center gap-1 rounded-md border border-border px-2 hover:bg-destructive/10"
        >
          <Trash2 size={14} color={colors.foreground} />
          <Text className="text-xs font-medium text-foreground">{t('common.delete')}</Text>
        </Pressable>
      ) : null}
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
