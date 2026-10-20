import { RowsScrollView } from './rows-scroll-view';
import { CoverDisplay } from '@/components/page-chrome/cover-display';
import * as React from 'react';
import { Image, Pressable, View } from 'react-native';
import { RiImageLine } from '@oxy.so/bloom/icons/RiImageLine';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import type {
  Database,
  DatabaseRow,
  DatabaseView,
  GroupRange,
  RowGroup,
} from '@/lib/types/databases';
import { useCreateRow } from '@/lib/hooks/use-database-rows';
import {
  groupProperty,
  groupTakesRows,
  groupValue,
  rowSections,
  sectionOptions,
} from '@/lib/view-groups';
import { orderedProperties } from '@/lib/view-properties';
import { GroupHeader, useViewGroups } from './group-header';
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

const CARD_WIDTH = 240;

/**
 * Gallery view — grid of cards. Each card shows the row's cover (or a
 * configured file property), title, and a few preview properties. Grouped
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
  const viewGroups = useViewGroups(database.id, view, viewEditable, groups);
  const grouping = groupProperty(database.schema.properties, view.groupBy);
  const sections =
    grouping && groups
      ? rowSections(rows, groups, {
          hideEmpty: view.groupBy?.hideEmpty,
          complete: !hasMore,
          ...sectionOptions(view),
        })
      : null;
  const sectionKeys = sections?.map((section) => section.key) ?? [];
  const nameProperty = database.schema.properties.find((p) => p.id === 'name');
  const groupLabel = useGroupLabel(
    grouping ?? nameProperty ?? { id: 'name', name: '', type: 'text' },
    view.groupBy?.granularity,
  );

  // In the view's own order.
  const visibleProperties = React.useMemo(() => {
    return orderedProperties(database, view).filter(
      (p) => !view.hiddenProperties.includes(p.id) && p.id !== 'name',
    );
  }, [database, view]);

  if (isLoading) {
    return (
      <View className="py-10 items-center">
        <Loading variant="spinner" />
      </View>
    );
  }

  /** A new card: in a group, with the group's value. */
  const newCard = (group?: { key: string | null; range?: GroupRange }) => {
    if (!group || !grouping) return createRow.mutate({ databaseId: database.id });
    const value = groupValue(grouping, group.key, group.range);
    createRow.mutate({
      databaseId: database.id,
      ...(grouping.id === 'name' && group.key !== null && { title: group.key }),
      ...(value !== undefined && { properties: { [grouping.id]: value } }),
    });
  };

  const renderCards = (list: DatabaseRow[], group?: { key: string | null; range?: GroupRange }) => (
    <View className="flex-row flex-wrap gap-3 p-3">
      {list.map((row) => {
        const cover = readCover(row, view, database);
        return (
          <Pressable
            key={row.id}
            accessibilityRole="link"
            accessibilityLabel={row.title || t('databases.untitled')}
            onPress={() => openRow(row.id)}
            className="bg-card border border-border rounded-xl overflow-hidden"
            style={{ width: CARD_WIDTH }}
          >
            {view.config.coverSource === 'none' ? null : (
              <View className="h-32 bg-muted items-center justify-center overflow-hidden">
                {cover?.kind === 'page' ? (
                  <View className="w-full">
                    <CoverDisplay value={cover.value} height={128} />
                  </View>
                ) : cover ? (
                  <Image
                    source={{ uri: cover.url }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode={view.config.fit === 'contain' ? 'contain' : 'cover'}
                    accessible={false}
                  />
                ) : (
                  <RiImageLine size="lg" fill={colors.mutedForeground} />
                )}
              </View>
            )}
            <View className="p-3 gap-1">
              <Text variant="body-medium" numberOfLines={2}>
                {row.title || t('databases.untitled')}
              </Text>
              <View className="gap-1">
                {visibleProperties.slice(0, 3).map((property) => (
                  <View key={property.id} className="flex-row items-center gap-2">
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
            </View>
          </Pressable>
        );
      })}

      {!readOnly && (!group || (grouping && groupTakesRows(grouping))) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            group
              ? t('databases.groups.addRow', { name: groupLabel(group.key, group.range) })
              : t('databases.actions.new')
          }
          disabled={createRow.isPending}
          onPress={() => newCard(group)}
          className="border border-dashed border-border rounded-xl items-center justify-center"
          style={{ width: CARD_WIDTH, height: 200 }}
        >
          <RiAddLine size="md" fill={colors.mutedForeground} />
          <Text className="mt-1 text-sm text-muted-foreground">
            {createRow.isPending ? t('databases.actions.adding') : t('databases.gallery.newCard')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <RowsScrollView onLoadMore={onLoadMore}>
      {sections && grouping
        ? sections.map((section) => {
            const collapsed = viewGroups.isCollapsed(section.key);
            return (
              <View
                key={`group-${section.key === null ? '\u0000' : `k:${section.key}`}`}
                testID={`gallery-group-${section.key ?? 'none'}`}
              >
                <GroupHeader
                  property={grouping}
                  groupKey={section.key}
                  granularity={view.groupBy?.granularity}
                  range={section.range}
                  count={section.count}
                  collapsed={collapsed}
                  onToggle={() => viewGroups.toggle(section.key)}
                  actions={viewGroups.actionsFor(section.key, sectionKeys)}
                />
                {collapsed ? null : renderCards(section.rows, section)}
              </View>
            );
          })
        : renderCards(rows)}
    </RowsScrollView>
  );
}

function readCover(
  row: DatabaseRow,
  view: DatabaseView,
  database: Database,
): { kind: 'url'; url: string } | { kind: 'page'; value: string } | null {
  const source = view.config.coverSource ?? 'pageCover';
  // A page's cover is stored encoded (a gradient, a colour, an image): shown as its page shows it.
  if (source === 'pageCover' && row.cover) {
    return { kind: 'page', value: row.cover };
  }
  if (source === 'property' && view.config.coverPropertyId) {
    const property = database.schema.properties.find((p) => p.id === view.config.coverPropertyId);
    if (property?.type === 'files') {
      const value = row.properties[property.id];
      if (value && typeof value === 'object' && 'files' in value) {
        const files = value.files;
        if (Array.isArray(files) && files.length > 0) {
          const first = files[0];
          if (
            first &&
            typeof first === 'object' &&
            'url' in first &&
            typeof first.url === 'string'
          ) {
            return { kind: 'url', url: first.url };
          }
        }
      }
    }
  }
  return null;
}
