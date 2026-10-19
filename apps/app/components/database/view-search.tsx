import * as React from 'react';
import { View } from 'react-native';
import { RiCloseLine } from '@oxy.so/bloom/icons/RiCloseLine';
import { RiSearchLine } from '@oxy.so/bloom/icons/RiSearchLine';
import { Button } from '@oxy.so/bloom/button';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { useTranslation } from '@/hooks/useTranslation';
import { useViewSearchStore } from '@/lib/stores/view-search-store';

/** How long typing pauses before the rows are read again. */
const SEARCH_DELAY_MS = 250;

/**
 * The search of a view's toolbar, as Notion's: a button that opens a field;
 * what is typed searches the view's rows by title (`useViewSearchStore`, read
 * by `useDatabaseRows`) once typing pauses. Closing it clears the search.
 */
export function ViewSearch({ viewId }: { viewId: string }) {
  const { t } = useTranslation();
  const current = useViewSearchStore((state) => state.byView[viewId] ?? '');
  const search = useViewSearchStore((state) => state.search);
  const [open, setOpen] = React.useState(current !== '');
  const [draft, setDraft] = React.useState(current);

  React.useEffect(() => {
    if (draft.trim() === current) return;
    const timer = setTimeout(() => search(viewId, draft), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, current, search, viewId]);

  if (!open) {
    return (
      <Button
        iconOnly
        appearance="plain"
        size="sm"
        accessibilityLabel={t('databases.search.open')}
        leadingIcon={RiSearchLine}
        onPress={() => setOpen(true)}
      />
    );
  }
  return (
    <View className="flex-row items-center gap-1" style={{ width: 220 }}>
      <View className="flex-1">
        <TextFieldInput
          size="sm"
          label={t('databases.search.label')}
          placeholder={t('databases.search.placeholder')}
          value={draft}
          onChangeText={setDraft}
          autoFocus
          returnKeyType="search"
          onSubmitEditing={() => search(viewId, draft)}
        />
      </View>
      <Button
        iconOnly
        appearance="plain"
        size="xs"
        accessibilityLabel={t('databases.search.clear')}
        leadingIcon={RiCloseLine}
        onPress={() => {
          setDraft('');
          search(viewId, '');
          setOpen(false);
        }}
      />
    </View>
  );
}
