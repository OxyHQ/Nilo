import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { toast } from '@oxy.so/bloom/toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pages.reminders.title')}</DialogTitle>
          <DialogDescription>{t('pages.reminders.description')}</DialogDescription>
        </DialogHeader>
        <ScrollView
          style={{ maxHeight: 540, flexShrink: 1 }}
          contentContainerClassName="gap-4"
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-row flex-wrap gap-2">
            {choices.map((choice) => (
              <Button
                key={choice}
                variant="outline"
                size="sm"
                onPress={() => {
                  setFields(reminderFields(reminderQuickChoice(choice)));
                  setInvalid(false);
                }}
                accessibilityLabel={t(`pages.reminders.choices.${choice}`)}
              >
                <Text>{t(`pages.reminders.choices.${choice}`)}</Text>
              </Button>
            ))}
          </View>
          <View className="gap-2">
            <Text>{t('pages.reminders.date')}</Text>
            <Input
              value={fields.date}
              onChangeText={(date) => setFields((old) => ({ ...old, date }))}
              placeholder={t('pages.reminders.dateFormat')}
              accessibilityLabel={t('pages.reminders.date')}
              autoCapitalize="none"
            />
            <Text>{t('pages.reminders.time')}</Text>
            <Input
              value={fields.time}
              onChangeText={(time) => setFields((old) => ({ ...old, time }))}
              placeholder={t('pages.reminders.timeFormat')}
              accessibilityLabel={t('pages.reminders.time')}
              autoCapitalize="none"
              onSubmitEditing={save}
            />
            <Text className="text-xs text-muted-foreground">{t('pages.reminders.localTime')}</Text>
            {invalid ? (
              <Text accessibilityRole="alert" className="text-sm text-destructive">
                {t('pages.reminders.invalid')}
              </Text>
            ) : null}
            <Text>{t('pages.reminders.note')}</Text>
            <Textarea
              maxLength={500}
              value={note}
              onChangeText={setNote}
              accessibilityLabel={t('pages.reminders.note')}
            />
          </View>
          <Button
            disabled={create.isPending}
            onPress={save}
            accessibilityLabel={t('pages.reminders.save')}
          >
            <Text>{t('pages.reminders.save')}</Text>
          </Button>
          <ReminderList pageId={pageId} />
        </ScrollView>
      </DialogContent>
    </Dialog>
  );
}
