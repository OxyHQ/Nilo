import * as React from 'react';
import { View } from 'react-native';
import { RiExpandDiagonalSLine } from '@oxy.so/bloom/icons/RiExpandDiagonalSLine';
import { Button } from '@oxy.so/bloom/button';
import { DetailDialog, useDialogContext } from '@oxy.so/bloom/dialog';
import { PageHeaderTitleInput } from '@oxy.so/bloom/page-header';
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
import type { Page } from '@/lib/types/pages';
import type { Database } from '@/lib/types/databases';
import { RowPropertiesPanel } from './row-properties-panel';

interface RowPeekProps {
  rowId: string;
  /** Beside or centered over the view; Bloom uses its compact detail surface on phones. */
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
export function RowPeek({ rowId, mode, onClose, onOpenFullPage }: RowPeekProps) {
  const { t } = useTranslation();
  const page = usePage(rowId);
  const record = page.data?.page;
  const databaseId = typeof record?.databaseId === 'string' ? record.databaseId : undefined;
  const database = useDatabase(databaseId);
  const readOnly = !page.data || pageContentReadOnly(page.data.page, page.data.role);
  return (
    <PageEditorProvider pageId={rowId} readOnly={readOnly}>
      <DetailDialog
        startOpen
        onClose={onClose}
        mode={mode}
        label={record?.title || t('databases.untitled')}
        closeLabel={t('databases.peek.close')}
        contentKind={record?.mode === 'canvas' ? 'canvas' : 'document'}
        scrollable={record?.mode !== 'canvas'}
        header={database.data?.database.name || t('databases.untitled')}
        actions={<OpenFullPage onOpen={onOpenFullPage} />}
        footer={record ? <PageEditorToolbar /> : undefined}
        footerKeyboardBehavior="follow"
        testID="row-peek"
      >
        {page.isLoading ? (
          <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
        ) : record ? (
          <PeekBody page={record} database={database.data?.database} readOnly={readOnly} />
        ) : (
          <EmptyState variant="compact" title={t('databases.peek.loadFailed')} />
        )}
      </DetailDialog>
    </PageEditorProvider>
  );
}

/** Keep the shared exit before navigation disposes the editing session. */
function OpenFullPage({ onOpen }: { onOpen: () => void }) {
  const { close } = useDialogContext();
  const { t } = useTranslation();
  return (
    <Button
      iconOnly
      appearance="plain"
      leadingIcon={RiExpandDiagonalSLine}
      accessibilityLabel={t('databases.peek.openFull')}
      onPress={() => close(onOpen)}
    />
  );
}

function PeekBody({
  page,
  database,
  readOnly,
}: {
  page: Page;
  database?: Database;
  readOnly: boolean;
}) {
  const databaseId = typeof page.databaseId === 'string' ? page.databaseId : undefined;
  return (
    <>
      <PeekTitle page={page} databaseId={databaseId} readOnly={readOnly} />
      {database ? (
        <RowPropertiesPanel database={database} row={pageToDatabaseRow(page)} readOnly={readOnly} />
      ) : null}
      <PageEditor
        pageId={page.id}
        readOnly={readOnly}
        layout={page.mode === 'canvas' ? 'canvas' : 'document'}
      />
    </>
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
  const updateRow = useUpdateRow();
  const [draft, setDraft] = React.useState<string | null>(null);
  const title = draft ?? page.title;
  const commit = () => {
    if (draft === null || readOnly) return;
    if (databaseId && draft !== page.title) {
      updateRow.mutate({ databaseId, rowId: page.id, title: draft });
    }
    setDraft(null);
  };
  return (
    <View className="flex-row items-center gap-2">
      <IconDisplay value={page.icon} size={28} pageId={page.id} />
      <PageHeaderTitleInput
        multiline={false}
        className="flex-1"
        label={t('common.name')}
        value={title}
        editable={!readOnly && Boolean(databaseId)}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        placeholder={t('databases.untitled')}
      />
    </View>
  );
}
