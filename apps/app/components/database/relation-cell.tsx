import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
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
import { useRelatedRows, useRowSearch } from '@/lib/hooks/use-database-rows';
import type { DatabaseRow } from '@/lib/types/databases';

/** A related row's title: its own, untitled, or why it cannot be shown. */
function useRelatedTitles(targetDatabaseId: string | undefined, value: string[]) {
  const { data, isError } = useRelatedRows(targetDatabaseId, value);
  const { t } = useTranslation();
  const byId = new Map((data ?? []).map((row) => [row.id, row]));
  return (id: string) => {
    const row = byId.get(id);
    // Read, and not there: no longer a live row of the related database.
    return (
      row?.title ||
      t(
        row
          ? 'databases.untitled'
          : isError || data
            ? 'databases.relations.unavailable'
            : 'common.loading',
      )
    );
  };
}

function useOpenRow() {
  const router = useRouter();
  return (id: string) => router.push({ pathname: '/p/[pageId]', params: { pageId: id } });
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
      <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
        {found.isPending ? (
          <Text className="py-2 text-sm text-muted-foreground">{t('common.loading')}</Text>
        ) : rows.length === 0 ? (
          <EmptyState
            variant="compact"
            title={t(
              found.isError ? 'databases.relations.searchFailed' : 'databases.relations.none',
            )}
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
      </ScrollView>
    </>
  );
}
