import { PAGE_FONT_FAMILIES } from '@/lib/fonts';
import { cn } from '@/lib/utils';
import { toast } from '@oxy.so/bloom/toast';
import { PageInfo } from './page-info';
import * as React from 'react';
import { Platform, Pressable, TextInput, View, type GestureResponderEvent } from 'react-native';
import { RiGlobalLine } from '@oxy.so/bloom/icons/RiGlobalLine';
import { RiImageLine } from '@oxy.so/bloom/icons/RiImageLine';
import { RiLockLine } from '@oxy.so/bloom/icons/RiLockLine';
import { RiDragMove2Line } from '@oxy.so/bloom/icons/RiDragMove2Line';
import { RiEmotionHappyLine } from '@oxy.so/bloom/icons/RiEmotionHappyLine';
import { Badge } from '@oxy.so/bloom/badge';
import { Button } from '@oxy.so/bloom/button';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useUpdatePage } from '@/lib/hooks/use-pages';
import type { Page } from '@/lib/types/pages';
import { Breadcrumb } from './breadcrumb';
import { CoverDisplay } from './cover-display';
import { CoverPicker } from './cover-picker';
import { FavoriteButton } from './favorite-button';
import { IconDisplay } from './icon-display';
import { IconPicker } from './icon-picker';
import { useRouter } from 'expo-router';
import { PageActionsMenu } from './page-actions-menu';

interface PageChromeProps {
  page: Page;
  readOnly?: boolean;
  /** Editor (or any body content) rendered below the page header. */
  children?: React.ReactNode;
  /** Right-side header content (ShareButton lives here in the page route). */
  rightHeader?: React.ReactNode;
}

interface PageChromeState {
  openIconPicker: () => void;
  openCoverPicker: () => void;
  setRepositioning: (next: boolean | ((prev: boolean) => boolean)) => void;
}
const StateContext = React.createContext<PageChromeState | null>(null);

/**
 * Page-level chrome.
 *
 * Layers:
 *   1. Sticky top bar — breadcrumb + favorite + actions.
 *   2. Children — the page route renders its own ScrollView containing the
 *      `PageHeader` component (cover + icon + title) and the editor. That
 *      keeps the cover/title scrolling with the content, while the top bar
 *      stays pinned.
 *
 * The icon and cover pickers are mounted here as portals — the children
 * can open them via `usePageChrome()`.
 */
export function PageChrome({ page, children, rightHeader, readOnly = false }: PageChromeProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const updatePage = useUpdatePage();
  const iconPicker = useDialogControl();
  const coverPicker = useDialogControl();
  const [repositioning, setRepositioning] = React.useState(false);
  // A locked page, or one in the trash, keeps its icon and cover as they are.
  const frozen = page.locked || page.archived === true;

  const handleIconSelect = React.useCallback(
    (next: string | null) => {
      if (readOnly || frozen) return;
      updatePage.mutate({ id: page.id, icon: next });
    },
    [page.id, frozen, readOnly, updatePage],
  );
  const handleCoverSelect = React.useCallback(
    (next: string | null) => {
      if (readOnly || frozen) return;
      updatePage.mutate({ id: page.id, cover: next, coverPosition: 50 });
    },
    [page.id, frozen, readOnly, updatePage],
  );

  const stateValue = React.useMemo<PageChromeState>(
    () => ({
      openIconPicker: () => iconPicker.open(),
      openCoverPicker: () => coverPicker.open(),
      setRepositioning,
    }),
    [iconPicker, coverPicker],
  );

  return (
    <StateContext.Provider value={stateValue}>
      <View className="flex-1 bg-background">
        {/* Sticky top bar (always visible above the scroll). */}
        <View className="h-12 flex-row items-center justify-between border-b border-border/30 px-4 md:px-6">
          <View className="flex-1 min-w-0">
            <Breadcrumb pageId={page.id} workspaceId={page.workspaceId} />
          </View>
          <View className="flex-row items-center gap-1">
            {!page.archived ? (
              <FavoriteButton pageId={page.id} favorited={page.favorited ?? false} />
            ) : null}
            {page.publishedAt ? (
              <View accessible accessibilityLabel={t('pages.publish.published')} className="px-1">
                <RiGlobalLine width={14} height={14} fill={colors.mutedForeground} />
              </View>
            ) : null}
            {rightHeader}
            <PageActionsMenu page={page} readOnly={readOnly} />
          </View>
        </View>

        <RepositioningContext.Provider value={repositioning}>
          {children}
        </RepositioningContext.Provider>

        {!readOnly && !frozen ? (
          <>
            <IconPicker control={iconPicker} onSelect={handleIconSelect} />
            <CoverPicker control={coverPicker} onSelect={handleCoverSelect} />
          </>
        ) : null}
      </View>
    </StateContext.Provider>
  );
}

const RepositioningContext = React.createContext<boolean>(false);

/**
 * `PageHeader` — cover + icon + title. Designed to live INSIDE the route's
 * ScrollView so it scrolls with the page content. Reads picker state from
 * the surrounding `<PageChrome>` via context.
 */
