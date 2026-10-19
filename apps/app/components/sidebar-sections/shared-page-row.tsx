import { IconDisplay } from '@/components/page-chrome/icon-display';
import { MoveToDialog } from '@/components/page-chrome/move-to-dialog';
import { apiErrorMessage } from '@/lib/api/error-message';
import { toast } from '@oxy.so/bloom/toast';
import { useNewPageStore } from '@/lib/stores/new-page-store';
import * as React from 'react';
import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { RiArrowDownSLine } from '@oxy.so/bloom/icons/RiArrowDownSLine';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons/RiArrowRightSLine';
import { RiFileCopyLine } from '@oxy.so/bloom/icons/RiFileCopyLine';
import { RiMoreLine } from '@oxy.so/bloom/icons/RiMoreLine';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiStarLine } from '@oxy.so/bloom/icons/RiStarLine';
import { RiStarOffLine } from '@oxy.so/bloom/icons/RiStarOffLine';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { Button } from '@oxy.so/bloom/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useDeletePage, useDuplicatePage, useUpdatePage } from '@/lib/hooks/use-pages';
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
  /** Whether the row can be dragged (long press on native, HTML5 drag on web). */
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
  /** The drag's state for this row (`page-row[.web].tsx`); null where it cannot be dragged. */
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
  const openNewPage = useNewPageStore((s) => s.open);
  const deletePage = useDeletePage();
  const duplicatePage = useDuplicatePage();
  const updatePage = useUpdatePage();
  const [moveOpen, setMoveOpen] = React.useState(false);

  const title = page.title.trim() ? page.title : t('pages.untitled');
  const indent = depth * INDENT_PX;
  const isFavorite = Boolean(page.favorited);

  const handleOpen = React.useCallback(() => {
    router.push(`/p/${page.id}`);
  }, [router, page.id]);

  const handleAddChild = React.useCallback(() => {
    openNewPage({ workspaceId, parentId: page.id });
  }, [openNewPage, page.id, workspaceId]);

  const handleDelete = React.useCallback(() => {
    deletePage.mutate({ id: page.id, workspaceId });
  }, [deletePage, page.id, workspaceId]);

  const handleDuplicate = React.useCallback(() => {
    duplicatePage.mutate(
      { id: page.id, workspaceId },
      {
        onError: (error) => toast.error(apiErrorMessage(error, t('pages.toasts.duplicateFailed'))),
      },
    );
  }, [duplicatePage, page.id, workspaceId, t]);

  const handleToggleFavorite = React.useCallback(() => {
    // Optimistic toggle. The Page chrome agent owns the canonical UI in the
    // page header; we keep this entrypoint for parity with Notion behavior.
    updatePage.mutate({ id: page.id, favorited: !isFavorite });
  }, [updatePage, page.id, isFavorite]);

  const containerClass = isActive
    ? 'flex-row items-center bg-muted'
    : 'flex-row items-center hover:bg-muted/60 active:bg-muted/60';

  return (
    <View>
      <MoveToDialog open={moveOpen} onOpenChange={setMoveOpen} page={page} />
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
        {hasChildren ? (
          <Button
            appearance="plain"
            size="xs"
            iconOnly
            stopPropagation
            onPress={onToggle}
            pressed={isOpen}
            accessibilityLabel={isOpen ? t('pages.collapse') : t('pages.expand')}
            renderLeadingIcon={({ size, color }) =>
              isOpen ? (
                <RiArrowDownSLine width={size} height={size} fill={color} />
              ) : (
                <RiArrowRightSLine width={size} height={size} fill={color} />
              )
            }
          />
        ) : (
          <View className="h-5 w-5" />
        )}
        <View className="h-5 w-5 items-center justify-center">
          <IconDisplay value={page.icon} size={15} showPlaceholder pageId={page.id} />
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
          <View className="flex-row items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  appearance="plain"
                  size="xs"
                  iconOnly
                  stopPropagation
                  accessibilityLabel={t('pages.actions.actionsFor', { title })}
                  leadingIcon={RiMoreLine}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onPress={handleToggleFavorite}
                  leading={
                    isFavorite ? (
                      <RiStarOffLine size="sm" fill={colors.mutedForeground} />
                    ) : (
                      <RiStarLine size="sm" fill={colors.mutedForeground} />
                    )
                  }
                >
                  {isFavorite
                    ? t('pages.actions.removeFromFavorites')
                    : t('pages.actions.addToFavorites')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onPress={handleDuplicate}
                  leading={<RiFileCopyLine size="sm" fill={colors.mutedForeground} />}
                >
                  {t('pages.actions.duplicate')}
                </DropdownMenuItem>
                <DropdownMenuItem onPress={() => setMoveOpen(true)}>
                  {t('pages.actions.moveTo')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onPress={handleDelete}
                  leading={<RiDeleteBin6Line size="sm" fill={colors.mutedForeground} />}
                >
                  {t('pages.actions.moveToTrash')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              appearance="plain"
              size="xs"
              iconOnly
              stopPropagation
              onPress={handleAddChild}
              accessibilityLabel={t('pages.actions.addSubPageTo', { title })}
              leadingIcon={RiAddLine}
            />
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
