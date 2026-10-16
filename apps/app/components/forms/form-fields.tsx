import { View } from 'react-native';
import { Chip } from '@oxy.so/bloom/chip';
import { Switch } from '@oxy.so/bloom/switch';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
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
            <Text variant="headline-medium">{label}</Text>
            {field.type === 'checkbox' ? (
              <Switch
                checked={value === true}
                onCheckedChange={set}
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
                    <Chip
                      key={option.id}
                      size="sm"
                      selected={selected}
                      disabled={disabled}
                      role={multi ? 'checkbox' : 'radio'}
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
                      {option.name}
                    </Chip>
                  );
                })}
              </View>
            ) : (
              <TextFieldInput
                label={label}
                value={typeof value === 'string' ? value : ''}
                onChangeText={set}
                editable={!disabled}
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
                // `null`, not `undefined`: Bloom shows the label as the placeholder otherwise.
                placeholder={field.type === 'date' ? t('pages.reminders.dateFormat') : null}
              />
            )}
            {field.type === 'date' ? (
              <>
                <TextFieldInput
                  label={t('databases.form.timeFor', { name: field.name })}
                  value={String(draft[`${field.id}:time`] ?? '')}
                  editable={!disabled}
                  autoCapitalize="none"
                  onChangeText={(time) => onChange({ ...draft, [`${field.id}:time`]: time })}
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
