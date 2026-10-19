import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { Badge } from '@oxy.so/bloom/badge';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import type {
  Database,
  DatabaseProperty,
  DatabaseRow,
  DatabaseView,
  SelectOption,
} from '@/lib/types/databases';
import { useCreateRow, useUpdateRow } from '@/lib/hooks/use-database-rows';
import { PropertyCell } from './property-cell';
import { SELECT_CHIP_HUE } from './select-color';

interface ViewBoardProps {
  database: Database;
  view: DatabaseView;
  rows: DatabaseRow[];
  isLoading: boolean;
  readOnly?: boolean;
  /** More rows than these: the board reads them a page at a time. */
  hasMore?: boolean;
  onLoadMore?: () => void;
}

const COLUMN_WIDTH = 280;

/**
 * Board view — Kanban grouped by a select / status property. Each
 * column corresponds to one option of the group property; dragging a
 * card between columns updates the row's property value.
 *
 * Drag-and-drop runs on web via HTML5 DataTransfer. On native a card
 * moves by changing its group property on the row's page.
 */
export function ViewBoard({
  database,
  view,
  rows,
  isLoading,
  readOnly = false,
  hasMore = false,
  onLoadMore,
}: ViewBoardProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const createRow = useCreateRow();
  const updateRow = useUpdateRow();

  const groupByProperty = React.useMemo<DatabaseProperty | null>(() => {
    const target = view.groupBy?.propertyId;
    if (target) {
      const p = database.schema.properties.find((x) => x.id === target);
      if (p && (p.type === 'select' || p.type === 'status')) return p;
    }
    return (
      database.schema.properties.find((p) => p.type === 'status' || p.type === 'select') ?? null
    );
  }, [database.schema.properties, view.groupBy?.propertyId]);

  const columns = React.useMemo(() => {
    const options = groupByProperty?.config?.options ?? [];
    const unassigned: DatabaseRow[] = [];
    const byOption = new Map<string, DatabaseRow[]>();
    for (const opt of options) byOption.set(opt.id, []);
    for (const row of rows) {
      if (!groupByProperty) {
        unassigned.push(row);
        continue;
      }
      const value = row.properties[groupByProperty.id];
      const optId =
        value && typeof value === 'object' && 'optionId' in value
          ? typeof value.optionId === 'string'
            ? value.optionId
            : null
          : null;
      if (!optId) {
        unassigned.push(row);
        continue;
      }
      const bucket = byOption.get(optId);
      if (bucket) {
        bucket.push(row);
      } else {
        unassigned.push(row);
      }
    }
    return {
      options,
      byOption,
      unassigned,
    };
  }, [groupByProperty, rows]);

  const moveRow = React.useCallback(
    (rowId: string, optionId: string | null) => {
      if (readOnly || !groupByProperty) return;
      updateRow.mutate({
        databaseId: database.id,
        rowId,
        properties: { [groupByProperty.id]: { optionId } },
      });
    },
    [database.id, groupByProperty, updateRow, readOnly],
  );

  // A card shows the first properties the view does not hide.
  const cardProperties = React.useMemo(() => {
    const hidden = new Set(view.hiddenProperties);
    return database.schema.properties
      .filter((p) => p.id !== 'name' && p.type !== 'rollup' && !hidden.has(p.id))
      .slice(0, 3);
  }, [database.schema.properties, view.hiddenProperties]);

  if (isLoading) {
    return (
      <View className="py-10 items-center">
        <Loading variant="spinner" />
      </View>
    );
  }

  if (!groupByProperty) {
    return (
      <EmptyState
        // icon: Kanban
        variant="compact"
        title={t('databases.board.needsGroupProperty')}
      />
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View className="flex-row gap-3 px-3 py-3">
        {columns.options.map((opt) => (
          <BoardColumn
            readOnly={readOnly}
            key={opt.id}
            option={opt}
            rows={columns.byOption.get(opt.id) ?? []}
            onAddRow={async () => {
              await createRow.mutateAsync({
                databaseId: database.id,
                properties: {
                  [groupByProperty.id]: { optionId: opt.id },
                },
              });
            }}
            onMoveTo={(rowId) => moveRow(rowId, opt.id)}
            renderCard={(row) => (
              <BoardCard
                key={row.id}
                readOnly={readOnly}
                row={row}
                properties={cardProperties}
                onOpen={() => router.push(`/p/${row.id}`)}
              />
            )}
          />
        ))}
        <BoardColumn
          readOnly={readOnly}
          option={{
            id: '__unassigned__',
            name: t('databases.board.noStatus'),
            color: 'default',
          }}
          rows={columns.unassigned}
          onAddRow={async () => {
            await createRow.mutateAsync({ databaseId: database.id });
          }}
          onMoveTo={(rowId) => moveRow(rowId, null)}
          renderCard={(row) => (
            <BoardCard
              key={row.id}
              readOnly={readOnly}
              row={row}
              properties={cardProperties}
              onOpen={() => router.push(`/p/${row.id}`)}
            />
          )}
        />
        {hasMore && onLoadMore ? (
          <Button appearance="subtle" size="sm" className="self-start" onPress={onLoadMore}>
            {t('databases.board.loadMore')}
          </Button>
        ) : null}
      </View>
    </ScrollView>
  );
}

interface BoardColumnProps {
  readOnly: boolean;
  option: SelectOption;
  rows: DatabaseRow[];
  onAddRow: () => void;
  onMoveTo: (rowId: string) => void;
  renderCard: (row: DatabaseRow) => React.ReactNode;
}

function BoardColumn({ option, rows, onAddRow, onMoveTo, renderCard, readOnly }: BoardColumnProps) {
  const { t } = useTranslation();

  // Web-only drag target — accept a row id payload from the dragged card.
  const dropHandlers =
    Platform.OS === 'web' && !readOnly
      ? {
          onDragOver: (e: { preventDefault: () => void }) => e.preventDefault(),
          onDrop: (e: { preventDefault: () => void; dataTransfer: DataTransfer }) => {
            e.preventDefault();
            const id = e.dataTransfer.getData('text/plain');
            if (id) onMoveTo(id);
          },
        }
      : {};

  return (
    <View
      className="bg-muted/40 rounded-lg p-2"
      style={{ width: COLUMN_WIDTH }}
      {...(dropHandlers as Record<string, unknown>)}
    >
      <View className="flex-row items-center justify-between mb-2 px-1">
        <View className="flex-row items-center gap-2">
          <Chip size="xs" hue={SELECT_CHIP_HUE[option.color] ?? 'neutral'}>
            {option.name}
          </Chip>
          <Badge content={rows.length} variant="subtle" />
        </View>
        {!readOnly ? (
          <Button
            iconOnly
            appearance="plain"
            size="xs"
            accessibilityLabel={t('databases.actions.new')}
            onPress={onAddRow}
            leadingIcon={RiAddLine}
          />
        ) : null}
      </View>
      <ScrollView style={{ maxHeight: 600 }}>
        <View className="gap-2">{rows.map((r) => renderCard(r))}</View>
      </ScrollView>
    </View>
  );
}

interface BoardCardProps {
  readOnly: boolean;
  row: DatabaseRow;
  /** The properties the card shows, in order. */
  properties: DatabaseProperty[];
  onOpen: () => void;
}

function BoardCard({ row, properties, onOpen, readOnly }: BoardCardProps) {
  const { t } = useTranslation();

  const dragHandlers =
    Platform.OS === 'web' && !readOnly
      ? {
          draggable: true,
          onDragStart: (e: { dataTransfer: DataTransfer }) => {
            e.dataTransfer.setData('text/plain', row.id);
            e.dataTransfer.effectAllowed = 'move';
          },
        }
      : {};

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={row.title || t('databases.untitled')}
      onPress={onOpen}
      className="bg-card border border-border rounded-md px-3 py-2 shadow-sm"
      {...(dragHandlers as Record<string, unknown>)}
    >
      <Text className="mb-1 text-sm font-medium text-foreground" numberOfLines={2}>
        {row.title || t('databases.untitled')}
      </Text>
      <View className="gap-1">
        {properties.map((property) => (
          <View key={property.id} className="flex-row items-center gap-1">
            <PropertyCell
              readOnly={readOnly}
              property={property}
              value={row.properties[property.id] ?? null}
              variant="card"
              rowId={row.id}
              onChange={() => {
                // cards are not editable inline — opens row instead
                onOpen();
              }}
            />
          </View>
        ))}
      </View>
    </Pressable>
  );
}
