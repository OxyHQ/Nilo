import { RowsScrollView } from './rows-scroll-view';
import { ViewForm } from './view-form';
import { ScrollView, View } from 'react-native';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import type { Database, DatabaseRow, DatabaseView } from '@/lib/types/databases';
import { NewRowMenu } from './new-row-menu';
import { ViewTable } from './view-table';
import { ViewBoard } from './view-board';
import { ViewGallery } from './view-gallery';
import { ViewList } from './view-list';
import { ViewCalendar } from './view-calendar';
import { ViewTimeline } from './view-timeline';
import { FilterBuilder } from './filter-builder';
import { SortBuilder } from './sort-builder';
import { AddPropertyButton } from './property-config-modal';

interface DatabaseViewContainerProps {
  database: Database;
  view: DatabaseView;
  rows: DatabaseRow[];
  isLoading: boolean;
  readOnly?: boolean;
  viewsReadOnly?: boolean;
  total?: number;
  onLoadMore?: () => void;
  isFetchingMore?: boolean;
}

/**
 * Wraps the active view with the shared "tools" bar — filter, sort,
 * add-property — and delegates rendering to the matching view component.
 */
export function DatabaseViewContainer({
  database,
  view,
  rows,
  isLoading,
  readOnly = false,
  viewsReadOnly = readOnly,
  total,
  onLoadMore,
  isFetchingMore,
}: DatabaseViewContainerProps) {
  const { t } = useTranslation();

  if (view.type === 'form') return <ViewForm database={database} view={view} readOnly={readOnly} />;

  return (
    <View className="flex-1">
      {!viewsReadOnly ? (
        <View className="flex-row items-center justify-between px-6 py-2 border-b border-border">
          <View className="flex-row items-center gap-1">
            <FilterBuilder database={database} view={view} rows={rows} />
            <SortBuilder database={database} view={view} />
            {!readOnly ? <AddPropertyButton database={database} /> : null}
          </View>
          {!readOnly ? <NewRowMenu databaseId={database.id} /> : null}
        </View>
      ) : null}

      {total !== undefined ? (
        <Text className="px-4 py-1 text-xs text-muted-foreground">
          {t('databases.rows.total', { count: total })}
        </Text>
      ) : null}
      {isFetchingMore ? (
        <Text accessibilityLiveRegion="polite" className="px-4 text-xs text-muted-foreground">
          {t('common.loading')}
        </Text>
      ) : null}
      <View className="flex-1">
        {view.type === 'table' ? (
          <RowsScrollView onLoadMore={onLoadMore}>
            <ViewTable
              readOnly={readOnly}
              database={database}
              view={view}
              rows={rows}
              isLoading={isLoading}
            />
          </RowsScrollView>
        ) : null}
        {view.type === 'board' ? (
          <ViewBoard
            readOnly={readOnly}
            database={database}
            view={view}
            rows={rows}
            isLoading={isLoading}
            hasMore={total !== undefined && rows.length < total}
            onLoadMore={onLoadMore}
          />
        ) : null}
        {view.type === 'gallery' ? (
          <ViewGallery
            onLoadMore={onLoadMore}
            readOnly={readOnly}
            database={database}
            view={view}
            rows={rows}
            isLoading={isLoading}
          />
        ) : null}
        {view.type === 'list' ? (
          <ViewList
            onLoadMore={onLoadMore}
            readOnly={readOnly}
            database={database}
            view={view}
            rows={rows}
            isLoading={isLoading}
          />
        ) : null}
        {view.type === 'calendar' ? (
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
            <ViewCalendar database={database} view={view} rows={rows} isLoading={isLoading} />
          </ScrollView>
        ) : null}
        {view.type === 'timeline' ? (
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
            <ViewTimeline database={database} view={view} rows={rows} isLoading={isLoading} />
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}
