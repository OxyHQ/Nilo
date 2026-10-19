import { nestSubItems, subItemProperties, useExpandedRows } from '@/lib/sub-items';
import { SubItemToggle, NewSubItem } from './sub-item-controls';
import * as React from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { useDialogControl } from '@oxy.so/bloom/dialog';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import {
  NAME_PROPERTY_ID,
  type Database,
  type DatabaseProperty,
  type DatabaseRow,
  type DatabaseView,
  type PropertyValue,
} from '@/lib/types/databases';
import { useCreateRow, useUpdateRow } from '@/lib/hooks/use-database-rows';
import { PropertyCell } from './property-cell';
import { PropertyHeaderMenu } from './property-config-modal';

interface ViewTableProps {
  database: Database;
  view: DatabaseView;
  rows: DatabaseRow[];
  isLoading: boolean;
  readOnly?: boolean;
  /** The columns' menus (rename, sort, hide…) are not offered: a locked database's, a reader's. */
  schemaReadOnly?: boolean;
}

const DEFAULT_COL_WIDTH = 200;
const TITLE_COL_WIDTH = 280;

/**
 * Table view — spreadsheet-style. Renders the row's title in a fixed
 * first column, then one column per visible property. Each cell uses the
 * shared `PropertyCell` so editing is consistent across views.
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
}: ViewTableProps) {
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
  const updateRow = useUpdateRow();

  const frozen = React.useMemo(() => new Set(view.frozenProperties ?? []), [view.frozenProperties]);
  // The frozen properties first, in the database's order, then the others.
  const visibleProperties = React.useMemo(() => {
    const shown = database.schema.properties.filter(
      (p) => !view.hiddenProperties.includes(p.id) && p.id !== NAME_PROPERTY_ID,
    );
    return [...shown.filter((p) => frozen.has(p.id)), ...shown.filter((p) => !frozen.has(p.id))];
  }, [database.schema.properties, view.hiddenProperties, frozen]);
  const frozenCount = visibleProperties.filter((p) => frozen.has(p.id)).length;
  const titleFrozen = frozen.has(NAME_PROPERTY_ID) || frozenCount > 0;
  const scrollX = React.useRef(new Animated.Value(0)).current;
  const onScroll = React.useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: Platform.OS !== 'web',
      }),
    [scrollX],
  );

  const handleNewRow = React.useCallback(async () => {
    if (readOnly) return;
    await createRow.mutateAsync({ databaseId: database.id });
  }, [createRow, database.id, readOnly]);

  const handleCellChange = React.useCallback(
    (rowId: string, propertyId: string, value: PropertyValue) => {
      if (readOnly) return;
      updateRow.mutate({
        databaseId: database.id,
        rowId,
        properties: { [propertyId]: value },
      });
    },
    [database.id, updateRow, readOnly],
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

  return (
    <Animated.ScrollView
      horizontal
      showsHorizontalScrollIndicator
      onScroll={onScroll}
      scrollEventThrottle={16}
    >
      <View>
        {/* header row */}
        <View
          className="flex-row border-y border-border bg-muted/30"
          style={{ minWidth: TITLE_COL_WIDTH + visibleProperties.length * DEFAULT_COL_WIDTH + 60 }}
        >
          <FrozenCell
            testID="table-title-header"
            frozen={titleFrozen}
            last={frozenCount === 0}
            scrollX={scrollX}
          >
            <View
              className={`px-3 py-2 border-r border-border ${titleFrozen ? 'bg-muted/30' : ''}`}
              style={{ width: TITLE_COL_WIDTH }}
            >
              <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('common.name')}
              </Text>
            </View>
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
                database={database}
                view={view}
                property={property}
                frozen={index < frozenCount}
              />
            </FrozenCell>
          ))}
          <View className="px-3 py-2 items-center justify-center" style={{ width: 60 }} />
        </View>

        {/* rows */}
        {rows.length === 0 ? (
          <EmptyState
            // icon: Table
            variant="compact"
            title={t('databases.table.empty')}
          />
        ) : (
          nestedRows.map((entry) => {
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
              <View key={row.id} className="flex-row border-b border-border/60">
                <FrozenCell frozen={titleFrozen} last={frozenCount === 0} scrollX={scrollX}>
                  <Pressable
                    className="flex-1 px-3 py-2 border-r border-border/60 flex-row items-center"
                    style={{ width: TITLE_COL_WIDTH, paddingLeft: 12 + depth * 24 }}
                    accessibilityRole="link"
                    accessibilityLabel={row.title || t('databases.untitled')}
                    onPress={() => router.push(`/p/${row.id}`)}
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
                </FrozenCell>
                {visibleProperties.map((property, index) => (
                  <FrozenCell
                    key={property.id}
                    frozen={index < frozenCount}
                    last={index === frozenCount - 1}
                    scrollX={scrollX}
                  >
                    <View
                      className="px-3 py-2 border-r border-border/60 justify-center flex-1"
                      style={{ width: DEFAULT_COL_WIDTH }}
                    >
                      <PropertyCell
                        readOnly={readOnly}
                        property={property}
                        value={row.properties[property.id] ?? null}
                        variant="table"
                        onChange={(value) => handleCellChange(row.id, property.id, value)}
                      />
                    </View>
                  </FrozenCell>
                ))}
                <View style={{ width: 60 }} />
              </View>
            );
          })
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
  /** Painted as the header row is, over the frozen cell's opaque background. */
  frozen?: boolean;
}

function ColumnHeader({ database, view, property, readOnly, frozen = false }: ColumnHeaderProps) {
  const menu = useDialogControl();
  return (
    <View
      className={`px-3 py-2 border-r border-border flex-row items-center justify-between ${frozen ? 'bg-muted/30' : ''}`}
      style={{ width: DEFAULT_COL_WIDTH }}
    >
      <Pressable
        disabled={readOnly}
        accessibilityRole="button"
        accessibilityLabel={property.name}
        onPress={() => menu.open()}
        className="flex-1"
      >
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {property.name}
        </Text>
      </Pressable>
      {!readOnly ? (
        <PropertyHeaderMenu control={menu} database={database} view={view} property={property} />
      ) : null}
    </View>
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
