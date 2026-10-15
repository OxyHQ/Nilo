import * as React from 'react';
import { Platform, View } from 'react-native';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Text } from '@/components/ui/text';
import { useUIStore } from '@/lib/stores/ui-store';
import { useTranslation } from '@/hooks/useTranslation';

interface Shortcut {
  /** Stable identifier (React key). */
  id: string;
  label: string;
  keys: string[];
}

interface ShortcutGroup {
  id: string;
  section: string;
  items: Shortcut[];
}

/**
 * Built at render time so the labels follow the current locale. Key names
 * (`Enter`, `Esc`, arrows) are the physical key legends and stay as-is.
 */
function buildShortcuts(t: (key: string) => string): ShortcutGroup[] {
  return [
    {
      id: 'navigation',
      section: t('keyboardShortcuts.navigation'),
      items: [
        { id: 'palette', label: t('keyboardShortcuts.openPalette'), keys: ['Mod', 'K'] },
        { id: 'new-page', label: t('keyboardShortcuts.createPage'), keys: ['Mod', 'N'] },
        { id: 'sidebar', label: t('keyboardShortcuts.toggleSidebar'), keys: ['Mod', '\\'] },
        { id: 'shortcuts', label: t('keyboardShortcuts.showShortcuts'), keys: ['Mod', '/'] },
      ],
    },
    {
      id: 'palette',
      section: t('keyboardShortcuts.inPalette'),
      items: [
        { id: 'move', label: t('keyboardShortcuts.moveSelection'), keys: ['↑', '↓'] },
        { id: 'open', label: t('keyboardShortcuts.openResult'), keys: ['Enter'] },
        { id: 'new-tab', label: t('keyboardShortcuts.openInNewTab'), keys: ['Mod', 'Enter'] },
        { id: 'close', label: t('keyboardShortcuts.close'), keys: ['Esc'] },
      ],
    },
  ];
}

/**
 * Cross-platform shortcuts dialog. `Mod` renders as `⌘` on macOS and `Ctrl`
 * elsewhere.
 */
export function ShortcutsDialog() {
  const open = useUIStore((s) => s.shortcutsDialogOpen);
  const setOpen = useUIStore((s) => s.setShortcutsDialogOpen);
  const modLabel = useModifierLabel();
  const { t } = useTranslation();
  const shortcuts = buildShortcuts(t);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('keyboardShortcuts.shortcuts')}</DialogTitle>
          <DialogDescription>{t('keyboardShortcuts.description')}</DialogDescription>
        </DialogHeader>
        <View className="gap-5">
          {shortcuts.map((group) => (
            <View key={group.id} className="gap-2">
              <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.section}
              </Text>
              <View className="gap-1">
                {group.items.map((sc) => (
                  <View key={sc.id} className="flex-row items-center justify-between gap-3">
                    <Text className="flex-1 text-sm text-foreground">{sc.label}</Text>
                    <View className="flex-row items-center gap-1">
                      {sc.keys.map((k) => (
                        <KeyCap key={`${sc.id}-${k}`}>{k === 'Mod' ? modLabel : k}</KeyCap>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      </DialogContent>
    </Dialog>
  );
}

function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <View className="min-w-7 rounded-md border border-border bg-muted px-1.5 py-0.5">
      <Text className="text-center text-[11px] font-medium text-foreground">{children}</Text>
    </View>
  );
}

function useModifierLabel(): string {
  return React.useMemo(() => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      const platform = navigator.platform || '';
      const userAgent = navigator.userAgent || '';
      const isMac = /Mac|iPhone|iPad/i.test(platform) || /Mac/i.test(userAgent);
      return isMac ? '⌘' : 'Ctrl';
    }
    return Platform.OS === 'ios' ? '⌘' : 'Ctrl';
  }, []);
}
