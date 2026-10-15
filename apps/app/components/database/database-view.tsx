import { ViewForm } from './view-form';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ArrowUpDown, Filter as FilterIcon } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
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
}: DatabaseViewContainerProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [sortOpen, setSortOpen] = React.useState(false);

  if (view.type === 'form') return <ViewForm database={database} view={view} readOnly={readOnly} />;

  const filterCount = countFilters(view.filters);
  const sortCount = view.sorts.length;

  return (
    <View className="flex-1">
      {!readOnly ? (
        <View className="flex-row items-center justify-between px-6 py-2 border-b border-border">
          <View className="flex-row items-center gap-1">
            <ToolButton
              onPress={() => setFilterOpen(true)}
              active={filterCount > 0}
              icon={FilterIcon}
              label={
                filterCount > 0
                  ? t('databases.toolbar.filterCount', { count: filterCount })
                  : t('databases.toolbar.filter')
              }
            />
            <ToolButton
              onPress={() => setSortOpen(true)}
              active={sortCount > 0}
              icon={ArrowUpDown}
              label={
                sortCount > 0
                  ? t('databases.toolbar.sortCount', { count: sortCount })
                  : t('databases.toolbar.sort')
              }
            />
            <AddPropertyButton database={database} />
          </View>
          <NewRowMenu databaseId={database.id} />
        </View>
      ) : null}

      <View className="flex-1">
        {view.type === 'table' ? (
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
            <ViewTable
              readOnly={readOnly}
              database={database}
              view={view}
              rows={rows}
              isLoading={isLoading}
            />
          </ScrollView>
        ) : null}
        {view.type === 'board' ? (
          <ViewBoard
            readOnly={readOnly}
            database={database}
            view={view}
            rows={rows}
            isLoading={isLoading}
          />
        ) : null}
        {view.type === 'gallery' ? (
          <ViewGallery
            readOnly={readOnly}
            database={database}
            view={view}
            rows={rows}
            isLoading={isLoading}
          />
        ) : null}
        {view.type === 'list' ? (
          <ViewList
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

      {!readOnly ? (
        <>
          <FilterBuilder
            rows={rows}
            open={filterOpen}
            onClose={() => setFilterOpen(false)}
            database={database}
            view={view}
          />
          <SortBuilder
            open={sortOpen}
            onClose={() => setSortOpen(false)}
            database={database}
            view={view}
          />
        </>
      ) : null}
    </View>
  );
}

interface ToolButtonProps {
  onPress: () => void;
  active?: boolean;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
}

function ToolButton({ onPress, active, icon: Icon, label }: ToolButtonProps) {
  const { colors } = useColorScheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={`flex-row items-center gap-1 px-2 py-1 rounded ${
        active ? 'bg-muted' : 'hover:bg-muted'
      }`}
    >
      <Icon size={12} color={active ? colors.primary : colors.mutedForeground} />
      <Text className={`text-xs ${active ? 'text-primary' : 'text-muted-foreground'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function countFilters(group: DatabaseView['filters']): number {
  let count = 0;
  for (const f of group.filters) {
    if (f.kind === 'condition') count += 1;
    else count += countFilters(f);
  }
  return count;
}
