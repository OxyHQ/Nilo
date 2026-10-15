import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from '@/hooks/useTranslation';
import type { FormDraft, FormField } from '@/lib/forms';

export function FormFields({
  fields,
  draft,
  onChange,
  errors = {},
  disabled = false,
}: {
  fields: FormField[];
  draft: FormDraft;
  onChange: (draft: FormDraft) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-5">
      {fields.map((field) => {
        const label = field.required
          ? t('databases.form.requiredLabel', { name: field.name })
          : field.name;
        const value = draft[field.id];
        const set = (next: string | string[] | boolean) => onChange({ ...draft, [field.id]: next });
        return (
          <View key={field.id} className="gap-2">
            <Text className="font-medium">{label}</Text>
            {field.type === 'checkbox' ? (
              <Switch
                value={value === true}
                onValueChange={set}
                disabled={disabled}
                accessibilityLabel={label}
              />
            ) : ['select', 'status', 'multi_select'].includes(field.type) ? (
              <View className="flex-row flex-wrap gap-2">
                {field.options?.map((option) => {
                  const multi = field.type === 'multi_select';
                  const selected = multi
                    ? Array.isArray(value) && value.includes(option.id)
                    : value === option.id;
                  return (
                    <Button
                      key={option.id}
                      size="sm"
                      variant={selected ? 'default' : 'outline'}
                      disabled={disabled}
                      role={multi ? 'checkbox' : 'radio'}
                      accessibilityRole={multi ? 'checkbox' : 'radio'}
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={option.name}
                      onPress={() =>
                        set(
                          multi
                            ? selected
                              ? (Array.isArray(value) ? value : []).filter((id) => id !== option.id)
                              : [...(Array.isArray(value) ? value : []), option.id]
                            : selected
                              ? ''
                              : option.id,
                        )
                      }
                    >
                      <Text>{option.name}</Text>
                    </Button>
                  );
                })}
              </View>
            ) : (
              <Input
                value={typeof value === 'string' ? value : ''}
                onChangeText={set}
                editable={!disabled}
                accessibilityLabel={label}
                autoCapitalize={['email', 'url'].includes(field.type) ? 'none' : 'sentences'}
                keyboardType={
                  field.type === 'number'
                    ? 'decimal-pad'
                    : field.type === 'email'
                      ? 'email-address'
                      : field.type === 'phone'
                        ? 'phone-pad'
                        : field.type === 'url'
                          ? 'url'
                          : 'default'
                }
                placeholder={field.type === 'date' ? t('pages.reminders.dateFormat') : undefined}
              />
            )}
            {field.type === 'date' ? (
              <>
                <Input
                  value={String(draft[`${field.id}:time`] ?? '')}
                  editable={!disabled}
                  autoCapitalize="none"
                  onChangeText={(time) => onChange({ ...draft, [`${field.id}:time`]: time })}
                  accessibilityLabel={t('databases.form.timeFor', { name: field.name })}
                  placeholder={t('databases.form.optionalTime')}
                />
                <Text className="text-xs text-muted-foreground">
                  {t('pages.reminders.localTime')}
                </Text>
              </>
            ) : null}
            {errors[field.id] ? (
              <Text accessibilityRole="alert" className="text-sm text-destructive">
                {t(`databases.form.${errors[field.id]}`, { name: field.name })}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
