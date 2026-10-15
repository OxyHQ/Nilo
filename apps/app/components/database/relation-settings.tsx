import { useState } from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
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
  const [confirm, setConfirm] = useState<'disable' | 'retarget' | null>(null);
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
  return (
    <View className="gap-3">
      <Text className="text-sm font-semibold text-foreground">
        {t('databases.relations.target')}
      </Text>
      <ScrollView style={{ maxHeight: 240 }}>
        {choices.map((choice) => (
          <Pressable
            key={choice.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: target === choice.id, disabled: pending }}
            accessibilityLabel={choice.name || t('databases.untitledDatabase')}
            disabled={pending}
            onPress={() => {
              setTarget(choice.id);
            }}
            className={`rounded p-2 ${target === choice.id ? 'bg-accent' : 'bg-muted'}`}
          >
            <Text className="text-sm text-foreground">
              {choice.name || t('databases.untitledDatabase')}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-sm text-foreground">
          {t('databases.relations.showOn', { database: targetName })}
        </Text>
        <Switch
          value={twoWay}
          disabled={pending}
          accessibilityLabel={t('databases.relations.showOn', { database: targetName })}
          onValueChange={(next) => {
            if (!next && property?.config?.twoWay) setConfirm('disable');
            else setTwoWay(next);
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
        disabled={pending || !target}
        accessibilityLabel={t('common.save')}
        onPress={() => {
          if (property?.config?.twoWay && target !== property.config.targetDatabaseId)
            setConfirm('retarget');
          else void save();
        }}
      >
        <Text>{t('common.save')}</Text>
      </Button>
      <ConfirmationDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={t('databases.relations.removeTitle')}
        description={t('databases.relations.removeDescription')}
        confirmVariant="destructive"
        onConfirm={async () => {
          if (confirm === 'disable') setTwoWay(false);
          else await save();
          setConfirm(null);
        }}
      />
    </View>
  );
}
