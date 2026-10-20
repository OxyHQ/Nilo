import { RowsScrollView } from './rows-scroll-view';
import { ViewForm } from './view-form';
import { ScrollView, View } from 'react-native';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import type { Database, DatabaseRow, DatabaseView, RowGroup } from '@/lib/types/databases';
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
import { DatabaseCellScopeProvider } from './cell-scope';
import { ViewSearch } from './view-search';
import { ViewChart } from './view-chart';
import { OpenRowProvider } from './row-peek-provider';

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
  /** A grouped view's groups, in order (`GET …/rows`). */
  groups?: RowGroup[];
  /** More rows than those loaded. */
  hasMore?: boolean;
}

/**
 * Wraps the active view with the shared "tools" bar — search, filter, sort,
 * add-property, new row — and delegates rendering to the matching view
 * component. A reader searches; whoever may change the view filters and
 * sorts it; the database's editors add rows, and properties unless it is
 * locked, as its own views then are too (a linked view is its block's).
 * Rows open as the view says (`OpenRowProvider`): in a peek or as a page.
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
  groups,
  hasMore = total !== undefined && rows.length < total,
}: DatabaseViewContainerProps) {
  const { t } = useTranslation();
  const locked = database.locked === true;
  const viewEditable = !viewsReadOnly && !(locked && !view.blockId);
  const schemaEditable = !readOnly && !locked;

  if (view.type === 'form') return <ViewForm database={database} view={view} readOnly={readOnly} />;

  return (
    <DatabaseCellScopeProvider databaseId={database.id}>
      <OpenRowProvider view={view}>
        <View className="flex-1">
          <View className="flex-row items-center justify-between px-6 py-2 border-b border-border">
            <View className="flex-row items-center gap-1">
              <ViewSearch viewId={view.id} />
              {viewEditable ? (
                <>
                  <FilterBuilder database={database} view={view} rows={rows} />
                  <SortBuilder database={database} view={view} />
                </>
              ) : null}
              {schemaEditable && !viewsReadOnly ? <AddPropertyButton database={database} /> : null}
            </View>
            {!readOnly && !viewsReadOnly ? <NewRowMenu databaseId={database.id} /> : null}
          </View>

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
                  schemaReadOnly={!schemaEditable || !viewEditable}
                  viewEditable={viewEditable}
                  database={database}
                  view={view}
                  rows={rows}
                  isLoading={isLoading}
                  groups={groups}
                  hasMore={hasMore}
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
                hasMore={hasMore}
                onLoadMore={onLoadMore}
                groups={groups}
                viewEditable={viewEditable}
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
                groups={groups}
                hasMore={hasMore}
                viewEditable={viewEditable}
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
                groups={groups}
                hasMore={hasMore}
                viewEditable={viewEditable}
              />
            ) : null}
            {view.type === 'calendar' ? (
              <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                <ViewCalendar database={database} view={view} rows={rows} isLoading={isLoading} />
              </ScrollView>
            ) : null}
            {view.type === 'timeline' ? (
              <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                <ViewTimeline
                  database={database}
                  view={view}
                  rows={rows}
                  isLoading={isLoading}
                  groups={groups}
                  viewEditable={viewEditable}
                />
              </ScrollView>
            ) : null}
            {view.type === 'chart' ? (
              <ScrollView nestedScrollEnabled>
                <ViewChart database={database} view={view} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </OpenRowProvider>
    </DatabaseCellScopeProvider>
  );
}
