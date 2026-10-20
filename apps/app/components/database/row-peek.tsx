import * as React from 'react';
import { Platform, TextInput, View } from 'react-native';
import { RiCloseLine } from '@oxy.so/bloom/icons/RiCloseLine';
import { RiExpandDiagonalSLine } from '@oxy.so/bloom/icons/RiExpandDiagonalSLine';
import { Button } from '@oxy.so/bloom/button';
import { Dialog } from '@oxy.so/bloom/dialog';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { useTranslation } from '@/hooks/useTranslation';
import { IconDisplay } from '@/components/page-chrome/icon-display';
import { PageEditor } from '@/components/page-editor/page-editor';
import {
  PageEditorProvider,
  PageEditorToolbar,
} from '@/components/page-editor/page-editor-context';
import { useDatabase } from '@/lib/hooks/use-databases';
import { pageToDatabaseRow, useUpdateRow } from '@/lib/hooks/use-database-rows';
import { usePage } from '@/lib/hooks/use-pages';
import { pageContentReadOnly } from '@/lib/hooks/page-access';
import { useColorScheme } from '@/lib/useColorScheme';
import type { Page } from '@/lib/types/pages';
import { RowPropertiesPanel } from './row-properties-panel';

interface RowPeekProps {
  rowId: string;
  open: boolean;
  /** Beside the view (a side sheet) or over it (a card); a bottom sheet on a phone either way. */
  mode: 'side' | 'center';
  onClose: () => void;
  onOpenFullPage: () => void;
}

/**
 * A row opened in a peek, as Notion's: its title, its properties (the row
 * page's own panel and cell editors) and its page's content in the page
 * editor, over the view it was opened from, with "Open as full page" and
 * close. The page is the row's own: whoever may edit it edits it here.
 */
export function RowPeek({ rowId, open, mode, onClose, onOpenFullPage }: RowPeekProps) {
  const { t } = useTranslation();
  const page = usePage(rowId);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      placement={
        mode === 'side' ? { base: 'bottom', md: 'right' } : { base: 'bottom', md: 'center' }
      }
      width={600}
      maxWidth={900}
      maxHeightRatio={0.92}
      label={page.data?.page.title || t('databases.untitled')}
      testID="row-peek"
    >
      <View className="flex-row items-center justify-end gap-1 pb-2">
        <Button
          appearance="subtle"
          size="sm"
          leadingIcon={RiExpandDiagonalSLine}
          onPress={onOpenFullPage}
        >
          {t('databases.peek.openFull')}
        </Button>
        <Button
          iconOnly
          appearance="plain"
          size="sm"
          leadingIcon={RiCloseLine}
          accessibilityLabel={t('databases.peek.close')}
          onPress={onClose}
        />
      </View>
      {page.isLoading ? (
        <View className="items-center py-10">
          <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
        </View>
      ) : page.data ? (
        <PeekBody
          page={page.data.page}
          readOnly={pageContentReadOnly(page.data.page, page.data.role)}
        />
      ) : (
        <EmptyState variant="compact" title={t('databases.peek.loadFailed')} />
      )}
    </Dialog>
  );
}

function PeekBody({ page, readOnly }: { page: Page; readOnly: boolean }) {
  const databaseId = typeof page.databaseId === 'string' ? page.databaseId : undefined;
  const { data } = useDatabase(databaseId);
  return (
    <PageEditorProvider pageId={page.id} readOnly={readOnly}>
      <View className="gap-4">
        <PeekTitle page={page} databaseId={databaseId} readOnly={readOnly} />
        {data?.database ? (
          <View className="border-b border-border/30 pb-4">
            <RowPropertiesPanel
              database={data.database}
              row={pageToDatabaseRow(page)}
              readOnly={readOnly}
            />
          </View>
        ) : null}
        <PageEditor
          pageId={page.id}
          readOnly={readOnly}
          layout={page.mode === 'canvas' ? 'canvas' : 'document'}
        />
      </View>
      <PageEditorToolbar />
    </PageEditorProvider>
  );
}

/** The row's title, edited in place: the Name of its database. */
function PeekTitle({
  page,
  databaseId,
  readOnly,
}: {
  page: Page;
  databaseId: string | undefined;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const updateRow = useUpdateRow();
  const [draft, setDraft] = React.useState<string | null>(null);
  const title = draft ?? page.title;
  const commit = () => {
    if (draft === null) return;
    if (databaseId && draft !== page.title) {
      updateRow.mutate({ databaseId, rowId: page.id, title: draft });
    }
    setDraft(null);
  };
  return (
    <View className="flex-row items-center gap-2">
      <IconDisplay value={page.icon} size={28} pageId={page.id} />
      <TextInput
        accessibilityLabel={t('common.name')}
        value={title}
        editable={!readOnly && Boolean(databaseId)}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        placeholder={t('databases.untitled')}
        placeholderTextColor={colors.mutedForeground}
        style={[
          { flex: 1, fontSize: 28, fontWeight: '700', color: colors.foreground },
          Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
        ]}
      />
    </View>
  );
}
