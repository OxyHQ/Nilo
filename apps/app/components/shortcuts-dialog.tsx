import * as React from 'react';
import { Platform, View } from 'react-native';
import { Dialog } from '@oxy.so/bloom/dialog';
import { Kbd } from '@oxy.so/bloom/kbd';
import { Text } from '@oxy.so/bloom/typography';
import { QUICK_FIND_KEYS, SHORTCUT_KEYS } from '@/lib/hooks/use-keyboard-shortcuts';
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
        { id: 'palette', label: t('keyboardShortcuts.openPalette'), keys: SHORTCUT_KEYS.palette },
        { id: 'quick-find', label: t('keyboardShortcuts.quickFind'), keys: QUICK_FIND_KEYS },
        { id: 'new-page', label: t('keyboardShortcuts.createPage'), keys: SHORTCUT_KEYS.newPage },
        { id: 'sidebar', label: t('keyboardShortcuts.toggleSidebar'), keys: SHORTCUT_KEYS.sidebar },
        {
          id: 'shortcuts',
          label: t('keyboardShortcuts.showShortcuts'),
          keys: SHORTCUT_KEYS.shortcuts,
        },
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
 * elsewhere, `Alt` as `⌥` on macOS. The UI store owns the open state (Cmd+/ and the palette toggle
 * it), so the dialog is controlled by it.
 */
export function ShortcutsDialog() {
  const open = useUIStore((s) => s.shortcutsDialogOpen);
  const setOpen = useUIStore((s) => s.setShortcutsDialogOpen);
  const { mod: modLabel, alt: altLabel } = useModifierLabels();
  const { t } = useTranslation();
  const shortcuts = buildShortcuts(t);

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={448}
      title={t('keyboardShortcuts.shortcuts')}
      description={t('keyboardShortcuts.description')}
    >
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
                      <Kbd key={`${sc.id}-${k}`}>
                        {k === 'Mod' ? modLabel : k === 'Alt' ? altLabel : k}
                      </Kbd>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>
    </Dialog>
  );
}

function useModifierLabels(): { mod: string; alt: string } {
  return React.useMemo(() => {
    let isMac = Platform.OS === 'ios';
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      const platform = navigator.platform || '';
      const userAgent = navigator.userAgent || '';
      isMac = /Mac|iPhone|iPad/i.test(platform) || /Mac/i.test(userAgent);
    }
    return isMac ? { mod: '⌘', alt: '⌥' } : { mod: 'Ctrl', alt: 'Alt' };
  }, []);
}
