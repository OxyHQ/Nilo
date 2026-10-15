import * as React from 'react';
import { Platform, View } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Search, Inbox, Settings, Trash2 } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { useUIStore } from '@/lib/stores/ui-store';
import { useTranslation } from '@/hooks/useTranslation';
import { SidebarItem } from './sidebar-item';

/**
 * Returns the platform-appropriate modifier symbol for keyboard hints in
 * sidebar trailing badges.
 */
function modifierKey(): string {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    const platform = navigator.platform || '';
    const userAgent = navigator.userAgent || '';
    if (/Mac|iPhone|iPad/i.test(platform) || /Mac/i.test(userAgent)) return '⌘';
    return 'Ctrl';
  }
  return Platform.OS === 'ios' ? '⌘' : 'Ctrl';
}

/**
 * "Search" — opens the Cmd+K palette. Shown at the very top of the sidebar
 * mid-zone above all sections.
 */
export function SidebarSearchButton() {
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const { t } = useTranslation();
  const showShortcut = Platform.OS === 'web';
  const mod = modifierKey();
  return (
    <SidebarItem
      icon={Search}
      label={t('sidebar.search')}
      onPress={() => setOpen(true)}
      accessibilityLabel={t('sidebar.searchLabel')}
      trailing={
        showShortcut ? (
          <KbdGroup>
            <Kbd>{mod}</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        ) : undefined
      }
    />
  );
}

interface InboxButtonProps {
  unreadCount?: number;
}

/**
 * Inbox placeholder. The Comments agent (#17) will wire real unread counts
 * via a hook; for now the badge is hidden when no count is provided.
 */
export function SidebarInboxButton({ unreadCount }: InboxButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const isActive = pathname.startsWith('/(app)/notifications');
  const { t } = useTranslation();

  return (
    <SidebarItem
      icon={Inbox}
      label={t('sidebar.inbox')}
      isActive={isActive}
      onPress={() => router.push('/(app)/notifications')}
      trailing={
        typeof unreadCount === 'number' && unreadCount > 0 ? (
          <View className="rounded-full bg-primary px-1.5">
            <Text className="text-[10px] font-semibold text-primary-foreground">
              {unreadCount > 99 ? '99+' : unreadCount}
            </Text>
          </View>
        ) : undefined
      }
    />
  );
}

export function SidebarSettingsButton() {
  const router = useRouter();
  const pathname = usePathname();
  const isActive = pathname.startsWith('/(app)/settings');
  const { t } = useTranslation();
  return (
    <SidebarItem
      icon={Settings}
      label={t('sidebar.settingsAndMembers')}
      isActive={isActive}
      onPress={() => router.push('/(app)/settings')}
    />
  );
}

export function SidebarTrashButton() {
  const router = useRouter();
  const pathname = usePathname();
  const isActive = pathname.startsWith('/trash');
  const { t } = useTranslation();
  return (
    <SidebarItem
      icon={Trash2}
      label={t('sidebar.trash')}
      isActive={isActive}
      onPress={() => router.push('/trash')}
    />
  );
}
