import { useState } from 'react';
import { Item } from '@oxy.so/bloom/item';
import { IconDisplay } from '@/components/page-chrome/icon-display';
import { matchesSearch, SearchPickerDialog } from '@/components/page-editor/search-picker-dialog';
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
  const [query, setQuery] = useState('');
  const typed = query.trim().length > 0;
  const pages = usePages(templates ? null : workspaceId);
  const templateList = useTemplates(templates ? workspaceId : null);
  const search = useSearch(workspaceId, query, typed && !templates);
  const listed = (templates ? templateList.data?.pages : pages.data?.pages) ?? [];
  const matches: PickedPage[] =
    typed && !templates
      ? (search.data?.results ?? []).map((r) => r.page)
      : listed.filter(
          (page) =>
            !page.archived &&
            !page.databaseId &&
            (templates || !page.template) &&
            matchesSearch(page.title, query),
        );
  const loading = templates ? templateList.isLoading : typed ? search.isSearching : pages.isLoading;
  return (
    <SearchPickerDialog
      title={title}
      searchLabel={t('editor.blocks.linkToPage.search')}
      search={query}
      onSearch={setQuery}
      loading={loading}
      empty={!loading && matches.length === 0 ? t('editor.blocks.linkToPage.noResults') : null}
      onClose={onClose}
    >
      {(choose) =>
        matches.map((page) => (
          <Item
            key={page.id}
            title={page.title || t('pages.untitled')}
            density="compact"
            leading={<IconDisplay value={page.icon} size={16} />}
            accessibilityLabel={page.title || t('pages.untitled')}
            onPress={() => choose(() => onChoose(page))}
          />
        ))
      }
    </SearchPickerDialog>
  );
}
