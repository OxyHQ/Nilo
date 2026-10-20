import { useState } from 'react';
import { Item } from '@oxy.so/bloom/item';
import { useDatabases } from '@/lib/hooks/use-databases';
import { useTranslation } from '@/hooks/useTranslation';
import { matchesSearch, SearchPickerDialog } from './search-picker-dialog';

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
    (database) => !database.archived && matchesSearch(database.name, search),
  );
  return (
    <SearchPickerDialog
      title={t('editor.slashMenu.linkedDatabase.label')}
      searchLabel={t('editor.inlineDatabase.search')}
      search={search}
      onSearch={setSearch}
      loading={databases.isLoading}
      failure={
        databases.isError
          ? {
              message: t('editor.inlineDatabase.loadFailed'),
              retry: t('editor.inlineDatabase.retry'),
              onRetry: () => void databases.refetch(),
            }
          : null
      }
      empty={
        !databases.isLoading && !databases.isError && !matches.length
          ? t('editor.inlineDatabase.noResults')
          : null
      }
      onClose={onClose}
    >
      {(choose) =>
        matches.map((database) => (
          <Item
            key={database.id}
            title={database.name || t('editor.inlineDatabase.defaultName')}
            density="compact"
            accessibilityLabel={database.name}
            onPress={() => choose(() => onChoose(database.id))}
          />
        ))
      }
    </SearchPickerDialog>
  );
}
