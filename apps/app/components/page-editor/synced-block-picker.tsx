import { useState, useSyncExternalStore } from 'react';
import { ScrollView, View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Item } from '@oxy.so/bloom/item';
import { Loading } from '@oxy.so/bloom/loading';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { type SyncedRef, syncedClipboard } from '@/lib/editor/synced-blocks';
import { useSyncedBlocks } from '@/lib/hooks/use-synced-blocks';
import { normalizeMentionQuery } from './mention-search';

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
  const control = useDialogControl();
  const [search, setSearch] = useState('');
  const copied = useSyncExternalStore(syncedClipboard.subscribe, syncedClipboard.get);
  const listed = useSyncedBlocks(workspaceId);
  const query = normalizeMentionQuery(search);
  const matches = (listed.data?.syncedBlocks ?? []).filter(
    (item) =>
      item.blockId !== copied?.blockId &&
      normalizeMentionQuery(`${item.page.title} ${item.preview}`).includes(query),
  );
  const choose = (source: SyncedRef) => control.close(() => onChoose(source));
  const untitled = t('editor.blocks.syncBlock.untitled');
  const copiedEntry = copied
    ? (listed.data?.syncedBlocks ?? []).find((item) => item.blockId === copied.blockId)
    : undefined;
  return (
    <Dialog
      control={control}
      startOpen
      onClose={onClose}
      placement={{ base: 'bottom', md: 'center' }}
      title={t('editor.blocks.syncBlock.picker.title')}
    >
      <View className="gap-3">
        <TextFieldInput
          value={search}
          onChangeText={setSearch}
          autoFocus
          label={t('editor.blocks.syncBlock.picker.search')}
          placeholder={t('editor.blocks.syncBlock.picker.search')}
        />
        {listed.isLoading ? <Loading variant="inline" text={t('common.loading')} /> : null}
        {listed.isError ? (
          <>
            <Text variant="body-regular" accessibilityRole="alert">
              {t('editor.blocks.syncBlock.picker.loadFailed')}
            </Text>
            <Button appearance="outline" tone="neutral" onPress={() => void listed.refetch()}>
              {t('editor.blocks.syncBlock.picker.retry')}
            </Button>
          </>
        ) : null}
        <ScrollView keyboardShouldPersistTaps="handled">
          {copied && !query ? (
            <Item
              title={
                copiedEntry
                  ? copiedEntry.preview || copiedEntry.page.title || untitled
                  : t('editor.blocks.syncBlock.label')
              }
              subtitle={t('editor.blocks.syncBlock.picker.copied')}
              density="compact"
              onPress={() => choose(copied)}
            />
          ) : null}
          {matches.map((item) => (
            <Item
              key={item.blockId}
              title={item.preview || t('editor.blocks.syncBlock.empty')}
              subtitle={item.page.title || untitled}
              density="compact"
              onPress={() => choose({ blockId: item.blockId, pageId: item.page.id })}
            />
          ))}
          {!listed.isLoading && !listed.isError && !matches.length && !copied ? (
            <EmptyState variant="compact" title={t('editor.blocks.syncBlock.picker.none')} />
          ) : null}
        </ScrollView>
      </View>
    </Dialog>
  );
}