export function PageHeader({ page, readOnly = false }: { page: Page; readOnly?: boolean }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const state = React.useContext(StateContext);
  const repositioning = React.useContext(RepositioningContext);
  const updatePage = useUpdatePage();
  const [titleDraft, setTitleDraft] = React.useState<string | null>(null);

  const contentReadOnly = readOnly || page.locked;
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
    (nextPosition: number) => {
      if (contentReadOnly) return;
      const clamped = Math.min(100, Math.max(0, Math.round(nextPosition)));
      if (clamped === (page.coverPosition ?? 50)) return;
      updatePage.mutate({ id: page.id, coverPosition: clamped });
    },
    [contentReadOnly, page.id, page.coverPosition, updatePage],
  );

  return (
    <View>
      <View className={cn('px-6 md:px-10 w-full mx-auto', !page.fullWidth && 'max-w-3xl')}>
        {contentReadOnly ? (
          page.cover ? (
            <CoverDisplay value={page.cover} position={page.coverPosition ?? 50} height={192} />
          ) : null
        ) : (
          <CoverArea
            cover={page.cover ?? null}
            position={page.coverPosition ?? 50}
            onOpenPicker={() => state?.openCoverPicker()}
            repositioning={repositioning}
            onToggleReposition={() => state?.setRepositioning((v) => !v)}
            onCommitPosition={handleCommitReposition}
          />
        )}
      </View>
      <View
        className={cn('px-6 md:px-10 w-full mx-auto', !page.fullWidth && 'max-w-3xl')}
        style={{ marginTop: page.cover ? -32 : 24 }}
      >
        {contentReadOnly ? (
          page.icon ? (
            <IconDisplay value={page.icon} size={64} />
          ) : null
        ) : (
          <IconArea icon={page.icon ?? null} onOpenPicker={() => state?.openIconPicker()} />
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
            {!readOnly ? (
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
    </View>
  );
}

/* ---------------------------------------------------------------- *
 * Cover area
 * ---------------------------------------------------------------- */

interface CoverAreaProps {
  cover: string | null;
  position: number;
  onOpenPicker: () => void;
  repositioning: boolean;
  onToggleReposition: () => void;
  onCommitPosition: (next: number) => void;
}
function CoverArea({
  cover,
  position,
  onOpenPicker,
  repositioning,
  onToggleReposition,
  onCommitPosition,
}: CoverAreaProps) {
  const { t } = useTranslation();
  const [localPosition, setLocalPosition] = React.useState<number | null>(null);
  const startY = React.useRef<number | null>(null);
  const startPos = React.useRef<number>(position);

  const effectivePosition = localPosition ?? position;

  const handleStart = React.useCallback(
    (e: GestureResponderEvent) => {
      if (!repositioning) return;
      startY.current = e.nativeEvent.pageY;
      startPos.current = effectivePosition;
    },
    [repositioning, effectivePosition],
  );
  const handleMove = React.useCallback(
    (e: GestureResponderEvent) => {
      if (!repositioning || startY.current === null) return;
      const delta = e.nativeEvent.pageY - startY.current;
      // 200px cover height → roughly 100% range. ~2px per percent.
      const next = startPos.current + delta / 2;
      setLocalPosition(Math.min(100, Math.max(0, next)));
    },
    [repositioning],
  );
  const handleEnd = React.useCallback(() => {
    if (!repositioning) return;
    if (localPosition !== null) onCommitPosition(localPosition);
    setLocalPosition(null);
    startY.current = null;
    onToggleReposition();
  }, [repositioning, localPosition, onCommitPosition, onToggleReposition]);

  if (!cover) return <View className="h-2" />;

  return (
    <View className="relative">
      <View
        onStartShouldSetResponder={() => repositioning}
        onMoveShouldSetResponder={() => repositioning}
        onResponderGrant={handleStart}
        onResponderMove={handleMove}
        onResponderRelease={handleEnd}
        onResponderTerminate={handleEnd}
        accessibilityLabel={t('pages.header.cover')}
      >
        <CoverDisplay value={cover} position={effectivePosition} height={192} />
      </View>
      <View className="absolute right-3 top-3 flex-row gap-2">
        <Button
          appearance={repositioning ? 'solid' : 'subtle'}
          tone={repositioning ? 'accent' : 'neutral'}
          size="sm"
          onPress={onToggleReposition}
          accessibilityLabel={t('pages.header.repositionCover')}
          leadingIcon={RiDragMove2Line}
        >
          {repositioning ? t('pages.header.savePosition') : t('pages.header.reposition')}
        </Button>
        <Button
          appearance="subtle"
          tone="neutral"
          size="sm"
          onPress={onOpenPicker}
          accessibilityLabel={t('pages.header.changeCover')}
          leadingIcon={RiImageLine}
        >
          {t('pages.header.changeCover')}
        </Button>
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- *
 * Icon area
 * ---------------------------------------------------------------- */

interface IconAreaProps {
  icon: string | null;
  onOpenPicker: () => void;
}
function IconArea({ icon, onOpenPicker }: IconAreaProps) {
  const { t } = useTranslation();
  if (!icon) return null;
  return (
    <Pressable
      onPress={onOpenPicker}
      className="self-start rounded-md p-1 hover:bg-muted"
      accessibilityLabel={t('pages.header.changeIcon')}
    >
      <IconDisplay value={icon} size={64} />
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
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      onBlur={onBlur}
      accessibilityLabel={t('pages.title')}
      placeholder={t('pages.untitled')}
      placeholderTextColor={colors.mutedForeground}
      className="text-4xl font-bold text-foreground"
      multiline
      scrollEnabled={false}
      style={[
        style,
        Platform.OS === 'web' ? { outlineWidth: 0, borderWidth: 0, padding: 0 } : undefined,
      ]}
      underlineColorAndroid="transparent"
    />
  );
}
