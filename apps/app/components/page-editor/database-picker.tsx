import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Item } from '@oxy.so/bloom/item';
import { Loading } from '@oxy.so/bloom/loading';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useDatabases } from '@/lib/hooks/use-databases';
import { useTranslation } from '@/hooks/useTranslation';
import { normalizeMentionQuery } from './mention-search';

export function DatabasePicker({
  workspaceId,
  onChoose,
  onClose,
}: {
  workspaceId: string;
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const control = useDialogControl();
  const [search, setSearch] = useState('');
  const databases = useDatabases(workspaceId);
  const matches = (databases.data?.databases ?? []).filter(
    (database) =>
      !database.archived &&
      normalizeMentionQuery(database.name).includes(normalizeMentionQuery(search)),
  );
  return (
    <Dialog
      control={control}
      startOpen
      onClose={onClose}
      placement={{ base: 'bottom', md: 'center' }}
      title={t('editor.slashMenu.linkedDatabase.label')}
    >
      <View className="gap-3">
        <TextFieldInput
          value={search}
          onChangeText={setSearch}
          autoFocus
          label={t('editor.inlineDatabase.search')}
          placeholder={t('editor.inlineDatabase.search')}
        />
        {databases.isLoading ? <Loading variant="inline" text={t('common.loading')} /> : null}
        {databases.isError ? (
          <>
            <Text variant="body-regular" accessibilityRole="alert">
              {t('editor.inlineDatabase.loadFailed')}
            </Text>
            <Button appearance="outline" tone="neutral" onPress={() => void databases.refetch()}>
              {t('editor.inlineDatabase.retry')}
            </Button>
          </>
        ) : null}
        <ScrollView keyboardShouldPersistTaps="handled">
          {matches.map((database) => (
            <Item
              key={database.id}
              title={database.name || t('editor.inlineDatabase.defaultName')}
              density="compact"
              accessibilityLabel={database.name}
              onPress={() => control.close(() => onChoose(database.id))}
            />
          ))}
          {!databases.isLoading && !databases.isError && !matches.length ? (
            <EmptyState variant="compact" title={t('editor.inlineDatabase.noResults')} />
          ) : null}
        </ScrollView>
      </View>
    </Dialog>
  );
}
