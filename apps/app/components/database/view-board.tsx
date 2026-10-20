import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiArrowLeftRightLine } from '@oxy.so/bloom/icons/RiArrowLeftRightLine';
import { RiCheckLine } from '@oxy.so/bloom/icons/RiCheckLine';
import { Badge } from '@oxy.so/bloom/badge';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Item } from '@oxy.so/bloom/item';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import type {
  Database,
  DatabaseProperty,
  DatabaseRow,
  DatabaseView,
  PropertyValue,
  RowGroup,
  SelectOption,
} from '@/lib/types/databases';
import { statusGroups } from '@/lib/status-groups';
import type { RowSection } from '@/lib/view-groups';
import { useCreateRow, useUpdateRow } from '@/lib/hooks/use-database-rows';
import { groupProperty, groupValue, rowSections, sectionOptions } from '@/lib/view-groups';
import { orderedProperties } from '@/lib/view-properties';
import { PropertyCell } from './property-cell';
import { useOpenRow } from './open-row';
import { SELECT_CHIP_HUE } from './select-color';
import { GroupHeader, useViewGroups } from './group-header';

interface ViewBoardProps {
  database: Database;
  view: DatabaseView;
  rows: DatabaseRow[];
  isLoading: boolean;
  readOnly?: boolean;
  /** More rows than these: the board reads them a page at a time. */
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** A sub-grouped board's sub-groups, in order (`GET …/rows`). */
  groups?: RowGroup[];
  /** May change the view: move, hide and collapse its sub-groups for every reader. */
  viewEditable?: boolean;
}

const COLUMN_WIDTH = 280;

/** A board's column: the rows whose group property holds `value`, shown as `option`. */
interface Column {
  option: SelectOption;
  rows: DatabaseRow[];
  /** What a card moved here, or made here, gets. */
  value: PropertyValue;
}

/** Columns under one heading: a status group's, or all of them under none. */
interface Section {
  id: string;
  label: string | null;
  columns: Column[];
}

/**
 * Board view — Kanban grouped by a select, status or checkbox property. Each
 * column corresponds to one option of the group property (a status's in the
 * order of its groups, To-do, In progress and Complete, under their names; a
 * checkbox's checked and not); moving a card to another column updates the
 * row's property value.
 *
 * On web a card is dragged (HTML5 DataTransfer). Everywhere, and on native
 * where nothing drags, its "Move to…" button or a long press on it opens the
 * columns to move it to.
 *
 * Sub-grouped (`subGroupBy`), the columns repeat in collapsible rows, one per
 * sub-group in the API's order: a card is in the row of its sub-group (a
 * card with two labels in both), and one added there gets it.
 */
