import * as React from 'react';
import { Pressable, View } from 'react-native';
import {
  ProjectBoard,
  BoardDragHandle,
  type BoardColumn,
  type ControlledProjectBoardProps,
} from '@oxy.so/bloom/project-board';
import { Screen } from '@oxy.so/bloom/screen';
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
import { toast } from '@oxy.so/bloom/toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import type {
  Database,
  DatabaseProperty,
  DatabaseRow,
  DatabaseView,
  PropertyValue,
  RowGroup,
} from '@/lib/types/databases';
import {
  boardMoveValue,
  boardSections,
  boardValueKeys,
  canGroupBoard,
  type BoardColumnData as Column,
  type BoardSection as Section,
} from '@/lib/board-groups';
import { profileName, useMemberProfiles } from '@/lib/hooks/use-member-profiles';
import { useUpdateView } from '@/lib/hooks/use-database-views';
import { rankBy } from '@/lib/list-order';
import { useCreateRow, useUpdateRow, useRelatedRows } from '@/lib/hooks/use-database-rows';
import { groupValue, type RowSection } from '@/lib/view-groups';
import { CardPreview, cardProperties as visibleCardProperties, cardWidth } from './card-layout';
import { PropertyCell } from './property-cell';
import { useOpenRow } from './open-row';
import { SELECT_CHIP_HUE } from './select-color';
import { GroupBadge, GroupActionsMenu, useGroupedSections } from './group-header';
import { useGroupLabel } from './group-label';

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

