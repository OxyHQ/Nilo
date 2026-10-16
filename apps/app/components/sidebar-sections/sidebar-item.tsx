import * as React from 'react';
import { View } from 'react-native';
import { Item } from '@oxy.so/bloom/item';
import { useColorScheme } from '@/lib/useColorScheme';

interface SidebarItemProps {
  /** A Lucide icon, or any component that draws itself at `size` (and `color`, if it has one). */
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  onPress: () => void;
  isActive?: boolean;
  /** Optional right-side text (e.g. "⌘K") or badge node. */
  trailing?: React.ReactNode;
  accessibilityLabel?: string;
}

/**
 * Top-level sidebar link row used by static surfaces (Search, Inbox,
 * Settings, Trash). Mirrors the look of a page row but without the indent /
 * chevron / hover actions.
 */
export const SidebarItem = React.memo(function SidebarItem({
  icon: Icon,
  label,
  onPress,
  isActive,
  trailing,
  accessibilityLabel,
}: SidebarItemProps) {
  const { colors } = useColorScheme();
  return (
    <Item
      density="compact"
      active={isActive}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? label}
      leading={
        <View className="h-5 w-5 items-center justify-center">
          <Icon size={14} color={colors.mutedForeground} />
        </View>
      }
      title={label}
      trailing={trailing}
    />
  );
});
