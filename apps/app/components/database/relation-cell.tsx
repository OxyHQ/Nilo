import * as React from 'react';
import { Pressable, View } from 'react-native';
import { RiArrowRightUpLine } from '@oxy.so/bloom/icons/RiArrowRightUpLine';
import { RiCheckLine } from '@oxy.so/bloom/icons/RiCheckLine';
import { RiCloseLine } from '@oxy.so/bloom/icons/RiCloseLine';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Item } from '@oxy.so/bloom/item';
import { Popover, PopoverContent, PopoverTrigger } from '@oxy.so/bloom/popover';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import {
  type RelatedRowSet,
  useRelatedRows,
  useRelatedRowSets,
  useRowSearch,
} from '@/lib/hooks/use-database-rows';
import type { Database, DatabaseRow, PropertyValue } from '@/lib/types/databases';
import { useOpenRow } from './open-row';

/** The page ids a relation value points at. */
export function readPageIds(v: PropertyValue): string[] {
  if (v && typeof v === 'object' && 'pageIds' in v) {
    const ids = v.pageIds;
    if (Array.isArray(ids)) {
      return ids.filter((id): id is string => typeof id === 'string');
    }
  }
  return [];
}

const RelatedRowsContext = React.createContext<ReadonlyMap<string, RelatedRowSet> | null>(null);

/**
 * The rows the relations of a view's `rows` point at, read once per related
 * database for all of them rather than once per cell: a cell reads its own
 * only for a row the view did not list (a row's panel, a value just picked).
 */
export function RelatedRowsProvider({
  database,
  rows,
  children,
}: {
  database: Database;
  rows: readonly DatabaseRow[];
  children: React.ReactNode;
}) {
  const wanted = React.useMemo(() => {
    const byTarget = new Map<string, Set<string>>();
    for (const property of database.schema.properties) {
      const target = property.type === 'relation' ? property.config?.targetDatabaseId : undefined;
      if (!target) continue;
      const ids = byTarget.get(target) ?? new Set<string>();
      byTarget.set(target, ids);
      for (const row of rows)
        for (const id of readPageIds(row.properties[property.id])) ids.add(id);
    }
    return [...byTarget].map(([databaseId, ids]) => ({ databaseId, ids: [...ids].sort() }));
  }, [database.schema.properties, rows]);
  const shared = useRelatedRowSets(wanted);
  return <RelatedRowsContext.Provider value={shared}>{children}</RelatedRowsContext.Provider>;
}

/** A related row's title: its own, untitled, or why it cannot be shown. */
function useRelatedTitles(targetDatabaseId: string | undefined, value: string[]) {
  const shared = React.useContext(RelatedRowsContext)?.get(targetDatabaseId ?? '');
  const own = shared ? value.filter((id) => !shared.requested.has(id)) : value;
  const { data, isError } = useRelatedRows(targetDatabaseId, own);
  const { t } = useTranslation();
  const byId = new Map((data ?? []).map((row) => [row.id, row]));
  return (id: string) => {
    const fromView = shared?.requested.has(id) ? shared : null;
    const row = fromView ? fromView.rows.get(id) : byId.get(id);
    const read = fromView ? fromView.readIds.has(id) : Boolean(data);
    // Read, and not there: no longer a live row of the related database.
    return (
      row?.title ||
      t(
        row
          ? 'databases.untitled'
          : (fromView ? fromView.isError : isError) || read
            ? 'databases.relations.unavailable'
            : 'common.loading',
      )
    );
  };
}

interface RelationCellProps {
  value: string[];
  targetDatabaseId?: string;
  /** Without it the cell only shows its rows (a reader, a card). */
  onChange?: (pageIds: string[]) => void;
  label?: string;
  variant?: 'table' | 'panel' | 'card';
}

/**
 * The rows a relation points at, as pills that open them, read in one request
 * for the cell. Editable, it opens a picker that searches the related
 * database's rows to add or remove one.
 */
export function RelationCell({
  value,
  targetDatabaseId,
  onChange,
  label,
  variant = 'table',
}: RelationCellProps) {
  const titleOf = useRelatedTitles(targetDatabaseId, value);
  const openRow = useOpenRow();
  const [open, setOpen] = React.useState(false);
  const { t } = useTranslation();

  const pills = (
    <View className="flex-row flex-wrap gap-1">
      {value.map((id) => {
        const title = titleOf(id);
        return (
          <Chip
            key={id}
            size="sm"
            // The cell or card around the pill opens the row, or the picker.
            stopPropagation
            accessibilityLabel={title}
            onPress={() => openRow(id)}
          >
            {title}
          </Chip>
        );
      })}
    </View>
  );
  if (!onChange || variant === 'card') return pills;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          className={variant === 'table' ? 'min-h-6 py-0.5' : 'min-h-6 py-1'}
        >
          {value.length > 0 ? pills : <Text className="text-sm text-muted-foreground">—</Text>}
        </Pressable>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        minWidth={300}
        label={label ?? t('databases.relations.pick')}
        className="gap-2"
      >
        {open ? (
          <RelationPicker
            value={value}
            targetDatabaseId={targetDatabaseId}
            titleOf={titleOf}
            onOpenRow={(id) => {
              setOpen(false);
              openRow(id);
            }}
            onChange={onChange}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

interface RelationPickerProps {
  value: string[];
  targetDatabaseId?: string;
  titleOf: (id: string) => string;
  onOpenRow: (id: string) => void;
  onChange: (pageIds: string[]) => void;
}

function RelationPicker({
  value,
  targetDatabaseId,
  titleOf,
  onOpenRow,
  onChange,
}: RelationPickerProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const [query, setQuery] = React.useState('');
  const found = useRowSearch(targetDatabaseId, query);

  if (!targetDatabaseId) {
    return <EmptyState variant="compact" title={t('databases.relations.noTarget')} />;
  }
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const rows: DatabaseRow[] = found.data ?? [];

  return (
    <>
      {value.map((id) => (
        <View key={id} className="flex-row items-center gap-1">
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t('databases.relations.open', { title: titleOf(id) })}
            className="flex-1 flex-row items-center gap-2 py-1"
            onPress={() => onOpenRow(id)}
          >
            <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
              {titleOf(id)}
            </Text>
            <RiArrowRightUpLine width={14} height={14} fill={colors.mutedForeground} />
          </Pressable>
          <Button
            iconOnly
            appearance="plain"
            size="xs"
            accessibilityLabel={t('databases.relations.remove', { title: titleOf(id) })}
            onPress={() => toggle(id)}
            leadingIcon={RiCloseLine}
          />
        </View>
      ))}
      <TextFieldInput
        size="sm"
        label={t('databases.filters.searchRows')}
        value={query}
        onChangeText={setQuery}
      />

      {found.isPending ? (
        <Text className="py-2 text-sm text-muted-foreground">{t('common.loading')}</Text>
      ) : rows.length === 0 ? (
        <EmptyState
          variant="compact"
          title={t(found.isError ? 'databases.relations.searchFailed' : 'databases.relations.none')}
        />
      ) : (
        rows.map((row) => {
          const selected = value.includes(row.id);
          const title = row.title || t('databases.untitled');
          return (
            <Item
              key={row.id}
              density="compact"
              role="checkbox"
              selected={selected}
              accessibilityLabel={title}
              title={title}
              trailing={
                selected ? <RiCheckLine width={14} height={14} fill={colors.foreground} /> : null
              }
              onPress={() => toggle(row.id)}
            />
          );
        })
      )}
    </>
  );
}