export function ViewBoard({
  database,
  view,
  rows,
  isLoading,
  readOnly = false,
  hasMore = false,
  onLoadMore,
  groups,
  viewEditable = false,
}: ViewBoardProps) {
  const openRow = useOpenRow();
  const { t } = useTranslation();
  const createRow = useCreateRow();
  const updateRow = useUpdateRow();
  const moveControl = useDialogControl();
  // The card the "Move to" dialog moves: one dialog for the board, not one per card.
  const [moving, setMoving] = React.useState<DatabaseRow | null>(null);

  const groupByProperty = React.useMemo<DatabaseProperty | null>(() => {
    const target = view.groupBy?.propertyId;
    if (target) {
      const p = database.schema.properties.find((x) => x.id === target);
      if (p && (p.type === 'select' || p.type === 'status' || p.type === 'checkbox')) return p;
    }
    return (
      database.schema.properties.find((p) => p.type === 'status' || p.type === 'select') ?? null
    );
  }, [database.schema.properties, view.groupBy?.propertyId]);

  const buildSections = React.useCallback(
    (rows: DatabaseRow[]): Section[] => {
      if (!groupByProperty) return [];
      if (groupByProperty.type === 'checkbox') {
        const checked = (row: DatabaseRow) => {
          const value = row.properties[groupByProperty.id];
          return Boolean(value && typeof value === 'object' && 'checked' in value && value.checked);
        };
        return [
          {
            id: 'checkbox',
            label: null,
            columns: [
              {
                option: { id: 'checked', name: t('databases.board.checked'), color: 'green' },
                rows: rows.filter(checked),
                value: { checked: true },
              },
              {
                option: { id: 'unchecked', name: t('databases.board.unchecked'), color: 'default' },
                rows: rows.filter((row) => !checked(row)),
                value: { checked: false },
              },
            ],
          },
        ];
      }
      const options = groupByProperty.config?.options ?? [];
      const unassigned: DatabaseRow[] = [];
      const byOption = new Map<string, DatabaseRow[]>();
      for (const opt of options) byOption.set(opt.id, []);
      for (const row of rows) {
        const value = row.properties[groupByProperty.id];
        const optId =
          value && typeof value === 'object' && 'optionId' in value
            ? typeof value.optionId === 'string'
              ? value.optionId
              : null
            : null;
        const bucket = optId ? byOption.get(optId) : undefined;
        if (bucket) bucket.push(row);
        else unassigned.push(row);
      }
      const column = (opt: SelectOption): Column => ({
        option: opt,
        rows: byOption.get(opt.id) ?? [],
        value: { optionId: opt.id },
      });
      const none: Section = {
        id: '__unassigned__',
        label: null,
        columns: [
          {
            option: { id: '__unassigned__', name: t('databases.board.noStatus'), color: 'default' },
            rows: unassigned,
            value: { optionId: null },
          },
        ],
      };
      // A status grouped before groups existed shows its options as a select's.
      if (groupByProperty.type !== 'status' || !groupByProperty.config?.groups) {
        return [{ id: 'options', label: null, columns: options.map(column) }, none];
      }
      const byId = new Map(options.map((o) => [o.id, o]));
      return [
        ...statusGroups(options, groupByProperty.config.groups).map((group) => ({
          id: group.id,
          label: t(`databases.statusGroups.${group.id}`),
          columns: group.optionIds.flatMap((id) => {
            const opt = byId.get(id);
            return opt ? [column(opt)] : [];
          }),
        })),
        none,
      ];
    },
    [groupByProperty, t],
  );
  const sections = React.useMemo(() => buildSections(rows), [buildSections, rows]);

  const subGroup = groupProperty(database.schema.properties, view.subGroupBy);
  const lanes =
    subGroup && groups
      ? rowSections(rows, groups, {
          hideEmpty: view.subGroupBy?.hideEmpty,
          complete: !hasMore,
          ...sectionOptions(view),
        })
      : null;
  const laneKeys = lanes?.map((lane) => lane.key) ?? [];
  const viewLanes = useViewGroups(database.id, view, viewEditable, groups);

  const moveRow = React.useCallback(
    (rowId: string, value: PropertyValue) => {
      if (readOnly || !groupByProperty) return;
      updateRow.mutate({
        databaseId: database.id,
        rowId,
        properties: { [groupByProperty.id]: value },
      });
    },
    [database.id, groupByProperty, updateRow, readOnly],
  );

  // A card shows the first properties the view does not hide, in its order.
  const cardProperties = React.useMemo(() => {
    const hidden = new Set(view.hiddenProperties);
    return orderedProperties(database, view)
      .filter((p) => p.id !== 'name' && p.type !== 'rollup' && !hidden.has(p.id))
      .slice(0, 3);
  }, [database, view]);

  const startMove = (row: DatabaseRow) => {
    setMoving(row);
    moveControl.open();
  };

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

  /** The board's columns over `list`; a card added in one is in `lane` too. */
  const renderColumns = (list: Section[], lane: RowSection | null) =>
    list.map((section) => (
      <View key={section.id} className="gap-1">
        {section.label ? (
          <Text className="px-1 text-xs font-semibold text-muted-foreground">{section.label}</Text>
        ) : null}
        <View className="flex-row gap-3">
          {section.columns.map((column) => (
            <BoardColumn
              readOnly={readOnly}
              key={column.option.id}
              option={column.option}
              rows={column.rows}
              onAddRow={async () => {
                const inLane =
                  lane && subGroup ? groupValue(subGroup, lane.key, lane.range) : undefined;
                await createRow.mutateAsync({
                  databaseId: database.id,
                  properties: {
                    [groupByProperty.id]: column.value,
                    ...(subGroup && inLane !== undefined && { [subGroup.id]: inLane }),
                  },
                });
              }}
              onMoveTo={(rowId) => moveRow(rowId, column.value)}
              renderCard={(row) => (
                <BoardCard
                  key={row.id}
                  readOnly={readOnly}
                  row={row}
                  properties={cardProperties}
                  onOpen={() => openRow(row.id)}
                  onMove={() => startMove(row)}
                />
              )}
            />
          ))}
        </View>
      </View>
    ));

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View className={lanes ? 'gap-2 px-3 py-3' : 'flex-row gap-3 px-3 py-3'}>
        {lanes && subGroup
          ? lanes.map((lane) => {
              const collapsed = viewLanes.isCollapsed(lane.key);
              return (
                <View
                  key={`lane-${lane.key === null ? '\u0000' : lane.key}`}
                  testID={`board-lane-${lane.key ?? 'none'}`}
                  className="gap-1"
                >
                  <GroupHeader
                    property={subGroup}
                    groupKey={lane.key}
                    granularity={view.subGroupBy?.granularity}
                    range={lane.range}
                    count={lane.count}
                    collapsed={collapsed}
                    onToggle={() => viewLanes.toggle(lane.key)}
                    actions={viewLanes.actionsFor(lane.key, laneKeys)}
                  />
                  {collapsed ? null : (
                    <View className="flex-row gap-3">
                      {renderColumns(buildSections(lane.rows), lane)}
                    </View>
                  )}
                </View>
              );
            })
          : renderColumns(sections, null)}
        {hasMore && onLoadMore ? (
          <Button appearance="subtle" size="sm" className="self-start" onPress={onLoadMore}>
            {t('databases.board.loadMore')}
          </Button>
        ) : null}
      </View>
      {!readOnly ? (
        <MoveToDialog
          control={moveControl}
          columns={sections.flatMap((section) => section.columns)}
          current={moving ? (moving.id as string) : null}
          onPick={(column) => {
            if (moving) moveRow(moving.id, column.value);
            moveControl.close();
          }}
        />
      ) : null}
    </ScrollView>
  );
}