/**
 * Board view — Kanban grouped by options, people, relations or a checkbox. Each
 * column corresponds to one option of the group property (a status's in the
 * order of its groups, To-do, In progress and Complete, under their names; a
 * checkbox's checked and not); moving a card to another column updates the
 * row's property value.
 *
 * Bloom shares ProjectBoard's pointer, touch and keyboard engine. The title
 * is the drag handle; property controls remain independently editable. The
 * "Move to…" button also opens the columns to move the card to.
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
  const updateView = useUpdateView();
  const moveControl = useDialogControl();
  // The card the "Move to" dialog moves: one dialog for the board, not one per card.
  const [moving, setMoving] = React.useState<{ row: DatabaseRow; columnId: string } | null>(null);

  const groupByProperty = React.useMemo<DatabaseProperty | null>(() => {
    const target = view.groupBy?.propertyId;
    if (target) {
      const p = database.schema.properties.find((x) => x.id === target);
      if (p && canGroupBoard(p)) return p;
    }
    return (
      database.schema.properties.find((p) => p.type === 'status') ??
      database.schema.properties.find(canGroupBoard) ??
      null
    );
  }, [database.schema.properties, view.groupBy?.propertyId]);

  const referenceIds = React.useMemo(
    () =>
      groupByProperty && ['person', 'relation'].includes(groupByProperty.type)
        ? [...new Set(rows.flatMap((row) => boardValueKeys(row.properties[groupByProperty.id])))]
        : [],
    [groupByProperty, rows],
  );
  const { data: profiles } = useMemberProfiles(
    groupByProperty?.type === 'person' ? referenceIds : [],
  );
  const { data: related } = useRelatedRows(
    groupByProperty?.type === 'relation' ? groupByProperty.config?.targetDatabaseId : undefined,
    groupByProperty?.type === 'relation' ? referenceIds : [],
  );
  const buildSections = React.useCallback(
    (items: DatabaseRow[]): Section[] =>
      groupByProperty
        ? boardSections(groupByProperty, items, {
            checked: t('databases.board.checked'),
            unchecked: t('databases.board.unchecked'),
            unassigned: ['person', 'relation', 'multi_select'].includes(groupByProperty.type)
              ? t('databases.groups.none', { name: groupByProperty.name })
              : t('databases.board.noStatus'),
            statusGroup: (id) => t(`databases.statusGroups.${id}`),
            referenceIds,
            reference: (id) =>
              groupByProperty.type === 'person'
                ? (profileName(profiles?.find((person) => person.id === id)) ??
                  t('databases.people.unknown'))
                : related?.find((row) => row.id === id)?.title ||
                  t('databases.relations.unavailable'),
          })
        : [],
    [groupByProperty, profiles, related, referenceIds, t],
  );
  const sections = React.useMemo(() => buildSections(rows), [buildSections, rows]);

  const {
    grouping: subGroup,
    sections: lanes,
    isCollapsed,
    headerProps,
  } = useGroupedSections(database, view, rows, groups, hasMore, 'subGroupBy', viewEditable);

  const laneLabel = useGroupLabel(
    subGroup ?? { id: 'name', name: '', type: 'text' },
    view.subGroupBy?.granularity,
  );

  const moveRow = React.useCallback(
    (rowId: string, value: PropertyValue, fromColumnId?: string) => {
      if (readOnly || !groupByProperty) return;
      const row = rows.find((item) => item.id === rowId);
      if (!row) return;
      const source = sections
        .flatMap((section) => section.columns)
        .find((column) => column.option.id === fromColumnId);
      const next = source
        ? boardMoveValue(groupByProperty, row.properties[groupByProperty.id], source.value, value)
        : value;
      updateRow.mutate(
        { databaseId: database.id, rowId, properties: { [groupByProperty.id]: next } },
        { onError: () => toast.error(t('databases.rows.saveFailed')) },
      );
    },
    [database.id, groupByProperty, updateRow, readOnly, t, rows, sections],
  );

  // A card shows every property enabled in the view, in its order.
  const cardProperties = React.useMemo(() => {
    return visibleCardProperties(database, view);
  }, [database, view]);

  const startMove = (row: DatabaseRow, columnId: string) => {
    setMoving({ row, columnId });
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

  const columnsFor = (list: Section[]) => {
    const unordered = list.flatMap((section) =>
      section.columns.map((column) => ({
        ...column,
        id: column.option.id,
        title: column.option.name,
        items: column.rows,
        sectionId: section.id,
        sectionLabel: section.label,
      })),
    );
    const order = view.config.boardColumnOrder;
    return rankBy(
      unordered,
      order?.propertyId === groupByProperty.id ? order.columnIds : [],
      (column) => column.id,
    ).map((column, index, sorted) => ({
      ...column,
      sectionLabel: sorted[index - 1]?.sectionId === column.sectionId ? null : column.sectionLabel,
    }));
  };
  const columns = columnsFor(sections);
  const byId = new Map(columns.map((column) => [column.id, column]));
  const hasSectionLabels = sections.some((section) => section.label);
  const laneId = (lane: RowSection) => JSON.stringify(lane.key);
  const byLaneId = new Map(lanes?.map((lane) => [laneId(lane), lane]));
  const boardProps: Omit<ControlledProjectBoardProps<DatabaseRow>, 'variant' | 'columns'> = {
    accessibilityLabel: view.name,
    getItemId: (row) => row.id,
    getItemLabel: (row) => row.title || t('databases.untitled'),
    columnWidth: cardWidth(view),
    readOnly,
    dragMode: 'handle',
    allowReorder: false,
    onColumnOrderChange:
      viewEditable && !readOnly && !updateView.isPending
        ? (columnIds) =>
            updateView.mutate(
              {
                databaseId: database.id,
                viewId: view.id,
                config: {
                  ...view.config,
                  boardColumnOrder: { propertyId: groupByProperty.id, columnIds: [...columnIds] },
                },
              },
              { onError: () => toast.error(t('databases.views.updateFailed')) },
            )
        : undefined,
    onMove: ({ itemId, fromColumnId, toColumnId }) => {
      const target = byId.get(toColumnId);
      if (target) moveRow(itemId, target.value, fromColumnId);
    },
    renderColumnHeader: (column) => {
      const source = byId.get(column.id);
      if (!source) return null;
      return (
        <View className="gap-2 px-1">
          {hasSectionLabels ? (
            <Text className="text-xs font-semibold text-muted-foreground">
              {source.sectionLabel ?? ' '}
            </Text>
          ) : null}
          <View className="flex-row items-center gap-2">
            <Chip size="xs" hue={SELECT_CHIP_HUE[source.option.color] ?? 'neutral'}>
              {column.title}
            </Chip>
            <Badge content={column.items.length} variant="subtle" tone="neutral" />
          </View>
        </View>
      );
    },
    renderCard: (row, column) => (
      <BoardCard
        readOnly={readOnly}
        row={row}
        preview={<CardPreview row={row} view={view} database={database} />}
        properties={cardProperties}
        onChange={(propertyId, value) => {
          if (readOnly) return;
          updateRow.mutate(
            { databaseId: database.id, rowId: row.id, properties: { [propertyId]: value } },
            { onError: () => toast.error(t('databases.rows.saveFailed')) },
          );
        }}
        onOpen={() => openRow(row.id)}
        onMove={() => startMove(row, column.id)}
      />
    ),
  };
  const renderColumnFooter = (column: BoardColumn<DatabaseRow>, lane?: RowSection) =>
    readOnly ? null : (
      <Button
        appearance="plain"
        size="sm"
        leadingIcon={RiAddLine}
        className="self-start"
        disabled={createRow.isPending}
        accessibilityLabel={t('databases.groups.addRow', { name: column.title })}
        onPress={() => {
          const target = byId.get(column.id);
          if (!target || readOnly) return;
          const inLane = lane && subGroup ? groupValue(subGroup, lane.key, lane.range) : undefined;
          createRow.mutate(
            {
              databaseId: database.id,
              properties: {
                [groupByProperty.id]: target.value,
                ...(subGroup && inLane !== undefined && { [subGroup.id]: inLane }),
              },
            },
            {
              onSuccess: (row) => openRow(row.id),
              onError: () => toast.error(t('databases.rows.createFailed')),
            },
          );
        }}
      >
        {t('databases.actions.new')}
      </Button>
    );

  return (
    <Screen
      scroll="none"
      bottomBar={
        hasMore && onLoadMore ? (
          <Button appearance="subtle" size="sm" onPress={onLoadMore}>
            {t('databases.board.loadMore')}
          </Button>
        ) : undefined
      }
    >
      {lanes && subGroup ? (
        <ProjectBoard
          {...boardProps}
          variant="grouped"
          lanes={lanes.map((lane) => ({
            id: laneId(lane),
            title: laneLabel(lane.key, lane.range),
            columns: columnsFor(buildSections(lane.rows)),
            collapsed: isCollapsed(lane.key),
          }))}
          onLaneCollapsedChange={(id, collapsed) => {
            const lane = byLaneId.get(id);
            if (lane && isCollapsed(lane.key) !== collapsed) headerProps(lane).onToggle();
          }}
          renderLaneHeader={(group) => {
            const lane = byLaneId.get(group.id);
            return lane ? (
              <View className="flex-row items-center gap-2">
                <GroupBadge property={subGroup} groupKey={lane.key} label={group.title} />
                <Text className="text-xs text-muted-foreground">
                  {t('databases.groups.count', { count: lane.count })}
                </Text>
              </View>
            ) : null;
          }}
          renderLaneActions={(group) => {
            const lane = byLaneId.get(group.id);
            const actions = lane ? headerProps(lane).actions : undefined;
            return actions ? <GroupActionsMenu actions={actions} label={group.title} /> : null;
          }}
          renderColumnFooter={(column, group) => renderColumnFooter(column, byLaneId.get(group.id))}
        />
      ) : (
        <ProjectBoard
          {...boardProps}
          variant="embedded"
          columns={columns}
          renderColumnFooter={(column) => renderColumnFooter(column)}
        />
      )}
      {!readOnly ? (
        <MoveToDialog
          control={moveControl}
          columns={sections.flatMap((section) => section.columns)}
          current={moving?.columnId ?? null}
          onPick={(column) => {
            if (moving) moveRow(moving.row.id, column.value, moving.columnId);
            moveControl.close();
          }}
        />
      ) : null}
    </Screen>
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
  /** The occurrence being moved, including when a page belongs to several groups. */
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
          const here = current === column.option.id;
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

