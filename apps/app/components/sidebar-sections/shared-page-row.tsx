import * as React from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronDown, ChevronRight, FileText, MoreHorizontal, Plus } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
import {
  useCreatePage,
  useDeletePage,
  useDuplicatePage,
  useUpdatePage,
} from '@/lib/hooks/use-pages';
import type { Page } from '@/lib/types/pages';
import type { DropPosition } from './drag-context';

export const ROW_HEIGHT = 28;
export const INDENT_PX = 14;

export interface PageRowSharedProps {
  page: Page;
  depth: number;
  hasChildren: boolean;
  isOpen: boolean;
  onToggle: () => void;
  isActive: boolean;
  workspaceId: string;
  /** Native sidebar passes false to disable drag affordance on small screens. */
  enableDrag?: boolean;
  readOnly?: boolean;
  /** Notifies parent of a drop. */
  onDrop?: (sourceId: string, position: DropPosition) => void;
}

export interface PlatformDragProps {
  draggable?: boolean;
  isDragging?: boolean;
  dropIndicator?: DropPosition | null;
  /**
   * DOM id assigned to the row's underlying element on web (no-op on native).
   * Used by the web wrapper to attach drag listeners without binding refs
   * across the View/HTMLElement type boundary.
   */
  domId?: string;
}

interface SharedRowProps extends PageRowSharedProps {
  /** Web build supplies handlers and indicators; native passes null. */
  platformDrag: PlatformDragProps | null;
}

/**
 * Cross-platform inner page row shared by web and native variants. Renders
 * chevron + icon + title + on-hover (+ / ⋯) actions and a three-dot menu.
 * Platform-specific drag wiring is layered on by the wrapping `SidebarPageRow`
 * resolved per-platform from `./page-row[.web].tsx`.
 */
