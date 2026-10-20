import * as React from 'react';
import { View } from 'react-native';
import { Screen } from '@oxy.so/bloom/screen';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { useTranslation } from '@/hooks/useTranslation';
import { apiErrorMessage } from '@/lib/api/error-message';
import { useDatabase } from '@/lib/hooks/use-databases';
import { useDatabaseRows } from '@/lib/hooks/use-database-rows';
import { hasRole } from '@/lib/hooks/workspace-roles';
import { DatabaseHeader } from '@/components/database/database-header';
import { DatabaseViewContainer } from '@/components/database/database-view';
import { useRouteWorkspace } from '@/lib/hooks/use-route-workspace';

/**
 * Full-page database route. Renders the header (name + cover + view tabs)
 * and the active view body. The URL names the view, so reloads and shared
 * links reopen it. Missing or removed views fall back to the default.
 */
export default function DatabaseRoute() {
  const params = useLocalSearchParams<{ id?: string | string[]; v?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { t } = useTranslation();
  if (!id) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <EmptyState description={t('pages.database.noneSelected')} />
      </View>
    );
  }
  const viewId = Array.isArray(params.v) ? params.v[0] : params.v;
  return <DatabasePage id={id} viewId={viewId} key={id} />;
}

function DatabasePage({ id, viewId }: { id: string; viewId?: string }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { data, isLoading, isError, error } = useDatabase(id);
  useRouteWorkspace(data?.database.workspaceId);

  // Pick the default view once the database loads.
  const views = data?.views ?? [];
  const defaultViewId = React.useMemo(
    () => views.find((v) => v.isDefault)?.id ?? views[0]?.id ?? null,
    [views],
  );
  const selectedViewId = views.some((view) => view.id === viewId)
    ? (viewId ?? null)
    : defaultViewId;

  const selectedView = views.find((v) => v.id === selectedViewId) ?? null;
  const rows = useDatabaseRows(
    selectedView && selectedView.type !== 'form' ? id : undefined,
    selectedViewId,
    selectedView?.type,
  );

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Loading variant="spinner" accessibilityLabel={t('common.loading')} />
      </View>
    );
  }

  if (isError || !data?.database) {
    const message = apiErrorMessage(error, t('pages.database.loadFailed'));
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <View className="w-full max-w-md">
          <EmptyState
            title={message}
            action={{
              label: t('pages.backToWorkspace'),
              onPress: () => router.replace('/(app)'),
            }}
          />
        </View>
      </View>
    );
  }

  // The caller's role on the database, as the API reports it: a reader sees it, an editor edits it.
  const readOnly = !hasRole(data.role, 'editor');

  const header = (accessory?: React.ReactNode) => (
    <DatabaseHeader
      database={data.database}
      views={views}
      activeViewId={selectedViewId}
      onSelectView={(v) => router.setParams({ v })}
      readOnly={readOnly}
      accessory={accessory}
    />
  );

  return selectedView ? (
    <DatabaseViewContainer
      renderHeader={header}
      database={data.database}
      view={selectedView}
      readOnly={readOnly}
      rows={rows.data?.rows ?? []}
      isLoading={rows.isLoading}
      total={rows.data?.total}
      groups={rows.data?.groups}
      hasMore={rows.hasNextPage}
      isFetchingMore={rows.isFetchingNextPage}
      onLoadMore={() => {
        if (rows.hasNextPage && !rows.isFetching) void rows.fetchNextPage({ cancelRefetch: false });
      }}
    />
  ) : (
    <Screen header={header()}>
      <EmptyState description={t('pages.database.noViews')} />
    </Screen>
  );
}
