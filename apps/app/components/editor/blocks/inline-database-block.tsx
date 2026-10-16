import { useInlineDatabaseViews } from '@/lib/hooks/use-inline-database-views';
import { useCreateView } from '@/lib/hooks/use-database-views';
import { usePageEditorContext } from '@/components/page-editor/page-editor-context';
import { ViewTab, NewViewPicker } from '@/components/database/database-header';
import { toast } from '@oxy.so/bloom/toast';
import { DatabaseActionsMenu } from '@/components/database/database-actions-menu';
import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import axios from 'axios';
import { RiDatabase2Line } from '@oxy.so/bloom/icons/RiDatabase2Line';
import { RiExternalLinkLine } from '@oxy.so/bloom/icons/RiExternalLinkLine';
import { DatabaseViewContainer } from '@/components/database/database-view';
import { Button } from '@oxy.so/bloom/button';
import { Tabs } from '@oxy.so/bloom/tabs';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useDatabase, useCreateDatabase } from '@/lib/hooks/use-databases';
import { useDatabaseRows } from '@/lib/hooks/use-database-rows';
import { usePage } from '@/lib/hooks/use-pages';
import { useColorScheme } from '@/lib/useColorScheme';
import { hasRole } from '@/lib/hooks/workspace-roles';
import type { BlockComponentProps } from './types';

