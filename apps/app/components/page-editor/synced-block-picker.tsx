import { useState, useSyncExternalStore } from 'react';
import { Item } from '@oxy.so/bloom/item';
import { useTranslation } from '@/hooks/useTranslation';
import { type SyncedRef, syncedClipboard } from '@/lib/editor/synced-blocks';
import { useSyncedBlocks } from '@/lib/hooks/use-synced-blocks';
import { normalizeMentionQuery } from './mention-search';
import { matchesSearch, SearchPickerDialog } from './search-picker-dialog';

/**
 * "Paste synced block": the original "Copy and sync" put on the clipboard,
 * then every original the reader may read in the workspace, by page.
 */
export function SyncedBlockPicker({
  workspaceId,
  onChoose,
  onClose,
}: {
  workspaceId: string;
  onChoose: (source: SyncedRef) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const copied = useSyncExternalStore(syncedClipboard.subscribe, syncedClipboard.get);
  const listed = useSyncedBlocks(workspaceId);
  const typed = normalizeMentionQuery(search) !== '';
  const matches = (listed.data?.syncedBlocks ?? []).filter(
    (item) =>
      item.blockId !== copied?.blockId &&
      matchesSearch(`${item.page.title} ${item.preview}`, search),
  );
  const untitled = t('editor.blocks.syncBlock.untitled');
  const copiedEntry = copied
    ? (listed.data?.syncedBlocks ?? []).find((item) => item.blockId === copied.blockId)
    : undefined;
  return (
    <SearchPickerDialog
      title={t('editor.blocks.syncBlock.picker.title')}
      searchLabel={t('editor.blocks.syncBlock.picker.search')}
      search={search}
      onSearch={setSearch}
      loading={listed.isLoading}
      failure={
        listed.isError
          ? {
              message: t('editor.blocks.syncBlock.picker.loadFailed'),
              retry: t('editor.blocks.syncBlock.picker.retry'),
              onRetry: () => void listed.refetch(),
            }
          : null
      }
      empty={
        !listed.isLoading && !listed.isError && !matches.length && !copied
          ? t('editor.blocks.syncBlock.picker.none')
          : null
      }
      onClose={onClose}
    >
      {(choose) => (
        <>
          {copied && !typed ? (
            <Item
              title={
                copiedEntry
                  ? copiedEntry.preview || copiedEntry.page.title || untitled
                  : t('editor.blocks.syncBlock.label')
              }
              subtitle={t('editor.blocks.syncBlock.picker.copied')}
              density="compact"
              onPress={() => choose(() => onChoose(copied))}
            />
          ) : null}
          {matches.map((item) => (
            <Item
              key={item.blockId}
              title={item.preview || t('editor.blocks.syncBlock.empty')}
              subtitle={item.page.title || untitled}
              density="compact"
              onPress={() =>
                choose(() => onChoose({ blockId: item.blockId, pageId: item.page.id }))
              }
            />
          ))}
        </>
      )}
    </SearchPickerDialog>
  );
}
