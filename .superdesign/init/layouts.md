## apps/app/components/page-chrome/page-chrome.tsx
```tsx
import { PAGE_FONT_FAMILIES } from '@/lib/fonts';
import { cn } from '@/lib/utils';
import { toast } from '@oxy.so/bloom/toast';
import { PageInfo } from './page-info';
import { PageVerificationBadge } from './page-verification-badge';
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
import {
  PageHeader as ScreenHeader,
  PageHeaderTitleInput,
  type PageHeaderProps,
} from '@oxy.so/bloom/page-header';
import { Screen, type ScreenProps } from '@oxy.so/bloom/screen';
import { AppShellPanels, type AppShellPanelDefinition } from '@oxy.so/bloom/app-shell';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useUpdatePage } from '@/lib/hooks/use-pages';
import type { Page } from '@/lib/types/pages';
import { Breadcrumb } from './breadcrumb';
import { CoverHeader } from '@oxy.so/bloom/cover-header';
import { useCoverMedia } from './use-cover-media';
import { CoverPicker } from './cover-picker';
import { FavoriteButton } from './favorite-button';
import { CopyPageLinkButton } from '@/components/sharing/copy-page-link-button';
import { IconDisplay } from './icon-display';
import { IconPicker } from './icon-picker';
import { useRouter } from 'expo-router';
import { usePageEditorContext } from '@/components/page-editor/page-editor-context';
import { PageActionsMenu } from './page-actions-menu';
import { PageActivity } from './page-activity';

interface PageChromeProps {
  page: Page;
  /** Below editor: the page's settings are not this member's to change. */
  readOnly?: boolean;
  /** Editor (or any body content) rendered below the page header. */
  children?: React.ReactNode;
  /** Right-side header content (ShareButton lives here in the page route). */
  rightHeader?: PageHeaderProps['actions'];
  bottomBar?: React.ReactNode;
  /** Page discussions and activity share the document header and compositor Surface. */
  panels?: readonly AppShellPanelDefinition[];
  scroll?: ScreenProps['scroll'];
  onOpenActivity?: () => void;
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
  panels,
  scroll = 'auto',
  readOnly = false,
  onOpenActivity,
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

  const header = (
    <ScreenHeader
      presentation="navigation"
      border="none"
      safeArea={false}
      title={
        <Breadcrumb
          currentPage={page}
          onRename={
            !contentReadOnly ? (title) => updatePage.mutateAsync({ id: page.id, title }) : undefined
          }
          onChooseIcon={!contentReadOnly ? () => iconPicker.open() : undefined}
        />
      }
      actions={(state) => (
        <>
          {state.spacious && onOpenActivity ? (
            <PageActivity page={page} onOpen={onOpenActivity} />
          ) : null}
          {page.publishedAt ? (
            <View accessible accessibilityLabel={t('pages.publish.published')} className="px-1">
              <RiGlobalLine width={14} height={14} fill={colors.mutedForeground} />
            </View>
          ) : null}
          {typeof rightHeader === 'function' ? rightHeader(state) : rightHeader}
          {!state.compact ? <CopyPageLinkButton pageId={page.id} /> : null}
          {!state.compact && !page.archived ? (
            <FavoriteButton pageId={page.id} favorited={page.favorited ?? false} />
          ) : null}
          <PageActionsMenu page={page} readOnly={readOnly} onOpenActivity={onOpenActivity} />
        </>
      )}
    />
  );
  const document = (
    <Screen
      scroll={scroll}
      contentClearance={48}
      bottomBar={bottomBar}
      bottomBarKeyboardBehavior="follow"
      header={panels ? undefined : header}
    >
      {children}
    </Screen>
  );

  return (
    <StateContext.Provider value={stateValue}>
      {panels ? (
        <AppShellPanels
          layout={{
            mode: 'split',
            flow: 'bounded',
            appearance: 'joined',
            header,
            activePanel: 'document',
            panels: [{ id: 'document', span: 1, content: document }, ...panels],
          }}
        />
      ) : (
        document
      )}
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
        {page.databaseId ? <PageVerificationBadge page={page} /> : null}
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

```
## apps/app/app/_layout.tsx
```tsx
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo, useRef, useState } from 'react';
import { OxyProvider, useAccountColor, useOxy } from '@oxy.so/services/ui/client';
import { OverlayInertBoundary, PortalOutlet, PortalProvider } from '@oxy.so/bloom/portal';
import { BloomProvider } from '@oxy.so/bloom/provider';
import { BloomScope } from '@oxy.so/bloom/appearance';
import { ImageResolverProvider } from '@oxy.so/bloom/image-resolver';
import { expoRouterScrollAdapter } from '@oxy.so/bloom/scroll/expo-router';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AppErrorBoundary } from '@/components/error-boundary';
import { registerAppWorker } from '@/lib/app-worker';
import { useColorScheme } from '@/lib/useColorScheme';
import { bindApiClient, releaseApiClient } from '@/lib/api/client';
import { enterAccount, sessionEnded } from '@/lib/account-boundary';
import { ACCOUNT_QUERIES, configureShellQueries } from '@/lib/offline-cache';
import { BLOOM_THEME_PERSIST_KEY, BLOOM_THEME_STORAGE } from '@/lib/themePersistence';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/lib/i18n';
import { useI18nStore } from '@/lib/stores/i18n-store';
import 'react-native-reanimated';
import '../global.css';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(app)',
};

SplashScreen.preventAutoHideAsync();

const OXY_API_URL = process.env.EXPO_PUBLIC_OXY_API_URL || 'https://api.oxy.so';
const AUTH_REDIRECT_URI = Linking.createURL('/');

function AuthSetup({ children }: { children: React.ReactNode }) {
  const { oxyServices, user, isAuthResolved } = useOxy();
  const queryClient = useQueryClient();

  // What the device keeps outside the SDK's per-account queries is one
  // account's (lib/account-boundary.ts). Nothing renders until the session is
  // resolved and the device known to be this account's, so the app mounts
  // once, and another's pages never show.
  const userId = user?.id ?? null;
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (!isAuthResolved) return;
    const left = previous.current;
    previous.current = userId;
    if (left && left !== userId) void sessionEnded(left);
    if (!userId) return;
    let live = true;
    void enterAccount(queryClient, userId).finally(() => {
      if (live) setCheckedFor(userId);
    });
    return () => {
      live = false;
    };
  }, [isAuthResolved, userId, queryClient]);
  const ready = isAuthResolved && (userId === null || checkedFor === userId);

  // Registered during render, not in an effect: children's mount effects fire
  // API calls before a parent effect would run. Guarded so it only re-runs if
  // the SDK instance changes.
  const registeredServicesRef = useRef<typeof oxyServices | null>(null);
  if (registeredServicesRef.current !== oxyServices) {
    registeredServicesRef.current = oxyServices;
    bindApiClient(oxyServices);
  }
  useEffect(() => {
    // Also rebind after StrictMode's effect cleanup/setup cycle.
    bindApiClient(oxyServices);
    return () => releaseApiClient(oxyServices);
  }, [oxyServices]);

  // Bloom surfaces that take a bare Oxy file id (avatars) resolve it here.
  const resolveImageSource = useMemo(
    () => (id: string, variant?: string) => oxyServices.assets.publicUrl(id, variant ?? 'thumb'),
    [oxyServices],
  );

  return (
    <ImageResolverProvider value={resolveImageSource}>
      {ready ? children : null}
    </ImageResolverProvider>
  );
}

function AppContent() {
  const { colors } = useColorScheme();
  // The Oxy account colour is the app's accent: applied once, below both the
  // Oxy and Bloom providers.
  useAccountColor();

  // Mounted only once BloomProvider has loaded Bloom's fonts, so hiding the
  // splash here leaves no unstyled-text flash.
  useEffect(() => {
    SplashScreen.hideAsync();
    registerAppWorker();
  }, []);

  // No KeyboardProvider here: OxyProvider mounts the app's one, and a second
  // provider leaves keyboard callbacks suspended after a modal closes.
  return (
    <AuthSetup>
      <Stack
        screenOptions={{
          contentStyle: {
            backgroundColor: colors.background,
          },
        }}
      >
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="pub/[slug]" options={{ headerShown: false }} />
        <Stack.Screen name="pub/[slug]/[pageId]" options={{ headerShown: false }} />
        <Stack.Screen name="form/[token]" options={{ headerShown: false }} />
        <Stack.Screen name="share/[token]" options={{ headerShown: false }} />
        <Stack.Screen name="join/[token]" options={{ headerShown: false }} />
        <Stack.Screen name="invite/[token]" options={{ headerShown: false }} />
      </Stack>
    </AuthSetup>
  );
}

function RootLayout() {
  const locale = useI18nStore((state) => state.locale);
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          retry: 1,
          refetchOnWindowFocus: false,
        },
      },
    });
    configureShellQueries(client);
    return client;
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* The single Bloom root (theme, fonts, haptics, scroll restoration). It
          sits ABOVE the error boundary because the boundary's fallback reads
          the theme. */}
      <BloomProvider
        locale={locale}
        defaultMode="system"
        defaultColorPreset="yellow"
        persistKey={BLOOM_THEME_PERSIST_KEY}
        storage={BLOOM_THEME_STORAGE}
        scrollAdapter={expoRouterScrollAdapter}
      >
        <BloomScope size="md">
          <AppErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <OxyProvider
                baseURL={OXY_API_URL}
                queryClient={queryClient}
                accountQueries={ACCOUNT_QUERIES}
                clientId={process.env.EXPO_PUBLIC_OXY_CLIENT_ID}
                authRedirectUri={Platform.OS !== 'web' ? AUTH_REDIRECT_URI : undefined}
                language={{
                  supportedLocales: SUPPORTED_LOCALES,
                  fallbackLocale: DEFAULT_LOCALE,
                  onChange: (locale) => useI18nStore.getState().setLocale(locale),
                  onError: (error, locale) =>
                    console.error('Failed to follow the Oxy-resolved language', error, locale),
                }}
              >
                {/* Bloom leaves its visual outlets to the app: overlays (the
                  Alia sheet among them) render into this one outlet. */}
                <PortalProvider>
                  <OverlayInertBoundary>
                    <AppContent />
                  </OverlayInertBoundary>
                  <PortalOutlet />
                </PortalProvider>
              </OxyProvider>
            </QueryClientProvider>
          </AppErrorBoundary>
        </BloomScope>
      </BloomProvider>
    </GestureHandlerRootView>
  );
}

export default RootLayout;

```
## apps/app/app/(app)/_layout.tsx
```tsx
import { Slot } from 'expo-router';
import { NewPageDialog } from '@/components/templates/new-page-dialog';
import { AppErrorBoundary } from '@/components/error-boundary';
import { useNotificationSetup } from '@/lib/hooks/use-notification-setup';
import { useOfflineSync } from '@/lib/editor/use-offline-pages';
import { useKeyboardShortcuts } from '@/lib/hooks/use-keyboard-shortcuts';
import { CommandPalette } from '@/components/command-palette';
import { ShortcutsDialog } from '@/components/shortcuts-dialog';
import { AskAliaRoot } from '@/components/ask-alia';
import { NiloSettingsProvider } from '@/components/settings/settings-provider';
import { NiloShell } from '@/components/shell/nilo-shell';

export default function AppLayout() {
  // Push notification registration, tap handling, and real-time subscription
  useNotificationSetup();
  // Pages kept offline stay current (lib/editor/offline-pages.ts).
  useOfflineSync();

  // Global app-wide keyboard shortcuts (Cmd+K, Cmd+Alt+N, Cmd+\, Cmd+/)
  useKeyboardShortcuts();

  return (
    <AppErrorBoundary>
      <NiloSettingsProvider>
        <AskAliaRoot>
          <NiloShell>
            <Slot />
          </NiloShell>
          <CommandPalette />
          <NewPageDialog />
          <ShortcutsDialog />
        </AskAliaRoot>
      </NiloSettingsProvider>
    </AppErrorBoundary>
  );
}

```
## apps/app/components/shell/nilo-shell.tsx
```tsx
import * as React from 'react';
import { Linking, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { AliaAvatarIcon } from '@alia.onl/sdk/avatar';
import { AppShell } from '@oxy.so/bloom/app-shell';
import { Button, LinkButton } from '@oxy.so/bloom/button';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { RiHome5Line } from '@oxy.so/bloom/icons/RiHome5Line';
import { RiInbox2Line } from '@oxy.so/bloom/icons/RiInbox2Line';
import { RiLoginBoxLine } from '@oxy.so/bloom/icons/RiLoginBoxLine';
import { RiSearchLine } from '@oxy.so/bloom/icons/RiSearchLine';
import { RiSettings3Line } from '@oxy.so/bloom/icons/RiSettings3Line';
import { RiUserAddLine } from '@oxy.so/bloom/icons/RiUserAddLine';
import type { SidebarNavItem, SidebarProps } from '@oxy.so/bloom/sidebar';
import { Text } from '@oxy.so/bloom/typography';
import { useOxy } from '@oxy.so/services/ui/client';
import { useAskAlia } from '@/components/ask-alia';
import { NiloWordmark } from '@/components/nilo-wordmark';
import { useNiloSettings } from '@/components/settings/settings-provider';
import { useTranslation } from '@/hooks/useTranslation';
import { useUnreadCount } from '@/lib/hooks/use-notifications';
import { SIDEBAR_IN_FLOW_FROM } from '@/lib/sidebar-layout';
import { useNewPageStore } from '@/lib/stores/new-page-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { PRIVACY_URL, TERMS_URL, useAccountIdentity, useWorkspaceTeam } from './use-identities';
import { useSidebarTree } from './use-sidebar-tree';
import { useOnboarding } from './use-onboarding';

/** The `SidebarNavItem` icon slot hands over a size; Alia's mark takes it as its box. */
function AliaGlyph({ width, height }: { width?: number; height?: number }) {
  return <AliaAvatarIcon width={width} height={height} />;
}

/** Which navigation row the route is. */
function selectedRow(pathname: string): string | undefined {
  if (pathname === '/') return 'home';
  if (pathname.startsWith('/notifications')) return 'inbox';
  if (pathname.startsWith('/trash')) return 'trash';
  return undefined;
}

/**
 * The signed-in workspace's shell: Bloom's `AppShell` with its `Sidebar` as a
 * docked column — the workspace switcher at its head, the navigation, the page
 * tree, and the person at its foot — that becomes a drawer on a phone (opened
 * from the edge on native, `drawerSwipe`). Every page of `app/(app)/` renders
 * inside it.
 *
 * Search and New page show their shortcuts but the app's own keymap binds them
 * (`useKeyboardShortcuts`), since they must work inside the editor too.
 */
export function NiloShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, openAccountDialog } = useOxy();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const setCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const drawerOpen = useUIStore((s) => s.sidebarOpen);
  const setDrawerOpen = useUIStore((s) => s.setSidebarOpen);
  const setPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const openNewPage = useNewPageStore((s) => s.open);
  const { open: openSettings } = useNiloSettings();
  const askAlia = useAskAlia();
  const { data: unread } = useUnreadCount();
  const { team, dialogs: workspaceDialogs } = useWorkspaceTeam();
  const account = useAccountIdentity();
  const { onboarding, dialogs: onboardingDialogs } = useOnboarding(workspaceId);
  const {
    tree,
    onTreeItemDrop,
    dialogs: treeDialogs,
  } = useSidebarTree(isAuthenticated ? workspaceId : null);

  const sidebar = React.useMemo<Omit<SidebarProps, 'mobile' | 'onClose'>>(() => {
    const alia: SidebarNavItem = {
      key: 'alia',
      label: t('alia.ask'),
      icon: AliaGlyph,
      onPress: askAlia,
    };
    const labels = {
      accessibilityLabel: t('sidebar.navigation'),
      collapseLabel: t('sidebar.collapseSidebar'),
      expandLabel: t('sidebar.expandSidebar'),
    };
    const shared = {
      variant: 'panel' as const,
      surface: 'docked' as const,
      size: 'sm' as const,
      showSearch: false,
      showThemeToggle: false,
      collapsed,
      onCollapsedChange: setCollapsed,
      onNavigate: (item: SidebarNavItem) => {
        if (!item.href) return;
        // On a phone the sidebar is a drawer: choosing where to go puts it away.
        setDrawerOpen(false);
        router.push(item.href as never);
      },
      ...labels,
    };
    if (!isAuthenticated) {
      return {
        ...shared,
        logo: {
          wordmark: <NiloWordmark height={24} width={62} />,
          onPress: () => router.replace('/(app)'),
          accessibilityLabel: t('sidebar.home'),
        },
        items: [alia],
        footer: ({ collapsed: narrow }) =>
          narrow ? (
            <Button
              appearance="subtle"
              tone="accent"
              iconOnly
              onPress={() => openAccountDialog()}
              accessibilityLabel={t('login.signInButton')}
              leadingIcon={RiLoginBoxLine}
            />
          ) : (
            <View className="gap-2">
              <Button
                appearance="solid"
                tone="accent"
                className="w-full"
                onPress={() => openAccountDialog()}
                leadingIcon={RiLoginBoxLine}
              >
                {t('login.signInButton')}
              </Button>
              <Button
                appearance="outline"
                className="w-full"
                onPress={() => openAccountDialog()}
                leadingIcon={RiUserAddLine}
              >
                {t('login.footerLink')}
              </Button>
              <View className="mt-1 flex-row items-center justify-center gap-1">
                <LinkButton
                  size="xs"
                  linkTone="secondary"
                  underline="rest"
                  onPress={() => void Linking.openURL(PRIVACY_URL)}
                >
                  {t('sidebar.privacyPolicy')}
                </LinkButton>
                <Text className="text-[10px] text-muted-foreground">·</Text>
                <LinkButton
                  size="xs"
                  linkTone="secondary"
                  underline="rest"
                  onPress={() => void Linking.openURL(TERMS_URL)}
                >
                  {t('sidebar.termsOfService')}
                </LinkButton>
              </View>
            </View>
          ),
      };
    }
    const unreadCount = unread?.count ?? 0;
    return {
      ...shared,
      teamPlacement: 'header',
      team,
      account,
      onboarding,
      items: [
        {
          key: 'search',
          label: t('sidebar.search'),
          icon: RiSearchLine,
          shortcut: 'Mod+K',
          shortcutBinding: 'app',
          onPress: () => setPaletteOpen(true),
        },
        { key: 'home', label: t('sidebar.home'), icon: RiHome5Line, href: '/' },
        alia,
        {
          key: 'inbox',
          label: t('sidebar.inbox'),
          icon: RiInbox2Line,
          href: '/notifications',
          badge: unreadCount > 0 ? unreadCount : undefined,
        },
        {
          key: 'settings',
          label: t('sidebar.settingsAndMembers'),
          icon: RiSettings3Line,
          onPress: () => openSettings('members'),
        },
      ],
      secondaryItems: [
        { key: 'trash', label: t('sidebar.trash'), icon: RiDeleteBin6Line, href: '/trash' },
        ...(workspaceId
          ? [
              {
                key: 'new-page',
                label: t('sidebar.newPage'),
                icon: RiAddLine,
                shortcut: 'Mod+Alt+N',
                shortcutBinding: 'app' as const,
                onPress: () => openNewPage({ workspaceId, parentId: null }),
              },
            ]
          : []),
      ],
      selected: selectedRow(pathname),
      tree,
      onTreeItemPress: (item) => {
        if (!item.href) return;
        setDrawerOpen(false);
        router.push(item.href as never);
      },
      onTreeItemDrop,
    };
  }, [
    t,
    askAlia,
    collapsed,
    setCollapsed,
    setDrawerOpen,
    router,
    isAuthenticated,
    openAccountDialog,
    unread?.count,
    team,
    account,
    onboarding,
    setPaletteOpen,
    openSettings,
    workspaceId,
    openNewPage,
    pathname,
    tree,
    onTreeItemDrop,
  ]);

  return (
    <>
      <AppShell
        panels
        contentMaxWidth="none"
        scroll="fixed"
        safeArea
        navFrom={SIDEBAR_IN_FLOW_FROM}
        drawerSwipe
        drawerOpen={drawerOpen}
        onDrawerOpenChange={setDrawerOpen}
        drawerOpenLabel={t('sidebar.openNavigation')}
        drawerCloseLabel={t('sidebar.closeNavigation')}
        sidebar={sidebar}
      >
        {children}
      </AppShell>
      {workspaceDialogs}
      {treeDialogs}
      {onboardingDialogs}
    </>
  );
}

```