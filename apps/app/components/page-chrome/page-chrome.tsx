import { PAGE_FONT_FAMILIES } from '@/lib/fonts';
import { cn } from '@/lib/utils';
import { toast } from '@oxy.so/bloom/toast';
import { PageInfo } from './page-info';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { RiGlobalLine } from '@oxy.so/bloom/icons/RiGlobalLine';
import { RiImageLine } from '@oxy.so/bloom/icons/RiImageLine';
import { RiLockLine } from '@oxy.so/bloom/icons/RiLockLine';
import { RiEmotionHappyLine } from '@oxy.so/bloom/icons/RiEmotionHappyLine';
import { Badge } from '@oxy.so/bloom/badge';
import { Button } from '@oxy.so/bloom/button';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import { Text } from '@oxy.so/bloom/typography';
import { PageHeader as ScreenHeader, PageHeaderTitleInput } from '@oxy.so/bloom/page-header';
import { Screen, type ScreenProps } from '@oxy.so/bloom/screen';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useUpdatePage } from '@/lib/hooks/use-pages';
import type { Page } from '@/lib/types/pages';
import { Breadcrumb } from './breadcrumb';
import { CoverHeader } from '@oxy.so/bloom/cover-header';
import { useCoverMedia } from './use-cover-media';
import { CoverPicker } from './cover-picker';
import { FavoriteButton } from './favorite-button';
import { IconDisplay } from './icon-display';
import { IconPicker } from './icon-picker';
import { useRouter } from 'expo-router';
import { usePageEditorContext } from '@/components/page-editor/page-editor-context';
import { PageActionsMenu } from './page-actions-menu';

interface PageChromeProps {
  page: Page;
  /** Below editor: the page's settings are not this member's to change. */
  readOnly?: boolean;
  /** Editor (or any body content) rendered below the page header. */
  children?: React.ReactNode;
  /** Right-side header content (ShareButton lives here in the page route). */
  rightHeader?: React.ReactNode;
  bottomBar?: React.ReactNode;
  scroll?: ScreenProps['scroll'];
}

interface PageChromeState {
  openIconPicker: () => void;
  openCoverPicker: () => void;
}
const StateContext = React.createContext<PageChromeState | null>(null);

/**
 * Domain actions and pickers composed into Bloom's Screen and PageHeader.
 * Screen owns chrome, scrolling and the editor toolbar's keyboard behavior.
 */
export function PageChrome({
  page,
  children,
  rightHeader,
  bottomBar,
  scroll = 'auto',
  readOnly = false,
}: PageChromeProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const updatePage = useUpdatePage();
  const iconPicker = useDialogControl();
  const coverPicker = useDialogControl();
  // A locked page, or one in the trash, keeps its icon and cover as they are.
  const { readOnly: contentReadOnly } = usePageEditorContext();

  const handleIconSelect = React.useCallback(
    (next: string | null) => {
      if (contentReadOnly) return;
      updatePage.mutate({ id: page.id, icon: next });
    },
    [page.id, contentReadOnly, updatePage],
  );
  const handleCoverSelect = React.useCallback(
    (next: string | null) => {
      if (contentReadOnly) return;
      updatePage.mutate({ id: page.id, cover: next, coverPosition: 50 });
    },
    [page.id, contentReadOnly, updatePage],
  );

  const stateValue = React.useMemo<PageChromeState>(
    () => ({
      openIconPicker: () => iconPicker.open(),
      openCoverPicker: () => coverPicker.open(),
    }),
    [iconPicker, coverPicker],
  );

  return (
    <StateContext.Provider value={stateValue}>
      <Screen
        scroll={scroll}
        contentClearance={48}
        bottomBar={bottomBar}
        bottomBarKeyboardBehavior="follow"
        header={
          <ScreenHeader
            presentation="bar"
            safeArea={false}
            title={<Breadcrumb pageId={page.id} workspaceId={page.workspaceId} />}
            actions={
              <>
                {!page.archived ? (
                  <FavoriteButton pageId={page.id} favorited={page.favorited ?? false} />
                ) : null}
                {page.publishedAt ? (
                  <View
                    accessible
                    accessibilityLabel={t('pages.publish.published')}
                    className="px-1"
                  >
                    <RiGlobalLine width={14} height={14} fill={colors.mutedForeground} />
                  </View>
                ) : null}
                {rightHeader}
                <PageActionsMenu page={page} readOnly={readOnly} />
              </>
            }
          />
        }
      >
        {children}
      </Screen>
      {!contentReadOnly ? (
        <>
          <IconPicker control={iconPicker} pageId={page.id} onSelect={handleIconSelect} />
          <CoverPicker control={coverPicker} pageId={page.id} onSelect={handleCoverSelect} />
        </>
      ) : null}
    </StateContext.Provider>
  );
}

