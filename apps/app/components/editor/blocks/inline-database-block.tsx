import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import axios from 'axios';
import { Database as DatabaseIcon, ExternalLink } from 'lucide-react-native';
import { DatabaseViewContainer } from '@/components/database/database-view';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { useDatabase, useCreateDatabase } from '@/lib/hooks/use-databases';
import { useDatabaseRows } from '@/lib/hooks/use-database-rows';
import { usePage } from '@/lib/hooks/use-pages';
import { useColorScheme } from '@/lib/useColorScheme';
import type { BlockComponentProps } from './types';

export function InlineDatabaseBlock({
  block,
  readOnly = false,
  onChangeContent,
}: BlockComponentProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const router = useRouter();
  const databaseId =
    block.content.databaseId === '000000000000000000000000' ? undefined : block.content.databaseId;
  const database = useDatabase(databaseId);
  const page = usePage(block.pageId);
  const create = useCreateDatabase();
  const [activeViewId, setActiveViewId] = useState<string | undefined>();
  const views = database.data?.views ?? [];
  const selectedView =
    views.find((view) => view.id === (activeViewId ?? block.content.viewId)) ??
    views.find((view) => view.isDefault) ??
    views[0];
  const rows = useDatabaseRows(
    database.data && selectedView && selectedView.type !== 'form' && !database.isError
      ? databaseId
      : undefined,
    selectedView?.id ?? null,
  );
  const error = database.error ?? rows.error ?? create.error;
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  const databaseStatus = axios.isAxiosError(database.error)
    ? database.error.response?.status
    : undefined;
  const missing =
    !databaseId ||
    databaseStatus === 404 ||
    (!database.isLoading && !database.isError && !database.data?.database);

  if (status === 403) return <State message={t('editor.inlineDatabase.noAccess')} />;
  if (database.isLoading)
    return (
      <ActivityIndicator
        accessibilityLabel={t('editor.inlineDatabase.loading')}
        color={colors.mutedForeground}
      />
    );
  if (missing) {
    return (
      <View className="my-2 gap-3 rounded-lg border border-dashed border-border p-4">
        <Text className="text-sm text-muted-foreground">{t('editor.inlineDatabase.setup')}</Text>
        {!readOnly ? (
          <Button
            variant="outline"
            disabled={create.isPending || !page.data?.page.workspaceId}
            accessibilityLabel={t('editor.inlineDatabase.create')}
            onPress={() => {
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
                  onSuccess: ({ database: created }) => onChangeContent({ databaseId: created.id }),
                },
              );
            }}
          >
            <Text>
              {t(
                create.isPending
                  ? 'editor.inlineDatabase.creating'
                  : 'editor.inlineDatabase.create',
              )}
            </Text>
          </Button>
        ) : null}
        {create.isError ? (
          <Text accessibilityRole="alert" className="text-sm text-destructive">
            {t('editor.inlineDatabase.createFailed')}
          </Text>
        ) : null}
      </View>
    );
  }
  if (error || !database.data)
    return (
      <View className="my-2 gap-2 rounded-lg border border-border p-4">
        <Text accessibilityRole="alert">{t('editor.inlineDatabase.loadFailed')}</Text>
        <Button
          variant="outline"
          accessibilityLabel={t('editor.inlineDatabase.retry')}
          onPress={() => {
            void database.refetch();
            if (database.data && selectedView) void rows.refetch();
          }}
        >
          <Text>{t('editor.inlineDatabase.retry')}</Text>
        </Button>
      </View>
    );
  const db = database.data.database;
  return (
    <View className="my-2 overflow-hidden rounded-lg border border-border">
      <View className="flex-row flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {db.icon ? (
          <Text>{db.icon}</Text>
        ) : (
          <DatabaseIcon size={16} color={colors.mutedForeground} />
        )}
        <Text accessibilityRole="header" className="flex-1 text-sm font-semibold">
          {db.name || t('editor.inlineDatabase.defaultName')}
        </Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('editor.inlineDatabase.openFullPage')}
          onPress={() => router.push(`/db/${db.id}`)}
          className="flex-row items-center gap-1 rounded px-2 py-1 hover:bg-muted"
        >
          <ExternalLink size={14} color={colors.mutedForeground} />
          <Text className="text-xs text-muted-foreground">
            {t('editor.inlineDatabase.openFullPage')}
          </Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        accessibilityRole="tablist"
        className="border-b border-border"
        keyboardShouldPersistTaps="handled"
      >
        {views.map((view) => (
          <Pressable
            key={view.id}
            accessibilityRole="tab"
            accessibilityLabel={view.name}
            accessibilityState={{ selected: view.id === selectedView?.id }}
            onPress={() => setActiveViewId(view.id)}
            className={`px-3 py-2 ${view.id === selectedView?.id ? 'bg-muted' : 'hover:bg-muted'}`}
          >
            <Text className="text-sm">{view.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {selectedView ? (
        <View style={{ height: 400 }}>
          <DatabaseViewContainer
            database={db}
            view={selectedView}
            rows={rows.data?.rows ?? []}
            isLoading={rows.isLoading}
            readOnly={readOnly}
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
    <View className="my-2 rounded-lg border border-border p-4">
      <Text className="text-sm text-muted-foreground">{message}</Text>
    </View>
  );
}
