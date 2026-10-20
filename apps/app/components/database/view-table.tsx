import { type NestedRow, nestSubItems, subItemProperties, useExpandedRows } from '@/lib/sub-items';
import { SubItemToggle, NewSubItem } from './sub-item-controls';
import * as React from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import {
  NAME_PROPERTY_ID,
  type Database,
  type DatabaseProperty,
  type DatabaseRow,
  type DatabaseView,
  type CalculationValues,
  type PropertyValue,
  type RowGroup,
} from '@/lib/types/databases';
import { useCreateRow, useUpdateRow } from '@/lib/hooks/use-database-rows';
import { useUpdateView } from '@/lib/hooks/use-database-views';
import { useViewCalculations } from '@/lib/hooks/use-view-data';
import { groupTakesRows } from '@/lib/view-groups';
import { place } from '@/lib/list-order';
import { columnWidth, moveProperty, orderedProperties } from '@/lib/view-properties';
import { PropertyCell } from './property-cell';
import { PropertyHeaderMenu } from './property-config-modal';
import { useOpenRow } from './open-row';
import { CalculationCell } from './calculation-cell';
import { ColumnResizeHandle } from './column-resize-handle';
import { GroupHeader, useGroupedSections } from './group-header';
import { useGroupLabel } from './group-label';

interface ViewTableProps {
  database: Database;
  view: DatabaseView;
  rows: DatabaseRow[];
  isLoading: boolean;
  readOnly?: boolean;
  /** The columns' menus (rename, sort, hide…) are not offered: a locked database's, a reader's. */
  schemaReadOnly?: boolean;
  /** May change the view itself: resize and move its columns, pick its calculations. */
  viewEditable?: boolean;
  /** A grouped view's groups, in order (`GET …/rows`). */
  groups?: RowGroup[];
  /** More rows than these are to load. */
  hasMore?: boolean;
}

const ADD_COLUMN_WIDTH = 60;
/** The drag payload of a column header (web). */
const COLUMN_DRAG_TYPE = 'application/x-nilo-column';

/**
 * Table view — spreadsheet-style. Renders the row's title in a fixed
 * first column, then one column per visible property, in the view's own
 * order (`config.propertyOrder`) and at its widths (`config.columnWidths`).
 * Each cell uses the shared `PropertyCell` so editing is consistent across
 * views. Whoever may change the view drags a column's edge to resize it and
 * its header to move it (web), or moves it from its menu (everywhere).
 *
 * Grouped (`groupBy`), the rows come in collapsible sections, one per group
 * with its count, in the API's order (the view's own first), each with its
 * own footer; the view's footer computes each column over every row of the
 * view (`config.calculations`). Whoever may change the view moves, hides
 * and collapses groups for every reader (`useViewGroups`).
 *
 * Frozen columns (`view.frozenProperties`: the Name and the properties up to
 * one, as the view's settings set them) come first and stay put while the
 * table scrolls sideways: they are moved back by exactly the scroll offset,
 * on the native driver where there is one, so each row stays one row and its
 * cells keep one height.
 */
