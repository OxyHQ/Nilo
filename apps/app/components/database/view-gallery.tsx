import { ScreenScrollView } from '@oxy.so/bloom/screen';
import * as React from 'react';
import { View } from 'react-native';
import { Card } from '@oxy.so/bloom/card';
import { ResponsiveGrid } from '@oxy.so/bloom/grid';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { toast } from '@oxy.so/bloom/toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import type { Database, DatabaseRow, DatabaseView, RowGroup } from '@/lib/types/databases';
import { useCreateRow, useUpdateRow } from '@/lib/hooks/use-database-rows';
import { groupTakesRows, type RowSection } from '@/lib/view-groups';
import { CardPreview, cardProperties, cardWidth } from './card-layout';
import { GroupHeader, useGroupedSections } from './group-header';
import { useGroupLabel } from './group-label';
import { useOpenRow } from './open-row';
import { PropertyCell } from './property-cell';

interface ViewGalleryProps {
  database: Database;
  view: DatabaseView;
  rows: DatabaseRow[];
  isLoading: boolean;
  readOnly?: boolean;
  onLoadMore?: () => void;
  /** A grouped gallery's groups, in order (`GET …/rows`). */
  groups?: RowGroup[];
  /** More rows than these are to load. */
  hasMore?: boolean;
  /** May change the view: move, hide and collapse its groups for every reader. */
  viewEditable?: boolean;
}

/**
 * Gallery view — grid of cards. Each card shows the row's cover (or a
 * configured file property), title, and the view's visible properties. Grouped
 * (`groupBy`), the cards come in collapsible sections, one per group with
 * its count, as a table's rows do, and a card added in one gets its value.
 */
export function ViewGallery({
  database,
  view,
  rows,
  isLoading,
  readOnly = false,
  onLoadMore,
  groups,
  hasMore = false,
  viewEditable = false,
}: ViewGalleryProps) {
  const openRow = useOpenRow();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const createRow = useCreateRow();
  const updateRow = useUpdateRow();
  const { grouping, sections, isCollapsed, headerProps, newRowIn } = useGroupedSections(
    database,
    view,
    rows,
    groups,
    hasMore,
    'groupBy',
    viewEditable,
  );
  const nameProperty = database.schema.properties.find((p) => p.id === 'name');
  const groupLabel = useGroupLabel(
    grouping ?? nameProperty ?? { id: 'name', name: '', type: 'text' },
    view.groupBy?.granularity,
  );

  // In the view's own order.
  const visibleProperties = React.useMemo(() => {
    return cardProperties(database, view);
  }, [database, view]);

  if (isLoading) {
    return (
      <View className="py-10 items-center">
        <Loading variant="spinner" />
      </View>
    );
  }

  /** A new card: in a group, with the group's value. */
  const newCard = (group?: RowSection) =>
    createRow.mutate(group ? newRowIn(group) : { databaseId: database.id });

  const renderCards = (list: DatabaseRow[], group?: RowSection) => (
    <ResponsiveGrid minItemWidth={cardWidth(view)} maxColumns={6} gap={12} style={{ padding: 12 }}>
      {list.map((row) => {
        return (
          <Card
            key={row.id}
            accessibilityRole="link"
            accessibilityLabel={row.title || t('databases.untitled')}
            onPress={() => openRow(row.id)}
            clipContent
          >
            <CardPreview row={row} view={view} database={database} />
            <View className="p-3 gap-1">
              <Text variant="body-medium" numberOfLines={2}>
                {row.title || t('databases.untitled')}
              </Text>
              <View className="gap-1">
                {visibleProperties.map((property) => (
                  <View key={property.id} className="flex-row items-center gap-2">
                    <PropertyCell
                      readOnly={readOnly}
                      property={property}
                      value={row.properties[property.id] ?? null}
                      variant="card"
                      rowId={row.id}
                      onChange={(value) => {
                        if (readOnly) return;
                        updateRow.mutate(
                          {
                            databaseId: database.id,
                            rowId: row.id,
                            properties: { [property.id]: value },
                          },
                          { onError: () => toast.error(t('databases.rows.saveFailed')) },
                        );
                      }}
                    />
                  </View>
                ))}
              </View>
            </View>
          </Card>
        );
      })}

      {!readOnly && (!group || (grouping && groupTakesRows(grouping))) ? (
        <Card
          accessibilityRole="button"
          accessibilityLabel={
            group
              ? t('databases.groups.addRow', { name: groupLabel(group.key, group.range) })
              : t('databases.actions.new')
          }
          disabled={createRow.isPending}
          onPress={() => newCard(group)}
          appearance="outline"
          className="items-center justify-center"
          style={{ minHeight: 200 }}
        >
          <RiAddLine size="md" fill={colors.mutedForeground} />
          <Text className="mt-1 text-sm text-muted-foreground">
            {createRow.isPending ? t('databases.actions.adding') : t('databases.gallery.newCard')}
          </Text>
        </Card>
      ) : null}
    </ResponsiveGrid>
  );

  return (
    <ScreenScrollView
      keyboardShouldPersistTaps="handled"
      onEndReached={onLoadMore}
      onEndReachedThreshold={1}
    >
      {sections && grouping
        ? sections.map((section) => {
            const collapsed = isCollapsed(section.key);
            return (
              <View
                key={`group-${section.key === null ? '\u0000' : `k:${section.key}`}`}
                testID={`gallery-group-${section.key ?? 'none'}`}
              >
                <GroupHeader {...headerProps(section)} />
                {collapsed ? null : renderCards(section.rows, section)}
              </View>
            );
          })
        : renderCards(rows)}
    </ScreenScrollView>
  );
}
