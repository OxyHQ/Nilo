import type React from 'react';
import { ScrollView, View } from 'react-native';
import { ErrorBoundary } from '@oxy.so/bloom/error-boundary';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Text } from '@oxy.so/bloom/typography';
import { MONO_FONT_FAMILY } from '@/lib/fonts';
import i18n from '@/lib/i18n';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional fallback component. If not provided, the default error screen is used. */
  fallback?: React.ComponentType<{ error: Error; resetError: () => void }>;
}

/** Reports a caught error to Sentry when it is installed. */
function reportError(error: Error, errorInfo: React.ErrorInfo) {
  try {
    const Sentry = require('@sentry/react-native');
    Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: errorInfo.componentStack ?? undefined,
        },
      },
    });
  } catch {
    // Sentry not installed — skip
  }

  if (__DEV__) {
    console.error('AppErrorBoundary caught an error:', error, errorInfo);
  }
}

/**
 * A reusable error boundary that catches JavaScript errors in its child
 * component tree, reports them to Sentry, and displays a user-friendly
 * recovery screen. Bloom's boundary owns the catch and the reset; the root
 * layout mounts `BloomProvider` above it, so the fallback can read the theme.
 */
export function AppErrorBoundary({ children, fallback: Fallback }: ErrorBoundaryProps) {
  return (
    <ErrorBoundary
      onError={reportError}
      fallback={({ error, retry }) =>
        Fallback ? (
          <Fallback error={error} resetError={retry} />
        ) : (
          <ErrorFallback error={error} resetError={retry} />
        )
      }
    >
      {children}
    </ErrorBoundary>
  );
}

/** Default full-screen error fallback UI. */
function ErrorFallback({ error, resetError }: { error: Error; resetError: () => void }) {
  return (
    <View className="flex-1 items-center justify-center bg-background p-6">
      <View className="w-full max-w-[400px]">
        <EmptyState
          // icon: AlertTriangle
          title={i18n.t('errors.boundary.title')}
          description={i18n.t('errors.boundary.description')}
          action={{ label: i18n.t('common.tryAgain'), onPress: resetError }}
        >
          {/* Error details (dev only) */}
          {__DEV__ ? (
            <ScrollView className="max-h-[120px] w-full rounded-lg bg-muted p-3">
              <Text
                className="text-xs text-muted-foreground web:select-text"
                style={{ fontFamily: MONO_FONT_FAMILY }}
                selectable
              >
                {error.message}
              </Text>
            </ScrollView>
          ) : null}
        </EmptyState>
      </View>
    </View>
  );
}