export function SharedPageRow({
  page,
  depth,
  hasChildren,
  isOpen,
  onToggle,
  isActive,
  workspaceId,
  platformDrag,
  readOnly = false,
}: SharedRowProps) {
  const router = useRouter();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const createPage = useCreatePage();
  const deletePage = useDeletePage();
  const duplicatePage = useDuplicatePage();
  const updatePage = useUpdatePage();

  const title = page.title.trim() ? page.title : t('pages.untitled');
  const indent = depth * INDENT_PX;
  const isFavorite = Boolean(page.favorited);

  const handleOpen = React.useCallback(() => {
    router.push(`/p/${page.id}`);
  }, [router, page.id]);

  const handleAddChild = React.useCallback(async () => {
    try {
      const child = await createPage.mutateAsync({
        workspaceId,
        parentId: page.id,
        title: '',
      });
      router.push(`/p/${child.id}`);
    } catch {
      /* mutation surfaces errors via state */
    }
  }, [createPage, page.id, router, workspaceId]);

  const handleDelete = React.useCallback(() => {
    deletePage.mutate({ id: page.id, workspaceId });
  }, [deletePage, page.id, workspaceId]);

  const handleDuplicate = React.useCallback(() => {
    duplicatePage.mutate({ id: page.id, workspaceId });
  }, [duplicatePage, page.id, workspaceId]);

  const handleToggleFavorite = React.useCallback(() => {
    // Optimistic toggle. The Page chrome agent owns the canonical UI in the
    // page header; we keep this entrypoint for parity with Notion behavior.
    updatePage.mutate({ id: page.id, favorited: !isFavorite });
  }, [updatePage, page.id, isFavorite]);

  const handleMoveToRoot = React.useCallback(() => {
    if (!page.parentId) return;
    updatePage.mutate({ id: page.id, parentId: null });
  }, [updatePage, page.id, page.parentId]);

  const containerClass = isActive
    ? 'flex-row items-center bg-muted'
    : 'flex-row items-center hover:bg-muted/60 active:bg-muted/60';

  return (
    <View>
      {platformDrag?.dropIndicator === 'before' ? <DropLine /> : null}
      <Pressable
        id={platformDrag?.domId}
        accessibilityRole="link"
        onPress={handleOpen}
        accessibilityLabel={t('pages.openPage', { title })}
        className={`group/row ${containerClass} ${platformDrag?.isDragging ? 'opacity-40' : ''}`}
        style={{
          paddingLeft: 8 + indent,
          paddingRight: 4,
          height: ROW_HEIGHT,
        }}
      >
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggle();
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: isOpen }}
          accessibilityLabel={isOpen ? t('pages.collapse') : t('pages.expand')}
          className="h-5 w-5 items-center justify-center rounded"
          disabled={!hasChildren}
        >
          {hasChildren ? (
            isOpen ? (
              <ChevronDown size={12} color={colors.mutedForeground} />
            ) : (
              <ChevronRight size={12} color={colors.mutedForeground} />
            )
          ) : null}
        </Pressable>
        <View className="h-5 w-5 items-center justify-center">
          {page.icon ? (
            <Text className="text-sm leading-5">{page.icon}</Text>
          ) : (
            <FileText size={13} color={colors.mutedForeground} />
          )}
        </View>
        <Text
          className={
            isActive
              ? 'ml-1 flex-1 truncate text-sm font-medium text-foreground'
              : 'ml-1 flex-1 truncate text-sm text-foreground'
          }
          numberOfLines={1}
        >
          {title}
        </Text>

        {/* Hover actions: three-dot menu + add child */}
        {!readOnly ? (
          <View className="flex-row items-center opacity-0 group-hover/row:opacity-100">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <Pressable
                  onPress={(e) => e.stopPropagation()}
                  accessibilityLabel={t('pages.actions.actionsFor', { title })}
                  className="h-5 w-5 items-center justify-center rounded hover:bg-muted"
                >
                  <MoreHorizontal size={14} color={colors.mutedForeground} />
                </Pressable>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                <DropdownMenu.Item key="favorite" onSelect={handleToggleFavorite}>
                  <DropdownMenu.ItemIcon ios={{ name: isFavorite ? 'star.slash' : 'star' }} />
                  <DropdownMenu.ItemTitle>
                    {isFavorite
                      ? t('pages.actions.removeFromFavorites')
                      : t('pages.actions.addToFavorites')}
                  </DropdownMenu.ItemTitle>
                </DropdownMenu.Item>
                <DropdownMenu.Item key="duplicate" onSelect={handleDuplicate}>
                  <DropdownMenu.ItemIcon ios={{ name: 'doc.on.doc' }} />
                  <DropdownMenu.ItemTitle>{t('pages.actions.duplicate')}</DropdownMenu.ItemTitle>
                </DropdownMenu.Item>
                {page.parentId ? (
                  <DropdownMenu.Item key="move-root" onSelect={handleMoveToRoot}>
                    <DropdownMenu.ItemIcon ios={{ name: 'arrow.up.left' }} />
                    <DropdownMenu.ItemTitle>{t('pages.actions.moveToTop')}</DropdownMenu.ItemTitle>
                  </DropdownMenu.Item>
                ) : null}
                <DropdownMenu.Separator />
                <DropdownMenu.Item key="delete" destructive onSelect={handleDelete}>
                  <DropdownMenu.ItemIcon ios={{ name: 'trash' }} />
                  <DropdownMenu.ItemTitle>{t('pages.actions.moveToTrash')}</DropdownMenu.ItemTitle>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                handleAddChild();
              }}
              accessibilityLabel={t('pages.actions.addSubPageTo', { title })}
              disabled={createPage.isPending}
              className="h-5 w-5 items-center justify-center rounded hover:bg-muted"
            >
              {createPage.isPending ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : (
                <Plus size={14} color={colors.mutedForeground} />
              )}
            </Pressable>
          </View>
        ) : null}
      </Pressable>
      {platformDrag?.dropIndicator === 'inside' ? <DropInside /> : null}
      {platformDrag?.dropIndicator === 'after' ? <DropLine /> : null}
    </View>
  );
}

function DropLine() {
  return <View className="mx-2 h-0.5 rounded bg-primary" />;
}

function DropInside() {
  return <View className="mx-2 -mt-1 h-0.5 rounded bg-primary/40" />;
}
