import { useQueryClient } from '@tanstack/react-query';
import { signOutOfDevice } from '@/lib/account-boundary';
import { PlacementSections } from './sidebar-sections/placement-sections';
import { PageDragProvider } from './sidebar-sections/drag-context';
import { useNewPageStore } from '@/lib/stores/new-page-store';
import { SharedWithMeSection } from './sidebar-sections/shared-with-me-section';
import React from 'react';
import { View, Pressable, Linking, ScrollView, useWindowDimensions } from 'react-native';
import { Button, LinkButton } from '@oxy.so/bloom/button';
import { Divider } from '@oxy.so/bloom/divider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { Text } from '@oxy.so/bloom/typography';
import { RiNotification3Line } from '@oxy.so/bloom/icons/RiNotification3Line';
import { RiArrowLeftDoubleLine } from '@oxy.so/bloom/icons/RiArrowLeftDoubleLine';
import { RiArrowRightDoubleLine } from '@oxy.so/bloom/icons/RiArrowRightDoubleLine';
import { RiFileTextLine } from '@oxy.so/bloom/icons/RiFileTextLine';
import { RiLoginBoxLine } from '@oxy.so/bloom/icons/RiLoginBoxLine';
import { RiLogoutBoxRLine } from '@oxy.so/bloom/icons/RiLogoutBoxRLine';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiSettings3Line } from '@oxy.so/bloom/icons/RiSettings3Line';
import { RiShieldCheckLine } from '@oxy.so/bloom/icons/RiShieldCheckLine';
import { RiUserLine } from '@oxy.so/bloom/icons/RiUserLine';
import { RiUserAddLine } from '@oxy.so/bloom/icons/RiUserAddLine';
import { useTranslation } from '@/hooks/useTranslation';
import { useUIStore } from '@/lib/stores/ui-store';
import { useRouter } from 'expo-router';
import { useNiloSettings } from '@/components/settings/settings-provider';
import { UserAvatar } from '@/components/user-avatar';
import { useOxy } from '@oxy.so/services/ui/client';
import { NiloWordmark } from '@/components/nilo-wordmark';
import { WorkspaceSwitcher } from '@/components/workspace/workspace-switcher';
import { useColorScheme } from '@/lib/useColorScheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';
import { useUnreadCount } from '@/lib/hooks/use-notifications';
import {
  SidebarAskAliaButton,
  SidebarHomeButton,
  SidebarSearchButton,
  SidebarInboxButton,
  SidebarSettingsButton,
  SidebarTrashButton,
  RecentsSection,
  FavoritesSection,
  TemplatesSection,
} from '@/components/sidebar-sections';

/* ================================================================
   Workspace sidebar — Notion-style sections
   ================================================================ */

