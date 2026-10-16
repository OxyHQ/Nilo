import { PageEditedNotification } from '@/components/sharing/page-edited-notification';
import { ReminderList } from '@/components/reminders/reminder-list';
import { PageSharedNotification } from '@/components/sharing/page-shared-notification';
import { View, ScrollView, Pressable, Platform } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';
import { Switch } from '@oxy.so/bloom/switch';
import { Text } from '@oxy.so/bloom/typography';
import { useRouter } from 'expo-router';
import { Pencil, Bell, BellOff, CheckCheck, MessageSquare, UserPlus, X } from 'lucide-react-native';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@oxy.so/services';
import * as ExpoNotifications from 'expo-notifications';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import i18n from '@/lib/i18n';
import {
  useNotifications,
  useMarkAsRead,
  useMarkAllAsRead,
  useDismissNotification,
  type Notification,
} from '@/lib/hooks/use-notifications';

const TYPE_ICONS: Record<Notification['type'], typeof MessageSquare> = {
  page_edited: Pencil,
  page_shared: UserPlus,
  reminder: Bell,
  mention: MessageSquare,
  comment_reply: MessageSquare,
  page_comment: MessageSquare,
};

const PRIORITY_COLORS: Record<Notification['priority'], string> = {
  urgent: 'border-l-red-500',
  high: 'border-l-orange-400',
  normal: 'border-l-blue-400',
  low: 'border-l-muted-foreground',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return i18n.t('notifications.time.justNow');
  if (minutes < 60) return i18n.t('notifications.time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t('notifications.time.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return i18n.t('notifications.time.daysAgo', { count: days });
}

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useColorScheme();
  const { isAuthenticated } = useAuth();

  const [pushEnabled, setPushEnabled] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<string | null>(null);
  const [pushLoading, setPushLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const { data, isLoading } = useNotifications();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const dismiss = useDismissNotification();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/(app)');
    }
  }, [isAuthenticated, router]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a mount-only permission check; checkPermissions is recreated every render and sets state, so depending on it would re-run it on every render
  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    if (Platform.OS === 'web') {
      setPermissionStatus('unavailable');
      setPushLoading(false);
      return;
    }
    try {
      const { status } = await ExpoNotifications.getPermissionsAsync();
      setPermissionStatus(status);
      setPushEnabled(status === 'granted');
    } catch (_error: unknown) {
      setPermissionStatus('unavailable');
    } finally {
      setPushLoading(false);
    }
  };

  const handleTogglePush = async (value: boolean) => {
    if (Platform.OS === 'web') return;
    if (value) {
      const { status } = await ExpoNotifications.requestPermissionsAsync();
      setPermissionStatus(status);
      setPushEnabled(status === 'granted');
    } else {
      setPushEnabled(false);
    }
  };

  const handleNotificationPress = useCallback(
    (notification: Notification) => {
      const pageId = notification.data?.pageId;
      const blockId = notification.data?.blockId;
      if (typeof pageId === 'string')
        router.push({
          pathname: '/p/[pageId]',
          params: {
            pageId,
            ...(typeof blockId === 'string' ? { blockId } : {}),
            ...(['page_comment', 'comment_reply'].includes(notification.type)
              ? { comments: 'open' }
              : {}),
          },
        });
      if (notification.status !== 'read') {
        markAsRead.mutate(notification.id);
      }
    },
    [markAsRead, router],
  );

  const notifications = data?.notifications || [];
  const unreadCount = data?.unreadCount || 0;

  const StatusIcon = pushEnabled ? Bell : BellOff;

  return (
    <View className="flex-1 bg-background">
      <PageHeader
        presentation="bar"
        border="always"
        // The app layout already pads this route below the status bar.
        safeArea={false}
        onBack={() => router.back()}
        backLabel={t('common.back')}
        title={t('notifications.title')}
        subtitle={unreadCount > 0 ? t('notifications.unread', { count: unreadCount }) : undefined}
        actions={
          <View className="flex-row items-center gap-2">
            {unreadCount > 0 && (
              <Button
                appearance="subtle"
                size="sm"
                onPress={() => markAllAsRead.mutate()}
                renderLeadingIcon={({ size, color }) => <CheckCheck size={size} color={color} />}
              >
                {t('notifications.markAllRead')}
              </Button>
            )}
            <Button
              appearance="subtle"
              iconOnly
              pressed={showSettings}
              accessibilityLabel={t('notifications.pushNotifications')}
              onPress={() => setShowSettings((s) => !s)}
              renderLeadingIcon={({ size, color }) => <Bell size={size} color={color} />}
            />
          </View>
        }
      />

      <ScrollView className="flex-1">
        {/* Push Settings (collapsible) */}
        {showSettings && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
            <View className="px-6 py-4 border-b border-border">
              <SettingsListGroup>
                <SettingsListItem
                  icon={<StatusIcon size={20} color={colors.mutedForeground} />}
                  title={t('notifications.pushNotifications')}
                  description={t('notifications.pushDescription')}
                  rightElement={
                    <Switch
                      checked={pushEnabled}
                      onCheckedChange={handleTogglePush}
                      disabled={pushLoading}
                      accessibilityLabel={t('notifications.pushNotifications')}
                    />
                  }
                />
              </SettingsListGroup>
              {permissionStatus === 'denied' && (
                <View className="mt-3 p-3 rounded-lg bg-muted">
                  <Text className="text-xs text-muted-foreground">
                    {t('notifications.permissionDenied')}
                  </Text>
                </View>
              )}
            </View>
          </Animated.View>
        )}

        <View className="p-6 border-b border-border">
          <ReminderList />
        </View>

        {/* Notification Feed */}
        {isLoading ? (
          <View className="items-center justify-center py-12">
            <Loading variant="spinner" text={t('common.loading')} />
          </View>
        ) : notifications.length === 0 ? (
          <View className="px-6">
            <EmptyState
              // icon: Bell
              title={t('notifications.emptyTitle')}
              description={t('notifications.emptyBody')}
            />
          </View>
        ) : (
          <View className="py-2">
            {notifications.map((notification) => {
              const Icon = TYPE_ICONS[notification.type] || Bell;
              const isUnread =
                notification.status !== 'read' && notification.status !== 'dismissed';
              const priorityBorder =
                PRIORITY_COLORS[notification.priority] || PRIORITY_COLORS.normal;

              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('notifications.open')}
                  key={notification.id}
                  onPress={() => handleNotificationPress(notification)}
                  className={`px-6 py-4 border-b border-border border-l-2 ${priorityBorder} ${isUnread ? 'bg-muted/20' : ''} active:bg-muted/40`}
                >
                  <View className="flex-row items-start gap-3">
                    <View className={`mt-0.5 ${isUnread ? 'opacity-100' : 'opacity-50'}`}>
                      <Icon size={16} className="text-muted-foreground" />
                    </View>
                    <View className="flex-1">
                      <View className="flex-row items-center justify-between mb-1">
                        {notification.type === 'page_edited' ? (
                          <PageEditedNotification notification={notification} />
                        ) : notification.type === 'page_shared' ? (
                          <PageSharedNotification notification={notification} />
                        ) : (
                          <Text
                            className={`text-sm ${isUnread ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground'}`}
                            numberOfLines={1}
                          >
                            {notification.type === 'reminder'
                              ? t('notifications.reminder')
                              : notification.title}
                          </Text>
                        )}
                        <View className="flex-row items-center gap-2">
                          <Text className="text-xs text-muted-foreground">
                            {timeAgo(notification.createdAt)}
                          </Text>
                          {/* Not `CloseButton`: it cannot stop the press reaching the row. */}
                          <Button
                            appearance="plain"
                            size="xs"
                            iconOnly
                            stopPropagation
                            onPress={() => dismiss.mutate(notification.id)}
                            accessibilityLabel={t('notifications.dismiss')}
                            hitSlop={8}
                            renderLeadingIcon={({ size, color }) => <X size={size} color={color} />}
                          />
                        </View>
                      </View>
                      <Text className="text-xs text-muted-foreground" numberOfLines={3}>
                        {notification.body}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