export function ViewTable({
  database,
  view,
  rows,
  isLoading,
  readOnly = false,
  schemaReadOnly = readOnly,
  viewEditable = !schemaReadOnly,
  groups,
  hasMore = false,
}: ViewTableProps) {
  const openRow = useOpenRow();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const createRow = useCreateRow();
  const updateView = useUpdateView();
  const subItems = subItemProperties(database);
  const { expanded, toggleExpanded } = useExpandedRows(database.id);
  const newSubItem = (parentId: string) => {
    if (!subItems || readOnly) return;
    createRow.mutate({
      databaseId: database.id,
      properties: { [subItems.parent.id]: { pageIds: [parentId] } },
    });
  };
  const updateRow = useUpdateRow();

  const frozen = React.useMemo(() => new Set(view.frozenProperties ?? []), [view.frozenProperties]);
  // In the view's order: the frozen properties first, then the others.
  const ordered = React.useMemo(() => orderedProperties(database, view), [database, view]);
  const visibleProperties = React.useMemo(() => {
    const shown = ordered.filter(
      (p) => !view.hiddenProperties.includes(p.id) && p.id !== NAME_PROPERTY_ID,
    );
    return [...shown.filter((p) => frozen.has(p.id)), ...shown.filter((p) => !frozen.has(p.id))];
  }, [ordered, view.hiddenProperties, frozen]);
  const frozenCount = visibleProperties.filter((p) => frozen.has(p.id)).length;
  const titleFrozen = frozen.has(NAME_PROPERTY_ID) || frozenCount > 0;
  const nameProperty = database.schema.properties.find((p) => p.id === NAME_PROPERTY_ID);

  const widths = useColumnWidths(view);
  const widthOf = widths.of;
  const titleWidth = widthOf(NAME_PROPERTY_ID);
  const visibleKey = visibleProperties.map((p) => p.id).join('\u0000');
  // biome-ignore lint/correctness/useExhaustiveDependencies: the sum changes with the columns shown, named by `visibleKey`; each column's value is the same object for good
  const tableWidth = React.useMemo(
    () =>
      visibleProperties.reduce<Animated.AnimatedAddition | Animated.Value>(
        (sum, p) => Animated.add(sum, widthOf(p.id)),
        Animated.add(titleWidth, ADD_COLUMN_WIDTH),
      ),
    [visibleKey],
  );

  const saveConfig = (config: DatabaseView['config']) =>
    updateView.mutate(
      { databaseId: database.id, viewId: view.id, config: { ...view.config, ...config } },
      { onError: () => toast.error(t('databases.views.updateFailed')) },
    );
  const commitWidth = (id: string, width: number) => {
    widths.set(id, width);
    saveConfig({ columnWidths: { ...(view.config?.columnWidths ?? {}), [id]: width } });
  };

  const orderIds = ordered.map((p) => p.id);
  const visibleIds = visibleProperties.map((p) => p.id);
  const moveColumn = (id: string, by: -1 | 1) => {
    const next = moveProperty(orderIds, visibleIds, id, by);
    if (next) saveConfig({ propertyOrder: next });
  };
  const dropColumn = (id: string, onto: string) => {
    const side = visibleIds.indexOf(id) < visibleIds.indexOf(onto) ? 'after' : 'before';
    const next = place(orderIds, id, onto, side);
    if (next) saveConfig({ propertyOrder: next });
  };

  const scrollX = React.useRef(new Animated.Value(0)).current;
  const onScroll = React.useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: Platform.OS !== 'web',
      }),
    [scrollX],
  );

  const calculations = view.config?.calculations ?? {};
  const hasCalculations = Object.keys(calculations).length > 0;
  const computed = useViewCalculations(database.id, view.id, hasCalculations);

  const { grouping, sections, isCollapsed, headerProps, newRowIn } = useGroupedSections(
    database,
    view,
    rows,
    groups,
    hasMore,
    'groupBy',
    viewEditable,
  );
  const groupLabel = useGroupLabel(
    grouping ?? (nameProperty as DatabaseProperty),
    view.groupBy?.granularity,
  );
  // Each section's rows with their sub-items, nested once per change rather than per render.
  const parentPropertyId = subItems?.parent.id;
  const nested = React.useMemo(
    () =>
      new Map<string | null | typeof UNGROUPED, NestedRow[]>(
        sections
          ? sections.map((section) => [
              section.key,
              nestSubItems(section.rows, parentPropertyId, expanded),
            ])
          : [[UNGROUPED, nestSubItems(rows, parentPropertyId, expanded)]],
      ),
    [sections, rows, parentPropertyId, expanded],
  );

  const handleNewRow = React.useCallback(async () => {
    if (readOnly) return;
    await createRow.mutateAsync({ databaseId: database.id });
  }, [createRow, database.id, readOnly]);

  // `mutate` is the same function for the mutation's life, so the cells' memo holds.
  const updateRowNow = updateRow.mutate;
  const handleCellChange = React.useCallback(
    (rowId: string, propertyId: string, value: PropertyValue) => {
      if (readOnly) return;
      updateRowNow({
        databaseId: database.id,
        rowId,
        properties: { [propertyId]: value },
      });
    },
    [database.id, updateRowNow, readOnly],
  );

  const handleTitleChange = React.useCallback(
    (rowId: string, title: string) => {
      if (readOnly) return;
      updateRow.mutate({
        databaseId: database.id,
        rowId,
        title,
      });
    },
    [database.id, updateRow, readOnly],
  );

  if (isLoading) {
    return (
      <View className="py-10 items-center">
        <Loading variant="spinner" />
      </View>
    );
  }

  /** A footer: each column's calculation over `values`' rows (the view's, or a group's). */
  const renderFooter = (values: CalculationValues | undefined, testID: string) => (
    <Animated.View style={{ minWidth: tableWidth }}>
      <View className="flex-row" testID={testID}>
        <FrozenCell frozen={titleFrozen} last={frozenCount === 0} scrollX={scrollX}>
          <Animated.View style={{ width: titleWidth }}>
            {nameProperty ? (
              <CalculationCell
                database={database}
                view={view}
                property={nameProperty}
                value={values?.[NAME_PROPERTY_ID]?.value}
                width="100%"
                editable={viewEditable}
              />
            ) : null}
          </Animated.View>
        </FrozenCell>
        {visibleProperties.map((property, index) => (
          <FrozenCell
            key={property.id}
            frozen={index < frozenCount}
            last={index === frozenCount - 1}
            scrollX={scrollX}
          >
            <Animated.View style={{ width: widthOf(property.id) }}>
              <CalculationCell
                database={database}
                view={view}
                property={property}
                value={values?.[property.id]?.value}
                width="100%"
                editable={viewEditable}
              />
            </Animated.View>
          </FrozenCell>
        ))}
      </View>
    </Animated.View>
  );
  const groupCalculations = (key: string | null) =>
    computed.data?.groups?.find((group) => group.key === key)?.calculations;

  const renderRows = (list: readonly NestedRow[], keyPrefix: string) =>
    list.map((entry) => {
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
        <View key={`${keyPrefix}${row.id}`} className="flex-row border-b border-border/60">
          <FrozenCell frozen={titleFrozen} last={frozenCount === 0} scrollX={scrollX}>
            <Animated.View style={{ width: titleWidth, flex: 1 }}>
              <Pressable
                className="flex-1 px-3 py-2 border-r border-border/60 flex-row items-center"
                style={{ paddingLeft: 12 + depth * 24 }}
                accessibilityRole="link"
                accessibilityLabel={row.title || t('databases.untitled')}
                onPress={() => openRow(row.id)}
              >
                {subItems ? (
                  <SubItemToggle
                    expanded={expanded.has(row.id)}
                    title={row.title}
                    onPress={() => toggleExpanded(row.id)}
                  />
                ) : null}
                <TitleCell
                  readOnly={readOnly}
                  initial={row.title}
                  onChange={(next) => handleTitleChange(row.id, next)}
                />
              </Pressable>
            </Animated.View>
          </FrozenCell>
          {visibleProperties.map((property, index) => (
            <FrozenCell
              key={property.id}
              frozen={index < frozenCount}
              last={index === frozenCount - 1}
              scrollX={scrollX}
            >
              <Animated.View style={{ width: widthOf(property.id), flex: 1 }}>
                <View className="px-3 py-2 border-r border-border/60 justify-center flex-1">
                  <TableCell
                    readOnly={readOnly}
                    property={property}
                    value={row.properties[property.id] ?? null}
                    rowId={row.id}
                    onCellChange={handleCellChange}
                  />
                </View>
              </Animated.View>
            </FrozenCell>
          ))}
          <View style={{ width: ADD_COLUMN_WIDTH }} />
        </View>
      );
    });

  return (
    <Animated.ScrollView
      horizontal
      showsHorizontalScrollIndicator
      onScroll={onScroll}
      scrollEventThrottle={16}
    >
      <View>
        {/* header row */}
        <Animated.View style={{ minWidth: tableWidth }}>
          <View className="flex-row border-y border-border bg-muted/30">
            <FrozenCell
              testID="table-title-header"
              frozen={titleFrozen}
              last={frozenCount === 0}
              scrollX={scrollX}
            >
              <Animated.View style={{ width: titleWidth }}>
                <View
                  className={`px-3 py-2 border-r border-border ${titleFrozen ? 'bg-muted/30' : ''}`}
                >
                  <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('common.name')}
                  </Text>
                  {viewEditable && Platform.OS === 'web' ? (
                    <ColumnResizeHandle
                      width={() => widths.now(NAME_PROPERTY_ID)}
                      label={t('databases.columns.resize', { name: t('common.name') })}
                      onResize={(width) => widths.set(NAME_PROPERTY_ID, width)}
                      onCommit={(width) => commitWidth(NAME_PROPERTY_ID, width)}
                    />
                  ) : null}
                </View>
              </Animated.View>
            </FrozenCell>
            {visibleProperties.map((property, index) => (
              <FrozenCell
                key={property.id}
                testID={`table-header-${property.id}`}
                frozen={index < frozenCount}
                last={index === frozenCount - 1}
                scrollX={scrollX}
              >
                <ColumnHeader
                  readOnly={schemaReadOnly}
                  movable={viewEditable}
                  database={database}
                  view={view}
                  property={property}
                  width={widthOf(property.id)}
                  widthNow={() => widths.now(property.id)}
                  frozen={index < frozenCount}
                  onMove={(by) => moveColumn(property.id, by)}
                  canMoveLeft={index > 0}
                  canMoveRight={index < visibleProperties.length - 1}
                  onColumnDropped={(id) => dropColumn(id, property.id)}
                  onResize={(width) => widths.set(property.id, width)}
                  onCommitWidth={(width) => commitWidth(property.id, width)}
                />
              </FrozenCell>
            ))}
            <View
              className="px-3 py-2 items-center justify-center"
              style={{ width: ADD_COLUMN_WIDTH }}
            />
          </View>
        </Animated.View>

        {/* rows */}
        {rows.length === 0 && !sections?.length ? (
          <EmptyState
            // icon: Table
            variant="compact"
            title={t('databases.table.empty')}
          />
        ) : sections && grouping ? (
          sections.map((section) => {
            const collapsed = isCollapsed(section.key);
            const prefix = `${section.key === null ? '\u0000' : section.key}:`;
            return (
              <View key={`group-${prefix}`} testID={`table-group-${section.key ?? 'none'}`}>
                <Animated.View style={{ minWidth: tableWidth }}>
                  <View className="border-b border-border/60">
                    <GroupHeader {...headerProps(section)} />
                  </View>
                </Animated.View>
                {collapsed ? null : (
                  <>
                    {renderRows(nested.get(section.key) ?? [], prefix)}
                    {!readOnly && groupTakesRows(grouping) ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('databases.groups.addRow', {
                          name: groupLabel(section.key, section.range),
                        })}
                        disabled={createRow.isPending}
                        onPress={() => createRow.mutate(newRowIn(section))}
                        className="flex-row items-center gap-2 px-3 py-1.5 border-b border-border/60 hover:bg-muted/40"
                      >
                        <RiAddLine width={12} height={12} fill={colors.mutedForeground} />
                        <Text className="text-xs text-muted-foreground">
                          {t('databases.actions.new')}
                        </Text>
                      </Pressable>
                    ) : null}
                    {/* The group's own footer, over all its rows. */}
                    {hasCalculations
                      ? renderFooter(
                          groupCalculations(section.key),
                          `table-group-footer-${section.key ?? 'none'}`,
                        )
                      : null}
                  </>
                )}
              </View>
            );
          })
        ) : (
          renderRows(nested.get(UNGROUPED) ?? [], '')
        )}

        {/* new row */}
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
            onPress={handleNewRow}
            className="flex-row items-center gap-2 px-3 py-2 border-b border-border/60 hover:bg-muted/40"
          >
            <RiAddLine width={14} height={14} fill={colors.mutedForeground} />
            <Text className="text-sm text-muted-foreground">
              {createRow.isPending ? t('databases.actions.adding') : t('databases.actions.new')}
            </Text>
          </Pressable>
        ) : null}

        {/* footer: each column calculated over all the view's rows */}
        {viewEditable || hasCalculations
          ? renderFooter(computed.data?.calculations, 'table-footer')
          : null}
      </View>
    </Animated.ScrollView>
  );
}

