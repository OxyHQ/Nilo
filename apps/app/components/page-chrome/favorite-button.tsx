import * as React from 'react';
import { RiStarLine } from '@oxy.so/bloom/icons/RiStarLine';
import { Button } from '@oxy.so/bloom/button';
import { useTheme } from '@oxy.so/bloom/theme';
import { useTranslation } from '@/hooks/useTranslation';
import { useUpdatePage } from '@/lib/hooks/use-pages';

interface FavoriteButtonProps {
  pageId: string;
  favorited: boolean;
}

/**
 * Star icon that toggles `Page.favorited`, the reader's own favorite (anyone
 * who can open the page can star it). Fills when active. Reads its own
 * UI state from the prop so it can be driven by either the page detail or
 * the actions menu (single source of truth: the page itself).
 */
export function FavoriteButton({ pageId, favorited }: FavoriteButtonProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const updatePage = useUpdatePage();

  const handleToggle = React.useCallback(() => {
    updatePage.mutate({ id: pageId, favorited: !favorited });
  }, [updatePage, pageId, favorited]);

  return (
    <Button
      appearance="subtle"
      tone="neutral"
      iconOnly
      onPress={handleToggle}
      accessibilityLabel={favorited ? t('pages.favorite.remove') : t('pages.favorite.add')}
      leadingIcon={RiStarLine}
    />
  );
}
