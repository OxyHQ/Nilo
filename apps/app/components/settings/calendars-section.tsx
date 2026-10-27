import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { isAxiosError } from 'axios';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CalendarSubscription, CalendarSubscriptionList } from '@oxy.so/nilo-contracts';
import { Button } from '@oxy.so/bloom/button';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiRefreshLine } from '@oxy.so/bloom/icons/RiRefreshLine';
import { SettingsCard, SettingsRow, SettingsSection } from '@oxy.so/bloom/settings-modal/modal';
import { confirm } from '@oxy.so/bloom/surfaces';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { toast } from '@oxy.so/bloom/toast';
import { useTranslation } from '@/hooks/useTranslation';
import apiClient from '@/lib/api/client';
import { useAuthQuery } from '@/lib/hooks/create-query';
import { queryKeys } from '@/lib/hooks/query-keys';
import { useNiloSettings } from './settings-provider';

/** What Nilo said went wrong, or null when the answer was not Nilo's. */
function serverMessage(error: unknown): string | null {
  if (!isAxiosError<{ error?: { message?: string } }>(error)) return null;
  return error.response?.data?.error?.message ?? null;
}

const deviceTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Calendars from Google, Outlook or iCloud, subscribed by their secret iCal
 * address: Nilo keeps a read-only copy of each up to date.
 */
export function CalendarsSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const subscriptions = useAuthQuery<CalendarSubscriptionList>(
    queryKeys.calendarSubscriptions.all,
    '/calendar/subscriptions',
    undefined,
    { staleTime: 30_000 },
  );
  const changed = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.calendarSubscriptions.all });
    void queryClient.invalidateQueries({ queryKey: ['databases'] });
  };
  const subscribe = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<CalendarSubscription>(
        '/calendar/subscriptions',
        {
          url: url.trim(),
          ...(name.trim() && { name: name.trim() }),
          timeZone: deviceTimeZone(),
        },
        { timeout: 60_000 },
      );
      return res.data;
    },
    onSuccess: (subscription) => {
      toast.success(t('settings.calendars.subscribed', { name: subscription.name }));
      setUrl('');
      setName('');
      changed();
    },
    onError: (error) => toast.error(serverMessage(error) ?? t('settings.calendars.failed')),
  });
  const items = subscriptions.data?.items ?? [];
  return (
    <View className="gap-6">
      <SettingsSection
        label={t('settings.calendars.addTitle')}
        description={t('settings.calendars.description')}
      >
        <View className="gap-3">
          <TextFieldInput
            label={t('settings.calendars.urlLabel')}
            placeholder={t('settings.calendars.urlPlaceholder')}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TextFieldInput
            label={t('settings.calendars.nameLabel')}
            placeholder={t('settings.calendars.namePlaceholder')}
            value={name}
            onChangeText={setName}
          />
          <View className="flex-row">
            <Button
              tone="action"
              size="sm"
              leadingIcon={RiAddLine}
              accessibilityLabel={t('settings.calendars.subscribe')}
              loading={subscribe.isPending}
              disabled={url.trim() === ''}
              onPress={() => subscribe.mutate()}
            >
              {t('settings.calendars.subscribe')}
            </Button>
          </View>
        </View>
      </SettingsSection>
      <SettingsSection
        label={t('settings.calendars.listTitle')}
        description={t('settings.calendars.where')}
      >
        <SettingsCard>
          {items.length === 0 ? (
            <SettingsRow
              label={subscriptions.isLoading ? t('common.loading') : t('settings.calendars.empty')}
            />
          ) : (
            items.map((subscription) => (
              <SubscriptionRow
                key={subscription.id}
                subscription={subscription}
                onChanged={changed}
              />
            ))
          )}
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}

function SubscriptionRow({
  subscription,
  onChanged,
}: {
  subscription: CalendarSubscription;
  onChanged: () => void;
}) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const { close } = useNiloSettings();
  const refresh = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<CalendarSubscription>(
          `/calendar/subscriptions/${subscription.id}/refresh`,
          undefined,
          { timeout: 60_000 },
        )
      ).data,
    onSuccess: (next) => {
      if (next.status === 'failing') toast.error(statusText(next));
      onChanged();
    },
    onError: (error) => toast.error(serverMessage(error) ?? t('common.error')),
  });
  const remove = async () => {
    const confirmed = await confirm({
      title: t('settings.calendars.removeTitle', { name: subscription.name }),
      description: t('settings.calendars.removeDescription', { host: subscription.host }),
      confirmLabel: t('settings.calendars.remove'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await apiClient.delete(`/calendar/subscriptions/${subscription.id}`);
      onChanged();
    } catch (error) {
      toast.error(serverMessage(error) ?? t('common.error'));
    }
  };
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  function statusText(s: CalendarSubscription): string {
    if (s.status === 'failing') {
      return t('settings.calendars.status.failing', {
        reason: t(`settings.calendars.errors.${s.lastError ?? 'internal'}`),
      });
    }
    if (s.status === 'pending' || !s.lastSuccessAt) return t('settings.calendars.status.pending');
    return t('settings.calendars.status.ok', { when: when(s.lastSuccessAt) });
  }
  return (
    <SettingsRow
      label={subscription.name}
      description={[
        subscription.host,
        t('settings.calendars.events', { count: subscription.eventCount }),
        statusText(subscription),
      ].join(' · ')}
    >
      <View className="flex-row items-center gap-1">
        <Button
          appearance="plain"
          tone="neutral"
          size="sm"
          accessibilityRole="link"
          accessibilityLabel={t('settings.calendars.openLabel', { name: subscription.name })}
          onPress={() => {
            close();
            router.push(`/db/${subscription.calendarId}`);
          }}
        >
          {t('settings.calendars.open')}
        </Button>
        <Button
          appearance="plain"
          tone="neutral"
          size="sm"
          iconOnly
          icon={RiRefreshLine}
          loading={refresh.isPending}
          accessibilityLabel={t('settings.calendars.refreshLabel', { name: subscription.name })}
          onPress={() => refresh.mutate()}
        />
        <Button
          appearance="outline"
          tone="danger"
          size="sm"
          accessibilityLabel={t('settings.calendars.removeLabel', { name: subscription.name })}
          onPress={() => {
            void remove();
          }}
        >
          {t('settings.calendars.remove')}
        </Button>
      </View>
    </SettingsRow>
  );
}
