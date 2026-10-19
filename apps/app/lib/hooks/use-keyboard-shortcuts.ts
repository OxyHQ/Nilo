import { useNewPageStore } from '@/lib/stores/new-page-store';
import * as React from 'react';
import { Platform } from 'react-native';
import { useUIStore } from '@/lib/stores/ui-store';
import { useWorkspaceStore } from '@/lib/stores/workspace-store';

export type Shortcut = 'palette' | 'newPage' | 'sidebar' | 'shortcuts';

/** The keys of each shortcut, as the shortcuts dialog shows them (`Mod`: ⌘ or Ctrl). */
export const SHORTCUT_KEYS: Record<Shortcut, string[]> = {
  palette: ['Mod', 'K'],
  // Not Mod+N: a browser keeps that for a new window and never lets a page
  // have it. Notion's web app uses this one.
  newPage: ['Mod', 'Alt', 'N'],
  sidebar: ['Mod', '\\'],
  shortcuts: ['Mod', '/'],
};

/** Notion's Quick Find, which opens the same palette as Mod+K. */
export const QUICK_FIND_KEYS = ['Mod', 'P'];

/**
 * Which app-wide shortcut a key press is, if any. Modifier+key combos a user
 * clearly means app-wide, so they fire inside text fields too, except Mod+/
 * (an editor's own). Mod+[ is left to the browser: it is Back.
 */
export function shortcutFor(
  e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'key' | 'code'>,
  inEditor: boolean,
): Shortcut | null {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return null;
  // With Alt (Option) a letter types another character: read the key's place.
  if (e.altKey) return e.code === 'KeyN' ? 'newPage' : null;
  const key = e.key.toLowerCase();
  // Mod+P is Notion's Quick Find; it also keeps the browser's print dialog away.
  if (key === 'k' || key === 'p') return 'palette';
  if (key === '\\') return 'sidebar';
  if (key === '/' && !inEditor) return 'shortcuts';
  return null;
}

function isEditing(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable === true;
}

/**
 * Global keyboard shortcuts for Nilo. Web-only — native keyboards don't
 * have a meaningful Cmd/Ctrl convention for app-wide actions. Mounted once at
 * the (app) layout level.
 *
 * Shortcuts (`SHORTCUT_KEYS`):
 *   - Cmd/Ctrl+K, P   → open command palette (P: Notion's Quick Find)
 *   - Cmd/Ctrl+Alt+N  → create new root page in current workspace
 *   - Cmd/Ctrl+\      → toggle sidebar collapsed
 *   - Cmd/Ctrl+/      → toggle shortcuts dialog (only when not focused inside editor)
 */
export function useKeyboardShortcuts() {
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const toggleSidebarCollapsed = useUIStore((s) => s.toggleSidebarCollapsed);
  const toggleShortcutsDialog = useUIStore((s) => s.toggleShortcutsDialog);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const openNewPage = useNewPageStore((s) => s.open);

  // Stash mutable handlers in a ref so the global listener doesn't churn.
  const handlersRef = React.useRef({
    setCommandPaletteOpen,
    toggleSidebarCollapsed,
    toggleShortcutsDialog,
    currentWorkspaceId,
    openNewPage,
  });
  handlersRef.current = {
    setCommandPaletteOpen,
    toggleSidebarCollapsed,
    toggleShortcutsDialog,
    currentWorkspaceId,
    openNewPage,
  };

  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;

    const onKeyDown = (e: KeyboardEvent) => {
      const shortcut = shortcutFor(e, isEditing(e));
      if (!shortcut) return;
      e.preventDefault();
      const handlers = handlersRef.current;
      if (shortcut === 'palette') handlers.setCommandPaletteOpen(true);
      else if (shortcut === 'sidebar') handlers.toggleSidebarCollapsed();
      else if (shortcut === 'shortcuts') handlers.toggleShortcutsDialog();
      else if (handlers.currentWorkspaceId) {
        handlers.openNewPage({ workspaceId: handlers.currentWorkspaceId, parentId: null });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
