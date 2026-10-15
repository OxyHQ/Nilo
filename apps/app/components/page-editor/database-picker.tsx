import { useState } from 'react';
import { ScrollView } from 'react-native';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
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
  const [search, setSearch] = useState('');
  const databases = useDatabases(workspaceId);
  const matches = (databases.data?.databases ?? []).filter(
    (database) =>
      !database.archived &&
      normalizeMentionQuery(database.name).includes(normalizeMentionQuery(search)),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>{t('editor.slashMenu.linkedDatabase.label')}</DialogTitle>
        <Input
          value={search}
          onChangeText={setSearch}
          autoFocus
          accessibilityLabel={t('editor.inlineDatabase.search')}
          placeholder={t('editor.inlineDatabase.search')}
        />
        {databases.isLoading ? <Text>{t('common.loading')}</Text> : null}
        {databases.isError ? (
          <>
            <Text accessibilityRole="alert">{t('editor.inlineDatabase.loadFailed')}</Text>
            <Button variant="outline" onPress={() => void databases.refetch()}>
              <Text>{t('editor.inlineDatabase.retry')}</Text>
            </Button>
          </>
        ) : null}
        <ScrollView keyboardShouldPersistTaps="handled">
          {matches.map((database) => (
            <Button
              key={database.id}
              variant="ghost"
              accessibilityLabel={database.name}
              onPress={() => onChoose(database.id)}
            >
              <Text>{database.name || t('editor.inlineDatabase.defaultName')}</Text>
            </Button>
          ))}
          {!databases.isLoading && !databases.isError && !matches.length ? (
            <Text>{t('editor.inlineDatabase.noResults')}</Text>
          ) : null}
        </ScrollView>
      </DialogContent>
    </Dialog>
  );
}
