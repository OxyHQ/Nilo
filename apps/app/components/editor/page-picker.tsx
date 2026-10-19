import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Item } from '@oxy.so/bloom/item';
import { Loading } from '@oxy.so/bloom/loading';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { IconDisplay } from '@/components/page-chrome/icon-display';
import { useTranslation } from '@/hooks/useTranslation';
import { usePages, useTemplates } from '@/lib/hooks/use-pages';
import { useSearch } from '@/lib/hooks/use-search';

interface PickedPage {
  id: string;
  title: string;
  icon: string | null;
}

/**
 * Choose a page of the workspace: its pages to start with, the search's
 * matches once something is typed. `templates` lists the workspace's
 * templates instead (a button that duplicates one).
 */
export function PagePicker({
  workspaceId,
  title,
  templates = false,
  onChoose,
  onClose,
}: {
  workspaceId: string;
  title: string;
  templates?: boolean;
  onChoose: (page: PickedPage) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const control = useDialogControl();
  const [query, setQuery] = useState('');
  const typed = query.trim().length > 0;
  const pages = usePages(templates ? null : workspaceId);
  const templateList = useTemplates(templates ? workspaceId : null);
  const search = useSearch(workspaceId, query, typed && !templates);
  const listed = (templates ? templateList.data?.pages : pages.data?.pages) ?? [];
  const lower = query.trim().toLowerCase();
  const matches: PickedPage[] =
    typed && !templates
      ? (search.data?.results ?? []).map((r) => r.page)
      : listed.filter(
          (page) =>
            !page.archived &&
            !page.databaseId &&
            (templates || !page.template) &&
            (!lower || page.title.toLowerCase().includes(lower)),
        );
  const loading = templates ? templateList.isLoading : typed ? search.isSearching : pages.isLoading;
  return (
    <Dialog
      control={control}
      startOpen
      onClose={onClose}
      placement={{ base: 'bottom', md: 'center' }}
      title={title}
    >
      <View className="gap-3">
        <TextFieldInput
          value={query}
          onChangeText={setQuery}
          autoFocus
          label={t('editor.blocks.linkToPage.search')}
          placeholder={t('editor.blocks.linkToPage.search')}
        />
        {loading ? <Loading variant="inline" text={t('common.loading')} /> : null}
        <ScrollView keyboardShouldPersistTaps="handled">
          {matches.map((page) => (
            <Item
              key={page.id}
              title={page.title || t('pages.untitled')}
              density="compact"
              leading={<IconDisplay value={page.icon} size={16} />}
              accessibilityLabel={page.title || t('pages.untitled')}
              onPress={() => control.close(() => onChoose(page))}
            />
          ))}
          {!loading && matches.length === 0 ? (
            <EmptyState variant="compact" title={t('editor.blocks.linkToPage.noResults')} />
          ) : null}
        </ScrollView>
      </View>
    </Dialog>
  );
}
