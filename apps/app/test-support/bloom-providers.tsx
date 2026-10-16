import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PortalOutlet, PortalProvider } from '@oxy.so/bloom/portal';
import { BloomThemeProvider } from '@oxy.so/bloom/theme';

const initialMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

/**
 * What a Bloom component needs above it in a test. On native a closed Popover,
 * Dialog or DropdownMenu still mounts its bottom sheet, which reads the safe
 * area and renders through the portal; `fonts={false}` skips the font loader.
 */
export function BloomTestProviders({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={initialMetrics}>
      <BloomThemeProvider fonts={false}>
        <PortalProvider>
          {children}
          <PortalOutlet />
        </PortalProvider>
      </BloomThemeProvider>
    </SafeAreaProvider>
  );
}