/**
 * `PageHeader` — cover + icon + title. Designed to live INSIDE the route's
 * ScrollView so it scrolls with the page content. Reads picker state from
 * the surrounding `<PageChrome>` via context. `readOnly` is `PageChrome`'s:
 * the page's settings (its lock) are not this member's to change.
 */
export function PageHeader({ page, readOnly = false }: { page: Page; readOnly?: boolean }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const state = React.useContext(StateContext);
  const media = useCoverMedia(page.cover, page.id);
  const updatePage = useUpdatePage();
  const [titleDraft, setTitleDraft] = React.useState<string | null>(null);

  const { readOnly: contentReadOnly } = usePageEditorContext();
  const title = titleDraft ?? page.title;
  const titleStyle = {
    fontFamily: PAGE_FONT_FAMILIES[page.font ?? 'default'],
    fontSize: page.smallText ? 31.5 : 36,
    lineHeight: page.smallText ? 35 : 40,
  };
  React.useEffect(() => {
    if (contentReadOnly) setTitleDraft(null);
  }, [contentReadOnly]);

  const handleTitleBlur = React.useCallback(() => {
    if (contentReadOnly || titleDraft === null) return;
    if (titleDraft === page.title) {
      setTitleDraft(null);
      return;
    }
    updatePage.mutate({ id: page.id, title: titleDraft });
    setTitleDraft(null);
  }, [contentReadOnly, titleDraft, page.title, page.id, updatePage]);

  const handleCommitReposition = React.useCallback(
    async (nextPosition: number) => {
      if (contentReadOnly) return;
      const clamped = Math.min(100, Math.max(0, Math.round(nextPosition)));
      if (clamped === (page.coverPosition ?? 50)) return;
      await updatePage.mutateAsync({ id: page.id, coverPosition: clamped });
    },
    [contentReadOnly, page.id, page.coverPosition, updatePage],
  );

  return (
    <CoverHeader
      key={page.id}
      coverSource={media.coverSource}
      cover={media.cover}
      coverPosition={{ x: 0.5, y: (page.coverPosition ?? 50) / 100 }}
      coverHeight={media.hasCover ? 280 : 0}
      overlap={media.hasCover && page.icon ? 32 : 0}
      repositionable={!contentReadOnly}
      repositionAxes="vertical"
      onCoverPositionCommit={({ y }) => handleCommitReposition(y * 100)}
      onChangeCover={
        !contentReadOnly && media.hasCover ? () => state?.openCoverPicker() : undefined
      }
      testID="page-cover"
    >
      <View
        className={cn('px-6 md:px-10 w-full mx-auto', !page.fullWidth && 'max-w-3xl')}
        style={{ paddingTop: media.hasCover && page.icon ? 0 : 24 }}
      >
        {contentReadOnly ? (
          page.icon ? (
            <IconDisplay value={page.icon} size={64} pageId={page.id} />
          ) : null
        ) : (
          <IconArea
            pageId={page.id}
            icon={page.icon ?? null}
            onOpenPicker={() => state?.openIconPicker()}
          />
        )}
        {!contentReadOnly ? (
          <AddChromeRow
            hasIcon={Boolean(page.icon)}
            hasCover={Boolean(page.cover)}
            onAddIcon={() => state?.openIconPicker()}
            onAddCover={() => state?.openCoverPicker()}
          />
        ) : null}
        {page.template && !page.databaseId ? (
          <View className="mb-2 self-start">
            <Badge appearance="subtle" tone="neutral" content={t('pages.templates.badge')} />
          </View>
        ) : null}
        {page.template && page.databaseId ? (
          <View className="mb-3 flex-row items-center justify-between gap-2 rounded-md bg-muted px-3 py-2">
            <Text className="text-sm font-medium text-muted-foreground">
              {t('pages.templates.badge')}
            </Text>
            {!contentReadOnly ? (
              <Button
                appearance="subtle"
                tone="neutral"
                accessibilityLabel={t('databases.templates.done')}
                onPress={() => {
                  if (page.databaseId)
                    router.push({ pathname: '/db/[id]', params: { id: page.databaseId } });
                }}
              >
                {t('databases.templates.done')}
              </Button>
            ) : null}
          </View>
        ) : null}
        {contentReadOnly ? (
          <Text
            accessibilityRole="header"
            className="text-base font-bold text-foreground"
            style={titleStyle}
          >
            {page.title || t('pages.untitled')}
          </Text>
        ) : (
          <TitleInput
            value={title}
            onChangeText={setTitleDraft}
            onBlur={handleTitleBlur}
            style={titleStyle}
          />
        )}
        {page.locked ? (
          <View className="mt-3 flex-row items-center gap-2 rounded-lg bg-muted px-3 py-2">
            <RiLockLine width={14} height={14} fill={colors.mutedForeground} />
            <Text className="flex-1 text-sm text-muted-foreground" accessibilityLiveRegion="polite">
              {t('pages.lock.banner')}
            </Text>
            {!readOnly && !page.archived ? (
              <Button
                appearance="subtle"
                tone="neutral"
                size="sm"
                disabled={updatePage.isPending}
                accessibilityLabel={t('pages.lock.unlock')}
                onPress={() =>
                  updatePage.mutate(
                    { id: page.id, locked: false },
                    {
                      onError: () => toast.error(t('pages.style.updateFailed')),
                    },
                  )
                }
              >
                {t('pages.lock.unlock')}
              </Button>
            ) : null}
          </View>
        ) : null}
        <PageInfo page={page} />
      </View>
    </CoverHeader>
  );
}

