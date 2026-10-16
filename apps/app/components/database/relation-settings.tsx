import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { RadioGroup } from '@oxy.so/bloom/radio';
import { confirm } from '@oxy.so/bloom/surfaces';
import { Switch } from '@oxy.so/bloom/switch';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useDatabases } from '@/lib/hooks/use-databases';
import { useAddProperty, useUpdateProperty } from '@/lib/hooks/use-database-properties';
import type { Database, DatabaseProperty } from '@/lib/types/databases';

export function RelationSettings({
  database,
  property,
  onDone,
}: {
  database: Database;
  property?: DatabaseProperty;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const databases = useDatabases(database.workspaceId);
  const add = useAddProperty();
  const update = useUpdateProperty();
  const [target, setTarget] = useState(property?.config?.targetDatabaseId ?? database.id);
  const [twoWay, setTwoWay] = useState(property?.config?.twoWay === true);
  const choices = [
    database,
    ...(databases.data?.databases ?? []).filter((d) => d.id !== database.id),
  ];
  const targetName = choices.find((d) => d.id === target)?.name || t('databases.untitledDatabase');
  const pending = add.isPending || update.isPending;
  const save = async () => {
    try {
      const config = { targetDatabaseId: target, twoWay };
      if (property)
        await update.mutateAsync({ databaseId: database.id, propertyId: property.id, config });
      else
        await add.mutateAsync({
          databaseId: database.id,
          name: t('databases.propertyTypes.relation'),
          type: 'relation',
          config,
        });
      onDone();
    } catch {
      /* Mutation state renders the error and preserves the draft. */
    }
  };
  // Removing the reciprocal deletes the other database's property and links.
  const confirmRemoval = () =>
    confirm({
      title: t('databases.relations.removeTitle'),
      description: t('databases.relations.removeDescription'),
      confirmLabel: t('common.confirm'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
  return (
    <View className="gap-3">
      <Text variant="body-semibold">{t('databases.relations.target')}</Text>
      <ScrollView style={{ maxHeight: 240 }}>
        <RadioGroup
          label={t('databases.relations.target')}
          value={target}
          disabled={pending}
          onValueChange={setTarget}
          options={choices.map((choice) => ({
            value: choice.id,
            label: choice.name || t('databases.untitledDatabase'),
          }))}
        />
      </ScrollView>
      <View className="flex-row items-center justify-between gap-2">
        <Text variant="body-regular">
          {t('databases.relations.showOn', { database: targetName })}
        </Text>
        <Switch
          checked={twoWay}
          disabled={pending}
          accessibilityLabel={t('databases.relations.showOn', { database: targetName })}
          onCheckedChange={async (next) => {
            if (!next && property?.config?.twoWay) {
              if (await confirmRemoval()) setTwoWay(false);
            } else setTwoWay(next);
          }}
        />
      </View>
      <Text className="text-xs text-muted-foreground">{t('databases.relations.explanation')}</Text>
      {add.isError || update.isError ? (
        <Text accessibilityRole="alert" className="text-sm text-destructive">
          {t('databases.relations.failed')}
        </Text>
      ) : null}
      <Button
        appearance="solid"
        tone="accent"
        disabled={pending || !target}
        accessibilityLabel={t('common.save')}
        onPress={async () => {
          if (property?.config?.twoWay && target !== property.config.targetDatabaseId) {
            if (await confirmRemoval()) await save();
          } else void save();
        }}
      >
        {t('common.save')}
      </Button>
    </View>
  );
}