export const Sidebar = React.memo(function Sidebar() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const insets = useSafeAreaInsets();
  const dimensions = useWindowDimensions();
  const isLargeScreen = dimensions.width >= 768;

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useUIStore((s) => s.toggleSidebarCollapsed);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const openNewPage = useNewPageStore((s) => s.open);

  const { user, isAuthenticated, logout, showBottomSheet, openAccountDialog } = useOxy();
  // Surface the Comments agent's unread count on the Inbox row.
  const { data: unreadData } = useUnreadCount();
  const unreadCount = unreadData?.count ?? 0;

  // Only allow collapse on large screens
  const isCollapsed = isLargeScreen && sidebarCollapsed;

  const handleHome = React.useCallback(() => router.replace('/(app)'), [router]);
  const { open: openSettings } = useNiloSettings();
  const handleSettings = React.useCallback(() => openSettings(), [openSettings]);
  const handleAccount = React.useCallback(
    () => showBottomSheet?.('ManageAccount'),
    [showBottomSheet],
  );
  const queryClient = useQueryClient();
  const handleLogout = React.useCallback(() => {
    logout();
    router.replace('/(app)');
    // What the device kept for this account goes with it, and whatever is
    // written while the app unmounts goes at the next sign-in
    // (lib/account-boundary.ts).
    void signOutOfDevice(queryClient);
  }, [router, logout, queryClient]);
  const handleLogin = React.useCallback(() => openAccountDialog(), [openAccountDialog]);
  const handleNotifications = React.useCallback(
    () => router.push('/(app)/notifications'),
    [router],
  );
  const handleCreatePage = React.useCallback(() => {
    if (!currentWorkspaceId) return;
    openNewPage({ workspaceId: currentWorkspaceId, parentId: null });
  }, [openNewPage, currentWorkspaceId]);

  const displayName = React.useMemo(() => {
    if (!user) return t('common.user');
    if (user.name?.first)
      return user.name.last ? `${user.name.first} ${user.name.last}` : user.name.first;
    return user.username || t('common.user');
  }, [user, t]);

  /* ================================================================
     COLLAPSED LAYOUT
     ================================================================ */
  if (isCollapsed) {
    return (
      <View
        className="flex h-full flex-col bg-background border-r border-border items-center"
        style={{
          width: 48,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        {/* Header: workspace switcher (auth) or logo (unauth) */}
        <View className="h-14 items-center justify-center shrink-0">
          {isAuthenticated ? (
            <WorkspaceSwitcher collapsed />
          ) : (
            <Button
              appearance="plain"
              iconOnly
              onPress={handleHome}
              accessibilityLabel={t('sidebar.home')}
              icon={<NiloWordmark width={20} color={colors.foreground} />}
            />
          )}
        </View>

        {/* Spacer */}
        <View className="flex-1" />

        {/* Footer: expand + avatar */}
        <View className="flex flex-col items-center gap-2 p-2 pt-1 shrink-0">
          <Button
            appearance="subtle"
            iconOnly
            onPress={toggleSidebarCollapsed}
            accessibilityLabel={t('sidebar.expandSidebar')}
            leadingIcon={RiArrowRightDoubleLine}
          />
          {isAuthenticated ? (
            <Button
              appearance="plain"
              size="lg"
              iconOnly
              onPress={handleAccount}
              accessibilityLabel={t('sidebar.account')}
              icon={<UserAvatar size={32} />}
            />
          ) : (
            <Button
              appearance="subtle"
              tone="accent"
              size="lg"
              iconOnly
              onPress={handleLogin}
              accessibilityLabel={t('login.signInButton')}
              leadingIcon={RiLoginBoxLine}
            />
          )}
        </View>
      </View>
    );
  }

  /* ================================================================
     EXPANDED LAYOUT
     ================================================================ */
  return (
    <View
      className="flex h-full w-full flex-col bg-background border-r border-border"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      {/* Header: workspace switcher (auth) or logo (unauth) + collapse button */}
      <View className="h-14 flex-row items-center shrink-0 px-2 gap-1">
        {isAuthenticated ? (
          <WorkspaceSwitcher />
        ) : (
          <Pressable
            onPress={handleHome}
            className="p-1 mx-0.5 shrink-0 rounded-xl hover:bg-muted"
            accessibilityLabel={t('sidebar.home')}
          >
            <NiloWordmark height={24} width={62} color={colors.foreground} />
          </Pressable>
        )}
        {isLargeScreen && (
          <View className="shrink-0">
            <Button
              appearance="subtle"
              iconOnly
              onPress={toggleSidebarCollapsed}
              accessibilityLabel={t('sidebar.collapseSidebar')}
              leadingIcon={RiArrowLeftDoubleLine}
            />
          </View>
        )}
      </View>

      {/* Scrollable middle: search + nav + sections */}
      <ScrollView className="min-h-0 flex-1" showsVerticalScrollIndicator={false}>
        <View className="px-1 py-1 gap-0.5">
          {isAuthenticated ? (
            <>
              <SidebarSearchButton />
              <SidebarHomeButton />
            </>
          ) : null}
          <SidebarAskAliaButton />
          {isAuthenticated ? (
            <>
              <SidebarInboxButton unreadCount={unreadCount} />
              <SidebarSettingsButton />
            </>
          ) : null}
        </View>

        {isAuthenticated ? <SharedWithMeSection /> : null}

        {isAuthenticated && currentWorkspaceId ? (
          // One drag across the sections: a page moves between them.
          <PageDragProvider>
            <View className="mt-2">
              <RecentsSection />
              <FavoritesSection />
              <PlacementSections />
              <TemplatesSection />
            </View>
          </PageDragProvider>
        ) : null}

        {isAuthenticated ? (
          <View className="mt-2 px-1">
            <SidebarTrashButton />
          </View>
        ) : null}
      </ScrollView>

      {/* + New page (visible when authenticated) */}
      {isAuthenticated && currentWorkspaceId ? (
        <View className="px-2 pt-1">
          <Button
            appearance="plain"
            size="sm"
            className="self-start"
            onPress={handleCreatePage}
            accessibilityLabel={t('sidebar.newPage')}
            leadingIcon={RiAddLine}
          >
            {t('sidebar.newPage')}
          </Button>
        </View>
      ) : null}

      <View className="mx-2 mt-2">
        <Divider />
      </View>

      {/* Footer: user avatar / sign-in */}
      <View className="flex flex-col gap-2 mt-auto shrink-0 p-2 pt-1">
        {isAuthenticated ? (
          <DropdownMenu>
            {/* Bloom wraps a trigger in a box that hugs its content; the row spans the sidebar. */}
            <DropdownMenuTrigger asChild style={{ alignSelf: 'stretch' }}>
              <Pressable
                accessibilityLabel={t('sidebar.accountMenu')}
                accessibilityRole="button"
                className="flex-row items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/60"
              >
                <View className="rounded-full h-9 w-9 p-1 overflow-visible items-center justify-center">
                  <UserAvatar size={28} />
                </View>
                <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>
                  {displayName}
                </Text>
              </Pressable>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <View className="flex-row items-center gap-2.5 px-2 py-2">
                <UserAvatar size={36} />
                <View>
                  <Text variant="body-semibold">{displayName}</Text>
                  {user?.username ? (
                    <Text className="text-xs text-muted-foreground">{user.username}@oxy.so</Text>
                  ) : null}
                </View>
              </View>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onPress={handleAccount}
                leading={<RiUserLine size="sm" fill={colors.mutedForeground} />}
              >
                {t('sidebar.account')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onPress={handleNotifications}
                leading={<RiNotification3Line size="sm" fill={colors.mutedForeground} />}
              >
                {unreadCount > 0
                  ? `${t('sidebar.notifications')} (${unreadCount})`
                  : t('sidebar.notifications')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onPress={handleSettings}
                leading={<RiSettings3Line size="sm" fill={colors.mutedForeground} />}
              >
                {t('sidebar.settings')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onPress={() =>
                  Linking.openURL('https://oxy.so/company/transparency/policies/terms-of-service')
                }
                leading={<RiFileTextLine size="sm" fill={colors.mutedForeground} />}
              >
                {t('sidebar.termsOfService')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onPress={() =>
                  Linking.openURL('https://oxy.so/company/transparency/policies/privacy')
                }
                leading={<RiShieldCheckLine size="sm" fill={colors.mutedForeground} />}
              >
                {t('sidebar.privacyPolicy')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onPress={handleLogout}
                leading={<RiLogoutBoxRLine size="sm" fill={colors.mutedForeground} />}
              >
                {t('sidebar.logOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <View className="gap-2">
            <Button
              appearance="solid"
              tone="accent"
              className="w-full"
              onPress={handleLogin}
              leadingIcon={RiLoginBoxLine}
            >
              {t('login.signInButton')}
            </Button>
            <Button
              appearance="outline"
              className="w-full"
              onPress={handleLogin}
              leadingIcon={RiUserAddLine}
            >
              {t('login.footerLink')}
            </Button>
            <View className="flex-row items-center justify-center gap-1 mt-1">
              <LinkButton
                size="xs"
                linkTone="secondary"
                underline="rest"
                onPress={() =>
                  Linking.openURL('https://oxy.so/company/transparency/policies/privacy')
                }
              >
                {t('sidebar.privacyPolicy')}
              </LinkButton>
              <Text className="text-[10px] text-muted-foreground">·</Text>
              <LinkButton
                size="xs"
                linkTone="secondary"
                underline="rest"
                onPress={() =>
                  Linking.openURL('https://oxy.so/company/transparency/policies/terms-of-service')
                }
              >
                {t('sidebar.termsOfService')}
              </LinkButton>
            </View>
          </View>
        )}
      </View>
    </View>
  );
});
