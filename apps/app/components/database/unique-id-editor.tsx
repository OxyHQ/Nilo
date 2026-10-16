import * as React from 'react';
import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useUpdateProperty } from '@/lib/hooks/use-database-properties';
import type { DatabaseProperty } from '@/lib/types/databases';

export function UniqueIdEditor({
  databaseId,
  property,
  onDone,
}: {
  databaseId: string;
  property: DatabaseProperty;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [prefix, setPrefix] = React.useState(property.config?.prefix ?? '');
  const update = useUpdateProperty();
  const valid = /^[a-zA-Z0-9]{0,12}$/.test(prefix);
  return (
    <View className="gap-3">
      <Text variant="body-regular">{t('databases.uniqueId.prefix')}</Text>
      <TextFieldInput
        label={t('databases.uniqueId.prefix')}
        placeholder={null}
        maxLength={12}
        value={prefix}
        onChangeText={setPrefix}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {!valid ? (
        <Text accessibilityRole="alert" className="text-base text-destructive">
          {t('databases.uniqueId.invalid')}
        </Text>
      ) : null}
      {update.isError ? (
        <Text accessibilityRole="alert" className="text-base text-destructive">
          {t('databases.formula.saveFailed')}
        </Text>
      ) : null}
      <Button
        appearance="solid"
        tone="accent"
        disabled={!valid || update.isPending}
        onPress={() =>
          update.mutate(
            { databaseId, propertyId: property.id, config: { ...property.config, prefix } },
            { onSuccess: onDone },
          )
        }
      >
        {t('common.save')}
      </Button>
    </View>
  );
}
