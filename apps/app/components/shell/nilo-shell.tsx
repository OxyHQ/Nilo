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
        gutter={0}
        navigationGap={0}
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
