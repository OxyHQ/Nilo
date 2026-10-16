import { NewPageDialog } from '@/components/templates/new-page-dialog';
import { Drawer } from 'expo-router/drawer';
import { Sidebar } from '@/components/sidebar';
import { AppErrorBoundary } from '@/components/error-boundary';
import { View, Platform, useWindowDimensions } from 'react-native';
import { useCallback } from 'react';
import { useColorScheme } from '@/lib/useColorScheme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUIStore } from '@/lib/stores/ui-store';
import { useNotificationSetup } from '@/lib/hooks/use-notification-setup';
import { useOfflineSync } from '@/lib/editor/use-offline-pages';
import { useKeyboardShortcuts } from '@/lib/hooks/use-keyboard-shortcuts';
import { CommandPalette } from '@/components/command-palette';
import { ShortcutsDialog } from '@/components/shortcuts-dialog';
import { AskAliaRoot } from '@/components/ask-alia';
import { NiloSettingsProvider } from '@/components/settings/settings-provider';

// Routes that handle their own top safe area insets
const SELF_INSET_ROUTES = new Set(['index']);

const SIDEBAR_WIDTH_EXPANDED = 256;
const SIDEBAR_WIDTH_COLLAPSED = 48;

export default function AppLayout() {
  const dimensions = useWindowDimensions();
  const isLargeScreen = dimensions.width >= 768;
  const { colors } = useColorScheme();
  const insets = useSafeAreaInsets();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);

  // Push notification registration, tap handling, and real-time subscription
  useNotificationSetup();
  // Pages kept offline stay current (lib/editor/offline-pages.ts).
  useOfflineSync();

  // Global app-wide keyboard shortcuts (Cmd+K, Cmd+N, Cmd+\, Cmd+/)
  useKeyboardShortcuts();

  const renderDrawerContent = useCallback(() => <Sidebar />, []);

  // On large screens, use collapsed width when collapsed; on mobile always expanded
  const drawerWidth =
    isLargeScreen && sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;

  const screenOptions = useCallback(
    ({ route }: { route: { name: string } }) => ({
      headerShown: false,
      sceneContainerStyle: {
        paddingTop: SELF_INSET_ROUTES.has(route.name) ? 0 : insets.top,
      },
      drawerStyle: {
        width: drawerWidth,
        backgroundColor: colors.background,
        borderRightWidth: 0,
        boxShadow: 'none' as const,
        elevation: 0,
        // Smooth collapse/expand transition on web (desktop only)
        ...(Platform.OS === 'web' &&
          isLargeScreen && {
            transitionProperty: 'width',
            transitionDuration: '200ms',
            transitionTimingFunction: 'ease-out',
          }),
      },
      drawerType: isLargeScreen ? ('permanent' as const) : ('front' as const),
      swipeEnabled: !isLargeScreen,
      overlayColor: isLargeScreen ? 'transparent' : 'rgba(0, 0, 0, 0.5)',
      // Hide all built-in drawer items; the custom Sidebar renders its own navigation
      drawerItemStyle: { display: 'none' as const },
    }),
    [insets.top, colors.background, isLargeScreen, drawerWidth],
  );

  return (
    <AppErrorBoundary>
      <NiloSettingsProvider>
        <AskAliaRoot>
          {/* root: isolate flex h-screen */}
          <View className="isolate flex h-screen flex-row">
            {/* main: isolate flex h-auto max-h-screen min-w-0 grow flex-col */}
            <View className="isolate flex h-auto max-h-screen min-w-0 grow flex-col">
              {/* content-area: relative isolate min-h-0 flex-1 overflow-hidden bg-background */}
              <View className="relative isolate min-h-0 flex-1 overflow-hidden bg-background">
                <Drawer drawerContent={renderDrawerContent} screenOptions={screenOptions} />
              </View>
            </View>
          </View>
          <CommandPalette />
          <NewPageDialog />
          <ShortcutsDialog />
        </AskAliaRoot>
      </NiloSettingsProvider>
    </AppErrorBoundary>
  );
}
