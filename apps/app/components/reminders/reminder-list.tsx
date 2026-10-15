import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { useReminders, useDeleteReminder } from '@/lib/hooks/use-page-extras';

export function ReminderList({ pageId }: { pageId?: string }) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const query = useReminders(pageId);
  const remove = useDeleteReminder();
  return (
    <View className="gap-3">
      <Text accessibilityRole="header" className="font-semibold">
        {t('pages.reminders.upcoming')}
      </Text>
      {query.isLoading ? (
        <ActivityIndicator accessibilityLabel={t('common.loading')} />
      ) : query.isError ? (
        <View className="gap-2">
          <Text accessibilityRole="alert">{t('pages.reminders.loadFailed')}</Text>
          <Button variant="outline" onPress={() => query.refetch()}>
            <Text>{t('pages.publish.retry')}</Text>
          </Button>
        </View>
      ) : null}
      {query.data?.reminders.length === 0 ? (
        <Text className="text-sm text-muted-foreground">{t('pages.reminders.empty')}</Text>
      ) : null}
      {query.data?.reminders.map((reminder) => (
        <View key={reminder.id} className="rounded-xl border border-border p-3 gap-2">
          {!pageId ? (
            <Button
              variant="link"
              className="justify-start"
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
              <Text>{reminder.page?.title || t('pages.untitled')}</Text>
            </Button>
          ) : null}
          <Text>{new Date(reminder.remindAt).toLocaleString(locale)}</Text>
          {reminder.note ? <Text>{reminder.note}</Text> : null}
          {reminder.sentAt ? (
            <Text className="text-sm text-muted-foreground">{t('pages.reminders.sent')}</Text>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={remove.isPending}
            onPress={() =>
              remove.mutate(reminder.id, {
                onError: () => toast.error(t('pages.reminders.deleteFailed')),
              })
            }
            accessibilityLabel={t('pages.reminders.delete')}
          >
            <Text>{t('pages.reminders.delete')}</Text>
          </Button>
        </View>
      ))}
    </View>
  );
}
