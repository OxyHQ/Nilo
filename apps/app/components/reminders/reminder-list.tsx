import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, LinkButton } from '@oxy.so/bloom/button';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useReminders, useDeleteReminder } from '@/lib/hooks/use-page-extras';

export function ReminderList({ pageId }: { pageId?: string }) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const query = useReminders(pageId);
  const remove = useDeleteReminder();
  return (
    <View className="gap-3">
      <Text accessibilityRole="header" variant="headline-semibold">
        {t('pages.reminders.upcoming')}
      </Text>
      {query.isLoading ? (
        <Loading variant="spinner" size="sm" accessibilityLabel={t('common.loading')} />
      ) : query.isError ? (
        <View className="gap-2">
          <Text accessibilityRole="alert" variant="body-regular">
            {t('pages.reminders.loadFailed')}
          </Text>
          <Button appearance="outline" onPress={() => query.refetch()}>
            {t('pages.publish.retry')}
          </Button>
        </View>
      ) : null}
      {query.data?.reminders.length === 0 ? (
        <EmptyState
          variant="compact"
          // icon: BellOff
          title={t('pages.reminders.empty')}
        />
      ) : null}
      {query.data?.reminders.map((reminder) => (
        <View key={reminder.id} className="rounded-xl border border-border p-3 gap-2">
          {!pageId ? (
            <LinkButton
              className="self-start"
              onPress={() =>
                router.push({
                  pathname: '/p/[pageId]',
                  params: {
                    pageId: reminder.pageId,
                    ...(reminder.blockId ? { blockId: reminder.blockId } : {}),
                  },
                })
              }
              accessibilityLabel={t('pages.openPage', {
                title: reminder.page?.title || t('pages.untitled'),
              })}
            >
              {reminder.page?.title || t('pages.untitled')}
            </LinkButton>
          ) : null}
          <Text variant="body-regular">{new Date(reminder.remindAt).toLocaleString(locale)}</Text>
          {reminder.note ? <Text variant="body-regular">{reminder.note}</Text> : null}
          {reminder.sentAt ? (
            <Text className="text-sm text-muted-foreground">{t('pages.reminders.sent')}</Text>
          ) : null}
          <Button
            appearance="subtle"
            size="sm"
            disabled={remove.isPending}
            onPress={() =>
              remove.mutate(reminder.id, {
                onError: () => toast.error(t('pages.reminders.deleteFailed')),
              })
            }
            accessibilityLabel={t('pages.reminders.delete')}
          >
            {t('pages.reminders.delete')}
          </Button>
        </View>
      ))}
    </View>
  );
}
