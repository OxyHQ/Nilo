import * as React from 'react';
import { View } from 'react-native';
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

/**
 * Full-page database route. Renders the header (name + cover + view tabs)
 * and the active view body. The view selection persists in-component
 * state — refresh shows the default view.
 */
export default function DatabaseRoute() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { t } = useTranslation();
  if (!id) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <EmptyState description={t('pages.database.noneSelected')} />
      </View>
    );
  }
  return <DatabasePage id={id} key={id} />;
}

function DatabasePage({ id }: { id: string }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { data, isLoading, isError, error } = useDatabase(id);

  const [activeViewId, setActiveViewId] = React.useState<string | null>(null);

  // Pick the default view once the database loads.
  const views = data?.views ?? [];
  const defaultViewId = React.useMemo(
    () => views.find((v) => v.isDefault)?.id ?? views[0]?.id ?? null,
    [views],
  );
  const selectedViewId = activeViewId ?? defaultViewId;

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

  return (
    <View className="flex-1 bg-background">
      <DatabaseHeader
        database={data.database}
        views={views}
        activeViewId={selectedViewId}
        onSelectView={setActiveViewId}
        readOnly={readOnly}
      />
      {selectedView ? (
        <DatabaseViewContainer
          database={data.database}
          view={selectedView}
          readOnly={readOnly}
          rows={rows.data?.rows ?? []}
          isLoading={rows.isLoading}
          total={rows.data?.total}
          isFetchingMore={rows.isFetchingNextPage}
          onLoadMore={() => {
            if (rows.hasNextPage && !rows.isFetching)
              void rows.fetchNextPage({ cancelRefetch: false });
          }}
        />
      ) : (
        <View className="flex-1 items-center justify-center">
          <EmptyState description={t('pages.database.noViews')} />
        </View>
      )}
    </View>
  );
}
