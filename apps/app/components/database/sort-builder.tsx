import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { RiSortAlphabetAsc } from '@oxy.so/bloom/icons/RiSortAlphabetAsc';
import { RiSortAlphabetDesc } from '@oxy.so/bloom/icons/RiSortAlphabetDesc';
import { RiArrowUpDownLine } from '@oxy.so/bloom/icons/RiArrowUpDownLine';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { Button } from '@oxy.so/bloom/button';
import { ButtonGroup, ButtonGroupItem } from '@oxy.so/bloom/button-group';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@oxy.so/bloom/select';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import type { Database, DatabaseView, ViewSort } from '@/lib/types/databases';
import { useUpdateView } from '@/lib/hooks/use-database-views';

interface SortBuilderProps {
  database: Database;
  view: DatabaseView;
}

/** The toolbar's Sort button and the dialog it opens. */
export function SortBuilder({ database, view }: SortBuilderProps) {
  const { t } = useTranslation();
  const updateView = useUpdateView();
  const control = useDialogControl();
  const [draft, setDraft] = React.useState<ViewSort[]>(view.sorts);
  const sortCount = view.sorts.length;

  const open = () => {
    setDraft(view.sorts);
    control.open();
  };

  const apply = async () => {
    await updateView.mutateAsync({
      databaseId: database.id,
      viewId: view.id,
      sorts: draft,
    });
    control.close();
  };

  const clearAll = async () => {
    setDraft([]);
    await updateView.mutateAsync({
      databaseId: database.id,
      viewId: view.id,
      sorts: [],
    });
    control.close();
  };

  const label =
    sortCount > 0
      ? t('databases.toolbar.sortCount', { count: sortCount })
      : t('databases.toolbar.sort');
  const existing = draft.map((s) => s.propertyId);
  const available = database.schema.properties.filter((p) => !existing.includes(p.id));

  return (
    <>
      <Button
        appearance={sortCount > 0 ? 'subtle' : 'plain'}
        tone={sortCount > 0 ? 'accent' : 'neutral'}
        size="sm"
        accessibilityLabel={label}
        onPress={open}
        leadingIcon={RiArrowUpDownLine}
      >
        {label}
      </Button>
      <Dialog
        control={control}
        placement={{ base: 'bottom', md: 'center' }}
        maxWidth={460}
        title={t('databases.sorts.title')}
        actions={[
          {
            label: t('databases.actions.apply'),
            shouldCloseOnPress: false,
            onPress: () => void apply(),
          },
          {
            label: t('databases.actions.clearAll'),
            color: 'cancel',
            shouldCloseOnPress: false,
            onPress: () => void clearAll(),
          },
          { label: t('common.cancel'), color: 'cancel' },
        ]}
      >
        <View className="gap-3 pb-4">
          {draft.length === 0 ? (
            <Text className="py-2 text-sm text-muted-foreground">{t('databases.sorts.empty')}</Text>
          ) : (
            draft.map((sort, idx) => (
              <SortRow
                // biome-ignore lint/suspicious/noArrayIndexKey: persisted sorts have no id and the same property may appear twice while editing; the row is controlled by this draft
                key={`${sort.propertyId}-${idx}`}
                database={database}
                sort={sort}
                onChange={(patch) =>
                  setDraft((prev) => {
                    const next = [...prev];
                    next[idx] = { ...next[idx], ...patch };
                    return next;
                  })
                }
                onRemove={() => setDraft((prev) => prev.filter((_, i) => i !== idx))}
              />
            ))
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button appearance="plain" size="sm" className="self-start" leadingIcon={RiAddLine}>
                {t('databases.sorts.add')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" label={t('databases.sorts.add')}>
              <ScrollView style={{ maxHeight: 220 }}>
                {available.length === 0 ? (
                  <DropdownMenuItem disabled>{t('databases.sorts.allAdded')}</DropdownMenuItem>
                ) : (
                  available.map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onPress={() =>
                        setDraft((prev) => [
                          ...prev,
                          { propertyId: p.id, direction: 'asc' } satisfies ViewSort,
                        ])
                      }
                    >
                      {p.name}
                    </DropdownMenuItem>
                  ))
                )}
              </ScrollView>
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
      </Dialog>
    </>
  );
}

interface SortRowProps {
  database: Database;
  sort: ViewSort;
  onChange: (patch: Partial<ViewSort>) => void;
  onRemove: () => void;
}

function SortRow({ database, sort, onChange, onRemove }: SortRowProps) {
  const { t } = useTranslation();
  const properties = database.schema.properties.map((p) => ({ value: p.id, label: p.name }));

  return (
    <View className="flex-row items-center gap-2 py-1">
      <Select
        size="sm"
        value={sort.propertyId}
        onValueChange={(propertyId) => onChange({ propertyId })}
      >
        <SelectTrigger label={t('databases.properties.property')}>
          <SelectValue placeholder={t('databases.properties.property')} />
          <SelectIcon />
        </SelectTrigger>
        <SelectContent
          label={t('databases.properties.property')}
          items={properties}
          renderItem={(item) => (
            <SelectItem value={item.value} label={item.label}>
              <SelectItemIndicator />
              <SelectItemText>{item.label}</SelectItemText>
            </SelectItem>
          )}
        />
      </Select>

      <ButtonGroup size="xs">
        <ButtonGroupItem
          iconOnly
          checked={sort.direction === 'asc'}
          accessibilityLabel={t('databases.properties.sortAscending')}
          onPress={() => onChange({ direction: 'asc' })}
          leadingIcon={RiSortAlphabetDesc}
        />
        <ButtonGroupItem
          iconOnly
          checked={sort.direction === 'desc'}
          accessibilityLabel={t('databases.properties.sortDescending')}
          onPress={() => onChange({ direction: 'desc' })}
          leadingIcon={RiSortAlphabetAsc}
        />
      </ButtonGroup>

      <View className="flex-1" />
      <Button
        iconOnly
        appearance="plain"
        size="xs"
        accessibilityLabel={t('common.delete')}
        onPress={onRemove}
        leadingIcon={RiDeleteBin6Line}
      />
    </View>
  );
}
