import { Platform, View } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { AliaAvatarIcon } from '@alia.onl/sdk/avatar';
import { RiSearchLine } from '@oxy.so/bloom/icons/RiSearchLine';
import { RiInbox2Line } from '@oxy.so/bloom/icons/RiInbox2Line';
import { RiSettings3Line } from '@oxy.so/bloom/icons/RiSettings3Line';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { Badge } from '@oxy.so/bloom/badge';
import { Kbd } from '@oxy.so/bloom/kbd';
import { useUIStore } from '@/lib/stores/ui-store';
import { useAskAlia } from '@/components/ask-alia';
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
      icon={RiSearchLine}
      label={t('sidebar.search')}
      onPress={() => setOpen(true)}
      accessibilityLabel={t('sidebar.searchLabel')}
      trailing={
        showShortcut ? (
          <View className="flex-row items-center gap-1">
            <Kbd size="sm">{mod}</Kbd>
            <Kbd size="sm">K</Kbd>
          </View>
        ) : undefined
      }
    />
  );
}

/** `SidebarItem`'s icon slot hands over a size; the avatar takes it as its width. */
function AliaGlyph({ width, height }: { width?: number; height?: number }) {
  return <AliaAvatarIcon width={width} height={height} />;
}

/**
 * "Ask Alia" — opens the Alia chat sheet, or the Oxy sign-in dialog when
 * signed out. Shown for everyone, unlike the workspace rows around it.
 */
export function SidebarAskAliaButton() {
  const { t } = useTranslation();
  const askAlia = useAskAlia();
  return <SidebarItem icon={AliaGlyph} label={t('alia.ask')} onPress={askAlia} />;
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
      icon={RiInbox2Line}
      label={t('sidebar.inbox')}
      isActive={isActive}
      onPress={() => router.push('/(app)/notifications')}
      trailing={
        typeof unreadCount === 'number' && unreadCount > 0 ? (
          <Badge content={unreadCount} max={99} appearance="solid" tone="accent" />
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
      icon={RiSettings3Line}
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
      icon={RiDeleteBin6Line}
      label={t('sidebar.trash')}
      isActive={isActive}
      onPress={() => router.push('/trash')}
    />
  );
}
