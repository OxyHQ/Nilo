import { queryKeys } from './query-keys';
/**
 * useNotificationSetup — Push notification registration, foreground handling,
 * tap deep-linking, and real-time Socket.IO notification subscription.
 *
 * Call once in the authenticated app layout.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services/ui/client';
import { acquireSocket, releaseSocket } from '@/lib/realtime/socket';
import { useRouter } from 'expo-router';
import { isPushDisabled, registerPush } from '@/lib/push-registration';
import { invalidatePageAccess } from './use-page-permissions';

export function useNotificationSetup() {
  const { user, isAuthenticated } = useOxy();
  const router = useRouter();
  const queryClient = useQueryClient();

  // ── Foreground notification display (once, native only) ────────
  useEffect(() => {
    if (Platform.OS === 'web') return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  }, []);

  // ── Push registration (an Expo token, or Web Push in a browser) ──
  // Each account that signs in registers this device, unless push was
  // turned off on it (`lib/push-registration.ts`).
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    let cancelled = false;
    void (async () => {
      if ((await isPushDisabled()) || cancelled) return;
      await registerPush().catch(() => false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.id]);

  // ── Notification tap handler ─────────────────────────────────
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (!isAuthenticated) return;
      const pageId = response.notification.request.content.data?.pageId;
      if (typeof pageId === 'string') {
        const blockId = response.notification.request.content.data?.blockId;
        router.push({
          pathname: '/(app)/p/[pageId]',
          params: {
            pageId,
            ...(typeof blockId === 'string' ? { blockId } : {}),
            ...(typeof response.notification.request.content.data?.commentId === 'string'
              ? { comments: 'open' }
              : {}),
          },
        });
      }
    });

    return () => subscription.remove();
  }, [isAuthenticated, router]);

  // ── Socket.IO real-time notification subscription ──────────────
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    const socket = acquireSocket();
    const onNotification = () => {
      // Invalidate React Query caches so notification list + unread count refresh
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.reminders.all });
      void invalidatePageAccess(queryClient);
    };
    socket.on('notification', onNotification);

    return () => {
      socket.off('notification', onNotification);
      releaseSocket();
    };
  }, [isAuthenticated, user?.id, queryClient]);
}