interface FrozenCellProps {
  frozen: boolean;
  /** The last frozen column, edged where the others scroll under it. */
  last: boolean;
  scrollX: Animated.Value;
  testID?: string;
  children: React.ReactNode;
}

/**
 * A cell of a frozen column: moved back as far as the table scrolled, opaque
 * and above the cells passing under it. Any other cell is laid out as is.
 */
/** The ungrouped table's rows, in `nested`. */
const UNGROUPED = Symbol('ungrouped');

/**
 * A table's column widths as they are drawn: an animated value per column,
 * so one being dragged moves its column without a render of every row.
 * Released, it is saved; once the view holds new widths (saved, or changed
 * elsewhere), those are shown.
 */
function useColumnWidths(view: DatabaseView) {
  const anims = React.useRef(new Map<string, Animated.Value>()).current;
  const current = React.useRef(new Map<string, number>()).current;
  const columnWidths = view.config?.columnWidths;
  const of = (id: string): Animated.Value => {
    let anim = anims.get(id);
    if (!anim) {
      const width = columnWidth(view, id);
      anim = new Animated.Value(width);
      anims.set(id, anim);
      current.set(id, width);
    }
    return anim;
  };
  const set = (id: string, width: number) => {
    of(id).setValue(width);
    current.set(id, width);
  };
  React.useEffect(() => {
    for (const [id, anim] of anims) {
      const width = columnWidth({ config: { columnWidths } }, id);
      anim.setValue(width);
      current.set(id, width);
    }
  }, [anims, current, columnWidths]);
  return { of, set, now: (id: string) => current.get(id) ?? columnWidth(view, id) };
}