/* ---------------------------------------------------------------- *
 * Icon area
 * ---------------------------------------------------------------- */

interface IconAreaProps {
  pageId: string;
  icon: string | null;
  onOpenPicker: () => void;
}
function IconArea({ pageId, icon, onOpenPicker }: IconAreaProps) {
  const { t } = useTranslation();
  if (!icon) return null;
  return (
    <Pressable
      onPress={onOpenPicker}
      className="self-start rounded-md p-1 hover:bg-muted"
      accessibilityLabel={t('pages.header.changeIcon')}
    >
      <IconDisplay value={icon} size={64} pageId={pageId} />
    </Pressable>
  );
}

/* ---------------------------------------------------------------- *
 * Add-chrome row
 * ---------------------------------------------------------------- */

interface AddChromeRowProps {
  hasIcon: boolean;
  hasCover: boolean;
  onAddIcon: () => void;
  onAddCover: () => void;
}
function AddChromeRow({ hasIcon, hasCover, onAddIcon, onAddCover }: AddChromeRowProps) {
  const { t } = useTranslation();
  if (hasIcon && hasCover) return null;
  return (
    <View className="flex-row gap-2 pb-3">
      {!hasIcon ? (
        <AddChromeButton icon="emoji" onPress={onAddIcon} label={t('pages.header.addIcon')} />
      ) : null}
      {!hasCover ? (
        <AddChromeButton icon="cover" onPress={onAddCover} label={t('pages.header.addCover')} />
      ) : null}
    </View>
  );
}

interface AddChromeButtonProps {
  icon: 'emoji' | 'cover';
  label: string;
  onPress: () => void;
}
function AddChromeButton({ icon, label, onPress }: AddChromeButtonProps) {
  return (
    <Button
      appearance="plain"
      tone="neutral"
      size="xs"
      onPress={onPress}
      accessibilityLabel={label}
      renderLeadingIcon={({ size, color }) =>
        icon === 'emoji' ? (
          <RiEmotionHappyLine width={size} height={size} fill={color} />
        ) : (
          <RiImageLine width={size} height={size} fill={color} />
        )
      }
    >
      {label}
    </Button>
  );
}

/* ---------------------------------------------------------------- *
 * Title input
 * ---------------------------------------------------------------- */

interface TitleInputProps {
  value: string;
  onChangeText: (next: string) => void;
  onBlur: () => void;
  style: { fontFamily: string; fontSize: number; lineHeight: number };
}
function TitleInput({ value, onChangeText, onBlur, style }: TitleInputProps) {
  const { t } = useTranslation();
  return (
    <PageHeaderTitleInput
      value={value}
      onChangeText={onChangeText}
      onBlur={onBlur}
      label={t('pages.title')}
      placeholder={t('pages.untitled')}
      multiline
      scrollEnabled={false}
      style={style}
    />
  );
}
