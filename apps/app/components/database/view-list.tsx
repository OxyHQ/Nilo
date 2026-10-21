import { ScreenScrollView } from '@oxy.so/bloom/screen';
import { nestSubItems, subItemProperties, useExpandedRows } from '@/lib/sub-items';
import { SubItemToggle, NewSubItem } from './sub-item-controls';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons/RiArrowRightSLine';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import type { Database, DatabaseRow, DatabaseView, RowGroup } from '@/lib/types/databases';
import { useCreateRow } from '@/lib/hooks/use-database-rows';
import { orderedProperties } from '@/lib/view-properties';
import { PropertyCell } from './property-cell';
import { useOpenRow } from './open-row';
import { GroupHeader, useGroupedSections } from './group-header';

interface ViewListProps {
  database: Database;
  view: DatabaseView;
  rows: DatabaseRow[];
  isLoading: boolean;
  readOnly?: boolean;
  onLoadMore?: () => void;
  /** A grouped view's groups, in order (`GET …/rows`). */
  groups?: RowGroup[];
  /** More rows than these are to load. */
  hasMore?: boolean;
  /** May change the view: move, hide and collapse its groups for every reader. */
  viewEditable?: boolean;
}

/**
 * List view — vertical, minimal density. Title + a few preview props, in
 * the view's order, one row per line. Tapping a row opens it as the view
 * says (`open-row.tsx`). Grouped, the rows come in collapsible sections.
 */
export function ViewList({
  database,
  view,
  rows,
  isLoading,
  onLoadMore,
  readOnly = false,
  groups,
  hasMore = false,
  viewEditable = false,
}: ViewListProps) {
  const openRow = useOpenRow();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const createRow = useCreateRow();
  const subItems = subItemProperties(database);
  const { expanded, toggleExpanded } = useExpandedRows(database.id);
  const newSubItem = (parentId: string) => {
    if (!subItems || readOnly) return;
    createRow.mutate({
      databaseId: database.id,
      properties: { [subItems.parent.id]: { pageIds: [parentId] } },
    });
  };

  const visibleProperties = React.useMemo(() => {
    return orderedProperties(database, view).filter(
      (p) => !view.hiddenProperties.includes(p.id) && p.id !== 'name',
    );
  }, [database, view]);
  const { grouping, sections, isCollapsed, headerProps } = useGroupedSections(
    database,
    view,
    rows,
    groups,
    hasMore,
    'groupBy',
    viewEditable,
  );

  if (isLoading) {
    return (
      <View className="py-10 items-center">
        <Loading variant="spinner" />
      </View>
    );
  }

  const renderRows = (list: DatabaseRow[], keyPrefix: string) =>
    nestSubItems(list, subItems?.parent.id, expanded).map((entry) => {
      if (entry.kind === 'new')
        return !readOnly ? (
          <NewSubItem
            key={`${keyPrefix}new-${entry.parentId}`}
            depth={entry.depth}
            disabled={createRow.isPending}
            onPress={() => newSubItem(entry.parentId)}
          />
        ) : null;
      const { row, depth } = entry;
      return (
        <Pressable
          key={`${keyPrefix}${row.id}`}
          style={{ paddingLeft: 16 + depth * 24 }}
          accessibilityRole="link"
          accessibilityLabel={row.title || t('databases.untitled')}
          onPress={() => openRow(row.id)}
          className="flex-row items-center gap-3 px-4 py-2 border-b border-border/40 hover:bg-muted/40"
        >
          {subItems ? (
            <SubItemToggle
              expanded={expanded.has(row.id)}
              title={row.title}
              onPress={() => toggleExpanded(row.id)}
            />
          ) : null}
          <View className="flex-1">
            <Text variant="body-medium" numberOfLines={1}>
              {row.title || t('databases.untitled')}
            </Text>
          </View>
          <View className="flex-row items-center gap-3">
            {visibleProperties.slice(0, 3).map((property) => (
              <View key={property.id}>
                <PropertyCell
                  readOnly={readOnly}
                  property={property}
                  value={row.properties[property.id] ?? null}
                  variant="card"
                  rowId={row.id}
                  onChange={() => openRow(row.id)}
                />
              </View>
            ))}
          </View>
          <RiArrowRightSLine width={14} height={14} fill={colors.mutedForeground} />
        </Pressable>
      );
    });

  return (
    <ScreenScrollView
      keyboardShouldPersistTaps="handled"
      onEndReached={onLoadMore}
      onEndReachedThreshold={1}
    >
      {sections && grouping
        ? sections.map((section) => {
            const prefix = `${section.key === null ? '\u0000' : section.key}:`;
            const collapsed = isCollapsed(section.key);
            return (
              <View key={`group-${prefix}`} testID={`list-group-${section.key ?? 'none'}`}>
                <View className="border-b border-border/40">
                  <GroupHeader {...headerProps(section)} />
                </View>
                {collapsed ? null : renderRows(section.rows, prefix)}
              </View>
            );
          })
        : renderRows(rows, '')}
      {createRow.isError ? (
        <Text accessibilityRole="alert" className="text-sm text-destructive">
          {t('databases.subItems.failed')}
        </Text>
      ) : null}
      {!readOnly ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('databases.actions.new')}
          disabled={createRow.isPending}
          onPress={() => createRow.mutate({ databaseId: database.id })}
          className="flex-row items-center gap-2 px-4 py-2 hover:bg-muted/40"
        >
          <RiAddLine width={14} height={14} fill={colors.mutedForeground} />
          <Text className="text-sm text-muted-foreground">
            {createRow.isPending ? t('databases.actions.adding') : t('databases.actions.new')}
          </Text>
        </Pressable>
      ) : null}
    </ScreenScrollView>
  );
}
