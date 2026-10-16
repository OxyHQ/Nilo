import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Textarea } from '@oxy.so/bloom/textarea';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useCreateReminder } from '@/lib/hooks/use-page-extras';
import {
  parseReminderTime,
  reminderFields,
  reminderQuickChoice,
  type ReminderChoice,
} from '@/lib/reminder-time';
import { ReminderList } from './reminder-list';

export function ReminderDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [fields, setFields] = useState(() => reminderFields(reminderQuickChoice('hour')));
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState(false);
  const create = useCreateReminder(pageId);
  const control = useDialogControl();
  // The parent mounts this only while it is open; `onClose` fires after the exit.
  useEffect(() => {
    control.open();
  }, [control]);
  const choices: ReminderChoice[] = ['hour', 'tomorrow', 'week'];
  const save = () => {
    if (create.isPending) return;
    const time = parseReminderTime(fields.date, fields.time);
    if (!time) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    create.mutate(
      { remindAt: time.toISOString(), ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: () => {
          toast.success(t('pages.reminders.created'));
          setNote('');
        },
        onError: () => toast.error(t('pages.reminders.createFailed')),
      },
    );
  };
  return (
    <Dialog
      control={control}
      onClose={onClose}
      placement={{ base: 'bottom', md: 'center' }}
      title={t('pages.reminders.title')}
      description={t('pages.reminders.description')}
    >
      <View className="gap-4">
        <View className="flex-row flex-wrap gap-2">
          {choices.map((choice) => (
            <Button
              key={choice}
              appearance="outline"
              size="sm"
              onPress={() => {
                setFields(reminderFields(reminderQuickChoice(choice)));
                setInvalid(false);
              }}
              accessibilityLabel={t(`pages.reminders.choices.${choice}`)}
            >
              {t(`pages.reminders.choices.${choice}`)}
            </Button>
          ))}
        </View>
        <View className="gap-2">
          <Text variant="body-medium">{t('pages.reminders.date')}</Text>
          <TextFieldInput
            label={t('pages.reminders.date')}
            value={fields.date}
            onChangeText={(date) => setFields((old) => ({ ...old, date }))}
            placeholder={t('pages.reminders.dateFormat')}
            autoCapitalize="none"
          />
          <Text variant="body-medium">{t('pages.reminders.time')}</Text>
          <TextFieldInput
            label={t('pages.reminders.time')}
            value={fields.time}
            onChangeText={(time) => setFields((old) => ({ ...old, time }))}
            placeholder={t('pages.reminders.timeFormat')}
            autoCapitalize="none"
            onSubmitEditing={save}
          />
          <Text className="text-xs text-muted-foreground">{t('pages.reminders.localTime')}</Text>
          {invalid ? (
            <Text accessibilityRole="alert" className="text-sm text-destructive">
              {t('pages.reminders.invalid')}
            </Text>
          ) : null}
          <Textarea
            label={t('pages.reminders.note')}
            maxLength={500}
            value={note}
            onChangeText={setNote}
          />
        </View>
        <Button
          disabled={create.isPending}
          onPress={save}
          accessibilityLabel={t('pages.reminders.save')}
        >
          {t('pages.reminders.save')}
        </Button>
        <ReminderList pageId={pageId} />
      </View>
    </Dialog>
  );
}