/** The columns a card can move to, the one it is in checked. */
function MoveToDialog({
  control,
  columns,
  current,
  onPick,
}: {
  control: ReturnType<typeof useDialogControl>;
  columns: Column[];
  /** The card being moved: its column is the one holding it. */
  current: string | null;
  onPick: (column: Column) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  return (
    <Dialog
      control={control}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={360}
      title={t('databases.board.moveTo')}
    >
      <View className="pb-4">
        {columns.map((column) => {
          const here = current !== null && column.rows.some((row) => row.id === current);
          return (
            <Item
              key={column.option.id}
              role="radio"
              selected={here}
              accessibilityLabel={column.option.name}
              title={
                <Chip size="xs" hue={SELECT_CHIP_HUE[column.option.color] ?? 'neutral'}>
                  {column.option.name}
                </Chip>
              }
              trailing={
                here ? <RiCheckLine width={14} height={14} fill={colors.foreground} /> : null
              }
              onPress={() => onPick(column)}
            />
          );
        })}
      </View>
    </Dialog>
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
  /** Opens the columns to move the card to. */
  onMove: () => void;
}

function BoardCard({ row, properties, onOpen, onMove, readOnly }: BoardCardProps) {
  const { t } = useTranslation();
  const title = row.title || t('databases.untitled');

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
      accessibilityLabel={title}
      accessibilityHint={readOnly ? undefined : t('databases.board.longPressHint')}
      onPress={onOpen}
      onLongPress={readOnly ? undefined : onMove}
      className="bg-card border border-border rounded-md px-3 py-2 shadow-sm"
      {...(dragHandlers as Record<string, unknown>)}
    >
      <View className="mb-1 flex-row items-start gap-1">
        <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={2}>
          {title}
        </Text>
        {!readOnly ? (
          <Button
            iconOnly
            appearance="plain"
            size="xs"
            // The card around the button opens the row.
            stopPropagation
            accessibilityLabel={t('databases.board.moveCard', { title })}
            onPress={onMove}
            leadingIcon={RiArrowLeftRightLine}
          />
        ) : null}
      </View>
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
