import { nestSubItems, subItemProperties, useExpandedRows } from '@/lib/sub-items';
import { SubItemToggle, NewSubItem } from './sub-item-controls';
import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import type {
  Database,
  DatabaseProperty,
  DatabaseRow,
  DatabaseView,
  PropertyValue,
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
}

const DEFAULT_COL_WIDTH = 200;
const TITLE_COL_WIDTH = 280;

/**
 * Table view — spreadsheet-style. Renders the row's title in a fixed
 * first column, then one column per visible property. Each cell uses the
 * shared `PropertyCell` so editing is consistent across views.
 */
export function ViewTable({ database, view, rows, isLoading, readOnly = false }: ViewTableProps) {
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

  const visibleProperties = React.useMemo(() => {
    return database.schema.properties.filter(
      (p) => !view.hiddenProperties.includes(p.id) && p.id !== 'name',
    );
  }, [database.schema.properties, view.hiddenProperties]);

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
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View>
        {/* header row */}
        <View
          className="flex-row border-y border-border bg-muted/30"
          style={{ minWidth: TITLE_COL_WIDTH + visibleProperties.length * DEFAULT_COL_WIDTH + 60 }}
        >
          <View className="px-3 py-2 border-r border-border" style={{ width: TITLE_COL_WIDTH }}>
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('common.name')}
            </Text>
          </View>
          {visibleProperties.map((property) => (
            <ColumnHeader
              readOnly={readOnly}
              key={property.id}
              database={database}
              view={view}
              property={property}
            />
          ))}
          <View className="px-3 py-2 items-center justify-center" style={{ width: 60 }} />
        </View>

        {/* rows */}
        {rows.length === 0 ? (
          <View className="py-10 items-center w-full">
            <Text className="text-sm text-muted-foreground">{t('databases.table.empty')}</Text>
          </View>
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
                <Pressable
                  className="px-3 py-2 border-r border-border/60 flex-row items-center"
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
                {visibleProperties.map((property) => (
                  <View
                    key={property.id}
                    className="px-3 py-2 border-r border-border/60 justify-center"
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
            <Plus size={14} color={colors.mutedForeground} />
            <Text className="text-sm text-muted-foreground">
              {createRow.isPending ? t('databases.actions.adding') : t('databases.actions.new')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

interface ColumnHeaderProps {
  database: Database;
  view: DatabaseView;
  property: DatabaseProperty;
  readOnly: boolean;
}

function ColumnHeader({ database, view, property, readOnly }: ColumnHeaderProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  return (
    <View
      className="px-3 py-2 border-r border-border flex-row items-center justify-between"
      style={{ width: DEFAULT_COL_WIDTH }}
    >
      <Pressable
        disabled={readOnly}
        accessibilityRole="button"
        accessibilityLabel={property.name}
        onPress={() => setMenuOpen(true)}
        className="flex-1"
      >
        <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {property.name}
        </Text>
      </Pressable>
      {!readOnly ? (
        <PropertyHeaderMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          database={database}
          view={view}
          property={property}
        />
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
    <Text className="text-sm text-foreground" numberOfLines={1}>
      {draft || t('databases.untitled')}
    </Text>
  );
}
