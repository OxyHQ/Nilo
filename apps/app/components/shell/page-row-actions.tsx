import * as React from 'react';
import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { RiFileCopyLine } from '@oxy.so/bloom/icons/RiFileCopyLine';
import { RiMoreLine } from '@oxy.so/bloom/icons/RiMoreLine';
import { RiStarLine } from '@oxy.so/bloom/icons/RiStarLine';
import { RiStarOffLine } from '@oxy.so/bloom/icons/RiStarOffLine';
import { toast } from '@oxy.so/bloom/toast';
import { MoveToDialog } from '@/components/page-chrome/move-to-dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { apiErrorMessage } from '@/lib/api/error-message';
import { useDeletePage, useDuplicatePage, useUpdatePage } from '@/lib/hooks/use-pages';
import { useNewPageStore } from '@/lib/stores/new-page-store';
import type { Page } from '@/lib/types/pages';
import { useColorScheme } from '@/lib/useColorScheme';

/**
 * A sidebar page row's own buttons, beside its press target: the page menu
 * (favourite, duplicate, move, trash) and "add a page inside". Bloom shows
 * them while the row is hovered or focused on a pointer device, always on touch.
 */
export const PageRowActions = React.memo(function PageRowActions({
  page,
  workspaceId,
}: {
  page: Page;
  workspaceId: string;
}) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const openNewPage = useNewPageStore((s) => s.open);
  const deletePage = useDeletePage();
  const duplicatePage = useDuplicatePage();
  const updatePage = useUpdatePage();
  const [moveOpen, setMoveOpen] = React.useState(false);
  const title = page.title.trim() || t('pages.untitled');
  const isFavorite = Boolean(page.favorited);

  return (
    <View className="flex-row items-center">
      <MoveToDialog open={moveOpen} onOpenChange={setMoveOpen} page={page} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            appearance="plain"
            size="xs"
            iconOnly
            accessibilityLabel={t('pages.actions.actionsFor', { title })}
            leadingIcon={RiMoreLine}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onPress={() => updatePage.mutate({ id: page.id, favorited: !isFavorite })}
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
            onPress={() =>
              duplicatePage.mutate(
                { id: page.id, workspaceId },
                {
                  onError: (error) =>
                    toast.error(apiErrorMessage(error, t('pages.toasts.duplicateFailed'))),
                },
              )
            }
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
            onPress={() => deletePage.mutate({ id: page.id, workspaceId })}
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
        onPress={() => openNewPage({ workspaceId, parentId: page.id })}
        accessibilityLabel={t('pages.actions.addSubPageTo', { title })}
        leadingIcon={RiAddLine}
      />
    </View>
  );
});