interface BoardCardProps {
  readOnly: boolean;
  row: DatabaseRow;
  preview: React.ReactNode;
  onChange: (propertyId: string, value: PropertyValue) => void;
  /** The properties the card shows, in order. */
  properties: DatabaseProperty[];
  onOpen: () => void;
  /** Opens the columns to move the card to. */
  onMove: () => void;
}

function BoardCard({
  row,
  preview,
  properties,
  onOpen,
  onMove,
  onChange,
  readOnly,
}: BoardCardProps) {
  const { t } = useTranslation();
  const title = row.title || t('databases.untitled');

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={title}
      onPress={onOpen}
      className="overflow-hidden"
    >
      {preview}
      <View className="px-3 py-2">
        <View className="mb-1 flex-row items-start gap-1">
          {readOnly ? (
            <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={2}>
              {title}
            </Text>
          ) : (
            <BoardDragHandle
              style={{ flex: 1 }}
              accessibilityLabel={t('databases.board.dragCard', { title })}
              onPress={onOpen}
            >
              <Text className="text-sm font-medium text-foreground" numberOfLines={2}>
                {title}
              </Text>
            </BoardDragHandle>
          )}
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
                onChange={(value) => onChange(property.id, value)}
              />
            </View>
          ))}
        </View>
      </View>
    </Pressable>
  );
}