/**
 * A row's cell, drawn again only when its value, its property or what it may
 * do changes: a table's other rows are not redrawn when one cell is edited.
 */
const TableCell = React.memo(function TableCell({
  readOnly,
  property,
  value,
  rowId,
  onCellChange,
}: {
  readOnly: boolean;
  property: DatabaseProperty;
  value: PropertyValue;
  rowId: string;
  onCellChange: (rowId: string, propertyId: string, value: PropertyValue) => void;
}) {
  return (
    <PropertyCell
      readOnly={readOnly}
      property={property}
      value={value}
      variant="table"
      rowId={rowId}
      onChange={(next) => onCellChange(rowId, property.id, next)}
    />
  );
});

function FrozenCell({ frozen, last, scrollX, testID, children }: FrozenCellProps) {
  if (!frozen) return <View testID={testID}>{children}</View>;
  return (
    <Animated.View testID={testID} style={{ transform: [{ translateX: scrollX }], zIndex: 1 }}>
      <View
        className={last ? 'flex-1 bg-background border-r-2 border-border' : 'flex-1 bg-background'}
      >
        {children}
      </View>
    </Animated.View>
  );
}

interface ColumnHeaderProps {
  database: Database;
  view: DatabaseView;
  property: DatabaseProperty;
  readOnly: boolean;
  /** May resize and move the column (the view's editors). */
  movable: boolean;
  width: Animated.Value;
  /** Its width now, as a resize starts from it. */
  widthNow: () => number;
  /** Painted as the header row is, over the frozen cell's opaque background. */
  frozen?: boolean;
  onMove: (by: -1 | 1) => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  /** Another column's header dropped on this one (web). */
  onColumnDropped: (propertyId: string) => void;
  onResize: (width: number) => void;
  onCommitWidth: (width: number) => void;
}