export function InlineDatabaseBlock({
  block,
  readOnly = false,
  onChangeContent,
}: BlockComponentProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const router = useRouter();
  const databaseId = block.content.databaseId;
  const database = useDatabase(databaseId);
  const page = usePage(block.pageId);
  const create = useCreateDatabase();
  const [activeViewId, setActiveViewId] = useState<string | undefined>();
  const { status: editorStatus } = usePageEditorContext();
  const viewState = useInlineDatabaseViews({
    database: database.data?.database,
    ownViews: database.data?.views ?? [],
    pageId: block.pageId,
    blockId: block.id,
    readOnly,
    saved: editorStatus === 'saved',
    defaultName: t('databases.views.table'),
  });
  // The caller's role on the database itself, as the API reports it.
  const canEditSource = hasRole(database.data?.role, 'editor');
  const views = viewState.views;
  const createView = useCreateView();
  const [newViewOpen, setNewViewOpen] = useState(false);
  const selectedView =
    views.find((view) => view.id === (activeViewId ?? block.content.viewId)) ??
    views.find((view) => view.isDefault) ??
    views[0];
  const rows = useDatabaseRows(
    database.data && selectedView && selectedView.type !== 'form' && !database.isError
      ? databaseId
      : undefined,
    selectedView?.id ?? null,
    selectedView?.type,
  );
  const error = database.error ?? viewState.error ?? rows.error ?? create.error;
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  const databaseStatus = axios.isAxiosError(database.error)
    ? database.error.response?.status
    : undefined;
  const missing =
    !databaseId ||
    databaseStatus === 404 ||
    (!database.isLoading && !database.isError && !database.data?.database);

  if (status === 403) return <State message={t('editor.inlineDatabase.noAccess')} />;
  if (database.isLoading || viewState.isLoading)
    return (
      <Loading
        variant="spinner"
        size="sm"
        accessibilityLabel={t('editor.inlineDatabase.loading')}
      />
    );
  if (missing) {
    return (
      <View className="my-2 rounded-lg border border-dashed border-border px-4">
        <EmptyState
          variant="compact"
          description={t('editor.inlineDatabase.setup')}
          action={
            readOnly
              ? undefined
              : {
                  label: t(
                    create.isPending
                      ? 'editor.inlineDatabase.creating'
                      : 'editor.inlineDatabase.create',
                  ),
                  accessibilityLabel: t('editor.inlineDatabase.create'),
                  disabled: create.isPending || !page.data?.page.workspaceId,
                  onPress: () => {
                    const workspaceId = page.data?.page.workspaceId;
                    if (!workspaceId || create.isPending) return;
                    create.mutate(
                      {
                        workspaceId,
                        parentPageId: block.pageId,
                        isInline: true,
                        name: t('editor.inlineDatabase.defaultName'),
                      },
                      {
                        onSuccess: ({ database: created }) =>
                          onChangeContent({ databaseId: created.id }),
                      },
                    );
                  },
                }
          }
          footer={
            create.isError ? (
              <Text accessibilityRole="alert" className="text-sm text-destructive">
                {t('editor.inlineDatabase.createFailed')}
              </Text>
            ) : undefined
          }
        />
      </View>
    );
  }
  if (error || !database.data)
    return (
      <View className="my-2 gap-2 rounded-lg border border-border p-4">
        <Text accessibilityRole="alert" variant="body-regular">
          {t('editor.inlineDatabase.loadFailed')}
        </Text>
        <Button
          appearance="outline"
          className="self-start"
          accessibilityLabel={t('editor.inlineDatabase.retry')}
          onPress={() => {
            void database.refetch();
            if (viewState.linked) viewState.retry();
            if (database.data && selectedView) void rows.refetch();
          }}
        >
          {t('editor.inlineDatabase.retry')}
        </Button>
      </View>
    );
  const db = database.data.database;
  return (
    <View className="my-2 overflow-hidden rounded-lg border border-border">
      <View className="flex-row flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {db.icon ? (
          <Text variant="headline-regular">{db.icon}</Text>
        ) : (
          <RiDatabase2Line size="sm" fill={colors.mutedForeground} />
        )}
        <Text accessibilityRole="header" className="flex-1 text-sm font-semibold text-foreground">
          {db.name || t('editor.inlineDatabase.defaultName')}
        </Text>
        {!readOnly && !viewState.linked ? <DatabaseActionsMenu databaseId={db.id} /> : null}
        <Button
          appearance="subtle"
          tone="neutral"
          size="xs"
          accessibilityRole="link"
          accessibilityLabel={t('editor.inlineDatabase.openFullPage')}
          onPress={() => router.push(`/db/${db.id}`)}
          leadingIcon={RiExternalLinkLine}
        >
          {t('editor.inlineDatabase.openFullPage')}
        </Button>
      </View>
      <View className="flex-row items-center gap-1 border-b border-border">
        <View className="flex-shrink">
          <Tabs
            value={selectedView?.id}
            onValueChange={setActiveViewId}
            variant="pill"
            label={t('databases.views.title')}
          >
            {views.map((view) => (
              <ViewTab key={view.id} view={view} database={db} readOnly={readOnly} />
            ))}
          </Tabs>
        </View>
        {!readOnly ? (
          <Button
            appearance="subtle"
            size="sm"
            accessibilityLabel={t('databases.views.new')}
            onPress={() => setNewViewOpen(true)}
          >
            {t('databases.views.new')}
          </Button>
        ) : null}
      </View>
      <NewViewPicker
        open={!readOnly && newViewOpen}
        onClose={() => setNewViewOpen(false)}
        pending={createView.isPending}
        onChoose={async (type) => {
          try {
            const view = await createView.mutateAsync({
              databaseId: db.id,
              blockId: viewState.linked ? block.id : undefined,
              type,
              name: t(`databases.views.${type}`),
            });
            setActiveViewId(view.id);
            setNewViewOpen(false);
          } catch {
            toast.error(t('databases.views.createFailed'));
          }
        }}
      />
      {selectedView ? (
        <View style={{ height: 400 }}>
          <DatabaseViewContainer
            database={db}
            view={selectedView}
            rows={rows.data?.rows ?? []}
            isLoading={rows.isLoading}
            readOnly={readOnly || (viewState.linked && !canEditSource)}
            viewsReadOnly={readOnly}
            total={rows.data?.total}
            isFetchingMore={rows.isFetchingNextPage}
            onLoadMore={() => {
              if (rows.hasNextPage && !rows.isFetching)
                void rows.fetchNextPage({ cancelRefetch: false });
            }}
          />
        </View>
      ) : (
        <State message={t('pages.database.noViews')} />
      )}
    </View>
  );
}

function State({ message }: { message: string }) {
  return (
    <View className="my-2 rounded-lg border border-border px-4">
      <EmptyState variant="compact" description={message} />
    </View>
  );
}
