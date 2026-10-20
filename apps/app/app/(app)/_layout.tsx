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