function ColumnHeader({
  database,
  view,
  property,
  readOnly,
  movable,
  width,
  widthNow,
  frozen = false,
  onMove,
  canMoveLeft,
  canMoveRight,
  onColumnDropped,
  onResize,
  onCommitWidth,
}: ColumnHeaderProps) {
  const menu = useDialogControl();
  const { t } = useTranslation();
  const web = Platform.OS === 'web' && movable;
  // Web-only: the header's name is dragged onto another header to move its
  // column there; its edge, not draggable, resizes it.
  const dragSource = web
    ? {
        draggable: true,
        onDragStart: (e: { dataTransfer: DataTransfer }) => {
          e.dataTransfer.setData(COLUMN_DRAG_TYPE, property.id);
          e.dataTransfer.effectAllowed = 'move';
        },
      }
    : {};
  const dropTarget = web
    ? {
        onDragOver: (e: { preventDefault: () => void; dataTransfer: DataTransfer }) => {
          if (e.dataTransfer.types.includes(COLUMN_DRAG_TYPE)) e.preventDefault();
        },
        onDrop: (e: { preventDefault: () => void; dataTransfer: DataTransfer }) => {
          const id = e.dataTransfer.getData(COLUMN_DRAG_TYPE);
          if (!id) return;
          e.preventDefault();
          onColumnDropped(id);
        },
      }
    : {};
  return (
    <Animated.View style={{ width }}>
      <View
        className={`px-3 py-2 border-r border-border flex-row items-center justify-between ${frozen ? 'bg-muted/30' : ''}`}
        {...(dropTarget as Record<string, unknown>)}
      >
        <Pressable
          disabled={readOnly}
          accessibilityRole="button"
          accessibilityLabel={property.name}
          accessibilityHint={web ? t('databases.columns.drag', { name: property.name }) : undefined}
          onPress={() => menu.open()}
          className="flex-1"
          {...(dragSource as Record<string, unknown>)}
        >
          <Text
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            numberOfLines={1}
          >
            {property.name}
          </Text>
        </Pressable>
        {!readOnly ? (
          <PropertyHeaderMenu
            control={menu}
            database={database}
            view={view}
            property={property}
            move={movable ? { onMove, left: canMoveLeft, right: canMoveRight } : undefined}
          />
        ) : null}
        {web ? (
          <ColumnResizeHandle
            width={widthNow}
            label={t('databases.columns.resize', { name: property.name })}
            onResize={onResize}
            onCommit={onCommitWidth}
          />
        ) : null}
      </View>
    </Animated.View>
  );
}

interface TitleCellProps {
  initial: string;
  readOnly: boolean;
  onChange: (next: string) => void;
}

function TitleCell({ initial, onChange, readOnly }: TitleCellProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [draft, setDraft] = React.useState(initial);
  React.useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const commit = () => {
    if (draft !== initial) onChange(draft);
  };

  if (Platform.OS === 'web' && !readOnly) {
    return (
      <input
        aria-label={t('common.name')}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={t('databases.untitled')}
        style={{
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: colors.foreground,
          fontSize: 14,
          width: '100%',
        }}
      />
    );
  }
  // Native: simple read-only label that opens the row on tap.
  return (
    <Text variant="body-regular" numberOfLines={1}>
      {draft || t('databases.untitled')}
    </Text>
  );
}
