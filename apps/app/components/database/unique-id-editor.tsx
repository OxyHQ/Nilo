import * as React from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
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
      <Text>{t('databases.uniqueId.prefix')}</Text>
      <Input
        maxLength={12}
        value={prefix}
        onChangeText={setPrefix}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={t('databases.uniqueId.prefix')}
      />
      {!valid ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {t('databases.uniqueId.invalid')}
        </Text>
      ) : null}
      {update.isError ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {t('databases.formula.saveFailed')}
        </Text>
      ) : null}
      <Button
        disabled={!valid || update.isPending}
        onPress={() =>
          update.mutate(
            { databaseId, propertyId: property.id, config: { ...property.config, prefix } },
            { onSuccess: onDone },
          )
        }
      >
        <Text>{t('common.save')}</Text>
      </Button>
    </View>
  );
}
