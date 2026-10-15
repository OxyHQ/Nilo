import { RowsScrollView } from './rows-scroll-view';
import { nestSubItems, subItemProperties, useExpandedRows } from '@/lib/sub-items';
import { SubItemToggle, NewSubItem } from './sub-item-controls';
import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, Plus } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import type { Database, DatabaseRow, DatabaseView } from '@/lib/types/databases';
import { useCreateRow } from '@/lib/hooks/use-database-rows';
import { PropertyCell } from './property-cell';

interface ViewListProps {
  database: Database;
  view: DatabaseView;
  rows: DatabaseRow[];
  isLoading: boolean;
  readOnly?: boolean;
  onLoadMore?: () => void;
}

/**
 * List view — vertical, minimal density. Title + a few preview props,
 * one row per line. Tapping a row navigates to its detail page.
 */
export function ViewList({
  database,
  view,
  rows,
  isLoading,
  onLoadMore,
  readOnly = false,
}: ViewListProps) {
  const router = useRouter();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const createRow = useCreateRow();
  const subItems = subItemProperties(database);
  const { expanded, toggleExpanded } = useExpandedRows(database.id);
  const nestedRows = nestSubItems(rows, subItems?.parent.id, expanded);
  const newSubItem = (parentId: string) => {
    if (!subItems || readOnly) return;
    createRow.mutate({
      databaseId: database.id,
      properties: { [subItems.parent.id]: { pageIds: [parentId] } },
    });
  };

  const visibleProperties = React.useMemo(() => {
    return database.schema.properties.filter(
      (p) => !view.hiddenProperties.includes(p.id) && p.id !== 'name',
    );
  }, [database.schema.properties, view.hiddenProperties]);

  if (isLoading) {
    return (
      <View className="py-10 items-center">
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  return (
    <RowsScrollView onLoadMore={onLoadMore}>
      {nestedRows.map((entry) => {
        if (entry.kind === 'new')
          return !readOnly ? (
            <NewSubItem
              key={`new-${entry.parentId}`}
              depth={entry.depth}
              disabled={createRow.isPending}
              onPress={() => newSubItem(entry.parentId)}
            />
          ) : null;
        const { row, depth } = entry;
        return (
          <Pressable
            key={row.id}
            style={{ paddingLeft: 16 + depth * 24 }}
            accessibilityRole="link"
            accessibilityLabel={row.title || t('databases.untitled')}
            onPress={() => router.push(`/p/${row.id}`)}
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
              <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
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
                    onChange={() => router.push(`/p/${row.id}`)}
                  />
                </View>
              ))}
            </View>
            <ChevronRight size={14} color={colors.mutedForeground} />
          </Pressable>
        );
      })}
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
          <Plus size={14} color={colors.mutedForeground} />
          <Text className="text-sm text-muted-foreground">
            {createRow.isPending ? t('databases.actions.adding') : t('databases.actions.new')}
          </Text>
        </Pressable>
      ) : null}
    </RowsScrollView>
  );
}
