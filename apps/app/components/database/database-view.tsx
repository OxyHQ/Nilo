import { ViewForm } from './view-form';
import { viewIsEditable } from '@oxy.so/nilo-contracts';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Text } from '@oxy.so/bloom/typography';
import { Toolbar } from '@oxy.so/bloom/layout';
import { useTranslation } from '@/hooks/useTranslation';
import type * as React from 'react';
import type {
  Database,
  DatabaseRow,
  DatabaseView,
  DatabaseViewType,
  RowGroup,
} from '@/lib/types/databases';
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
import { RelatedRowsProvider } from './relation-cell';

interface DatabaseViewContainerProps {
  /** Route identity and view tabs, composed into the screen header. */
  renderHeader?: (accessory: React.ReactNode) => React.ReactNode;
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

/** What every view's body is drawn from. */
interface ViewBodyProps {
  database: Database;
  view: DatabaseView;
  rows: DatabaseRow[];
  isLoading: boolean;
  readOnly: boolean;
  schemaReadOnly: boolean;
  viewEditable: boolean;
  groups?: RowGroup[];
  hasMore: boolean;
  onLoadMore?: () => void;
}

/** Each view's body, by its type; a form is drawn on its own, without the tools bar. */
const VIEW_BODIES: Record<
  Exclude<DatabaseViewType, 'form'>,
  (props: ViewBodyProps) => React.ReactNode
> = {
  table: ({ onLoadMore, ...props }) => (
    <ScreenScrollView
      keyboardShouldPersistTaps="handled"
      onEndReached={onLoadMore}
      onEndReachedThreshold={1}
    >
      <ViewTable {...props} />
    </ScreenScrollView>
  ),
  board: ({ schemaReadOnly: _schemaReadOnly, ...props }) => <ViewBoard {...props} />,
  gallery: ({ schemaReadOnly: _schemaReadOnly, ...props }) => <ViewGallery {...props} />,
  list: ({ schemaReadOnly: _schemaReadOnly, ...props }) => <ViewList {...props} />,
  calendar: (props) => (
    <ScreenScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
      <ViewCalendar
        database={props.database}
        view={props.view}
        rows={props.rows}
        isLoading={props.isLoading}
      />
    </ScreenScrollView>
  ),
  timeline: (props) => (
    <ScreenScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
      <ViewTimeline
        database={props.database}
        view={props.view}
        rows={props.rows}
        isLoading={props.isLoading}
        groups={props.groups}
        viewEditable={props.viewEditable}
      />
    </ScreenScrollView>
  ),
  chart: (props) => (
    <ScreenScrollView nestedScrollEnabled>
      <ViewChart database={props.database} view={props.view} />
    </ScreenScrollView>
  ),
};

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
  renderHeader,
  readOnly = false,
  viewsReadOnly = readOnly,
  total,
  onLoadMore,
  isFetchingMore,
  groups,
  hasMore = total !== undefined && rows.length < total,
}: DatabaseViewContainerProps) {
  const { t } = useTranslation();
  const locked = database.locked;
  const viewEditable = !viewsReadOnly && viewIsEditable(database, view);
  const schemaEditable = !readOnly && !locked;

  const tools =
    view.type === 'form' ? null : (
      <Toolbar
        actions={!readOnly && !viewsReadOnly ? <NewRowMenu databaseId={database.id} /> : null}
        accessory={
          <>
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
          </>
        }
      >
        <ViewSearch viewId={view.id} />
        {viewEditable ? (
          <>
            <FilterBuilder database={database} view={view} rows={rows} />
            <SortBuilder database={database} view={view} />
          </>
        ) : null}
        {schemaEditable && !viewsReadOnly ? <AddPropertyButton database={database} /> : null}
      </Toolbar>
    );

  return (
    <DatabaseCellScopeProvider databaseId={database.id}>
      <OpenRowProvider view={view}>
        <Screen
          scroll={view.type === 'board' ? 'none' : 'auto'}
          header={
            renderHeader ? (
              renderHeader(tools)
            ) : tools ? (
              <PageHeader safeArea={false} accessory={tools} />
            ) : undefined
          }
        >
          <RelatedRowsProvider database={database} rows={rows}>
            {view.type === 'form' ? (
              <ViewForm database={database} view={view} readOnly={readOnly} />
            ) : (
              VIEW_BODIES[view.type]({
                database,
                view,
                rows,
                isLoading,
                readOnly,
                schemaReadOnly: !schemaEditable || !viewEditable,
                viewEditable,
                groups,
                hasMore,
                onLoadMore,
              })
            )}
          </RelatedRowsProvider>
        </Screen>
      </OpenRowProvider>
    </DatabaseCellScopeProvider>
  );
}
