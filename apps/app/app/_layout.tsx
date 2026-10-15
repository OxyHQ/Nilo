import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo, useRef, useState } from 'react';
import { OxyProvider, useOxy } from '@oxy.so/services';
import { BloomProvider } from '@oxy.so/bloom/provider';
import { ImageResolverProvider } from '@oxy.so/bloom/image-resolver';
import { expoRouterScrollAdapter } from '@oxy.so/bloom/scroll/expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { AppErrorBoundary } from '@/components/error-boundary';
import { useColorScheme } from '@/lib/useColorScheme';
import { setTokenGetter } from '@/lib/api/client';
import { BLOOM_THEME_PERSIST_KEY, BLOOM_THEME_STORAGE } from '@/lib/themePersistence';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/lib/i18n';
import { useI18nStore } from '@/lib/stores/i18n-store';
import 'react-native-reanimated';
import '../global.css';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(app)',
};

SplashScreen.preventAutoHideAsync();

const OXY_API_URL = process.env.EXPO_PUBLIC_OXY_API_URL || 'https://api.oxy.so';
const AUTH_REDIRECT_URI = Linking.createURL('/');

function AuthSetup({ children }: { children: React.ReactNode }) {
  const { oxyServices } = useOxy();

  // Registered during render, not in an effect: children's mount effects fire
  // API calls before a parent effect would run. Guarded so it only re-runs if
  // the SDK instance changes.
  const registeredServicesRef = useRef<typeof oxyServices | null>(null);
  if (registeredServicesRef.current !== oxyServices) {
    registeredServicesRef.current = oxyServices;
    setTokenGetter(() => oxyServices.session.accessToken || null);
  }

  // Bloom surfaces that take a bare Oxy file id (avatars) resolve it here.
  const resolveImageSource = useMemo(
    () => (id: string, variant?: string) => oxyServices.assets.publicUrl(id, variant ?? 'thumb'),
    [oxyServices],
  );

  return <ImageResolverProvider value={resolveImageSource}>{children}</ImageResolverProvider>;
}

function AppContent() {
  const { colors } = useColorScheme();

  // Mounted only once BloomProvider has loaded Bloom's fonts, so hiding the
  // splash here leaves no unstyled-text flash.
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  // No KeyboardProvider here: OxyProvider mounts the app's one, and a second
  // provider leaves keyboard callbacks suspended after a modal closes.
  return (
    <AuthSetup>
      <Stack
        screenOptions={{
          contentStyle: {
            backgroundColor: colors.background,
          },
        }}
      >
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="share/[token]" options={{ headerShown: false }} />
      </Stack>
    </AuthSetup>
  );
}

function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    // The single Bloom root (theme, fonts, haptics, scroll restoration). It
    // sits ABOVE the error boundary because the boundary's fallback reads the
    // theme.
    <BloomProvider
      defaultMode="system"
      defaultColorPreset="yellow"
      persistKey={BLOOM_THEME_PERSIST_KEY}
      storage={BLOOM_THEME_STORAGE}
      scrollAdapter={expoRouterScrollAdapter}
    >
      <AppErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <OxyProvider
            baseURL={OXY_API_URL}
            clientId={process.env.EXPO_PUBLIC_OXY_CLIENT_ID}
            authRedirectUri={Platform.OS !== 'web' ? AUTH_REDIRECT_URI : undefined}
            language={{
              supportedLocales: SUPPORTED_LOCALES,
              fallbackLocale: DEFAULT_LOCALE,
              onChange: (locale) => useI18nStore.getState().setLocale(locale),
              onError: (error, locale) =>
                console.error('Failed to follow the Oxy-resolved language', error, locale),
            }}
          >
            <AppContent />
          </OxyProvider>
        </QueryClientProvider>
      </AppErrorBoundary>
    </BloomProvider>
  );
}

export default RootLayout;
