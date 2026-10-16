import { resultPropertyFromRows } from '@/lib/formula-results';
import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { RiFilter3Line } from '@oxy.so/bloom/icons/RiFilter3Line';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxy.so/bloom/segmented-control';
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
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import i18n from '@/lib/i18n';
import type {
  Database,
  DatabaseProperty,
  DatabaseRow,
  DatabaseView,
  FilterCondition,
  FilterGroup,
} from '@/lib/types/databases';
import { useUpdateView } from '@/lib/hooks/use-database-views';

interface FilterBuilderProps {
  database: Database;
  view: DatabaseView;
  rows: DatabaseRow[];
}

/** Operator values (sent to the API) offered per property type. */
const OPERATORS_BY_TYPE: Record<string, string[]> = {
  text: ['contains', 'equals', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  number: ['=', '!=', '>', '<', '>=', '<=', 'is_empty'],
  select: ['is', 'is_not', 'is_empty'],
  status: ['is', 'is_not', 'is_empty'],
  multi_select: ['contains', 'does_not_contain', 'is_empty'],
  date: ['before', 'after', 'on_or_before', 'on_or_after', 'equals', 'is_empty'],
  checkbox: ['is', 'is_not'],
  url: ['contains', 'equals', 'is_empty'],
  email: ['contains', 'equals', 'is_empty'],
  phone: ['contains', 'equals', 'is_empty'],
  person: ['contains', 'does_not_contain', 'is_empty'],
  relation: ['contains', 'does_not_contain', 'is_empty'],
  files: ['is_empty', 'is_not_empty'],
};

/** Translated at call time: the locale can change while the app runs. */
function operatorLabel(operator: string): string {
  switch (operator) {
    case 'contains':
      return i18n.t('databases.filters.operators.contains');
    case 'does_not_contain':
      return i18n.t('databases.filters.operators.doesNotContain');
    case 'equals':
      return i18n.t('databases.filters.operators.equals');
    case 'starts_with':
      return i18n.t('databases.filters.operators.startsWith');
    case 'ends_with':
      return i18n.t('databases.filters.operators.endsWith');
    case 'is_empty':
      return i18n.t('databases.filters.operators.isEmpty');
    case 'is_not_empty':
      return i18n.t('databases.filters.operators.isNotEmpty');
    case 'is':
      return i18n.t('databases.filters.operators.is');
    case 'is_not':
      return i18n.t('databases.filters.operators.isNot');
    case 'before':
      return i18n.t('databases.filters.operators.before');
    case 'after':
      return i18n.t('databases.filters.operators.after');
    case 'on_or_before':
      return i18n.t('databases.filters.operators.onOrBefore');
    case 'on_or_after':
      return i18n.t('databases.filters.operators.onOrAfter');
    case '!=':
      return '≠';
    case '>=':
      return '≥';
    case '<=':
      return '≤';
    default:
      return operator;
  }
}

function operatorsFor(type: string): { value: string; label: string }[] {
  const values = OPERATORS_BY_TYPE[type] ?? ['is_empty', 'is_not_empty'];
  return values.map((value) => ({ value, label: operatorLabel(value) }));
}

/**
 * The toolbar's Filter button and the dialog it opens — render the AND/OR tree
 * as a flat list of conditions (groups inside groups exist in the data model but
 * aren't exposed in the MVP UI to keep things simple).
 */
export function FilterBuilder({ database: sourceDatabase, view, rows }: FilterBuilderProps) {
  const database = {
    ...sourceDatabase,
    schema: {
      properties: sourceDatabase.schema.properties.map((property) =>
        resultPropertyFromRows(property, rows),
      ),
    },
  };
  const { t } = useTranslation();
  const updateView = useUpdateView();
  const control = useDialogControl();
  const [draft, setDraft] = React.useState<FilterGroup>(() => cloneFilterGroup(view.filters));
  const filterCount = countFilters(view.filters);

  const open = () => {
    setDraft(cloneFilterGroup(view.filters));
    control.open();
  };

  const apply = async () => {
    await updateView.mutateAsync({
      databaseId: database.id,
      viewId: view.id,
      filters: draft,
    });
    control.close();
  };

  const reset = async () => {
    const empty: FilterGroup = {
      kind: 'group',
      combinator: 'and',
      filters: [],
    };
    setDraft(empty);
    await updateView.mutateAsync({
      databaseId: database.id,
      viewId: view.id,
      filters: empty,
    });
    control.close();
  };

  const addCondition = (property: DatabaseProperty) => {
    const operator = operatorsFor(property.type)[0]?.value ?? 'is_empty';
    setDraft((prev) => ({
      ...prev,
      filters: [
        ...prev.filters,
        {
          kind: 'condition',
          propertyId: property.id,
          operator,
          value: property.type === 'checkbox' ? true : '',
        } satisfies FilterCondition,
      ],
    }));
  };

  const updateCondition = (index: number, patch: Partial<FilterCondition>) => {
    setDraft((prev) => {
      const next = [...prev.filters];
      const target = next[index];
      if (target?.kind !== 'condition') return prev;
      next[index] = { ...target, ...patch };
      return { ...prev, filters: next };
    });
  };

  const removeCondition = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      filters: prev.filters.filter((_, i) => i !== index),
    }));
  };

  const label =
    filterCount > 0
      ? t('databases.toolbar.filterCount', { count: filterCount })
      : t('databases.toolbar.filter');

  return (
    <>
      <Button
        appearance={filterCount > 0 ? 'subtle' : 'plain'}
        tone={filterCount > 0 ? 'accent' : 'neutral'}
        size="sm"
        accessibilityLabel={label}
        onPress={open}
        leadingIcon={RiFilter3Line}
      >
        {label}
      </Button>
      <Dialog
        control={control}
        placement={{ base: 'bottom', md: 'center' }}
        maxWidth={520}
        title={t('databases.filters.title')}
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
            onPress: () => void reset(),
          },
          { label: t('common.cancel'), color: 'cancel' },
        ]}
      >
        <View className="gap-3 pb-4">
          <SegmentedControl
            type="radio"
            size="sm"
            className="self-start"
            value={draft.combinator}
            onValueChange={(combinator) => setDraft((prev) => ({ ...prev, combinator }))}
          >
            {(['and', 'or'] as const).map((option) => (
              <SegmentedControlItem key={option} value={option}>
                <SegmentedControlItemText>
                  {option === 'and' ? t('databases.filters.and') : t('databases.filters.or')}
                </SegmentedControlItemText>
              </SegmentedControlItem>
            ))}
          </SegmentedControl>

          {draft.filters.length === 0 ? (
            <Text className="py-4 text-sm text-muted-foreground">
              {t('databases.filters.empty')}
            </Text>
          ) : (
            draft.filters.map((filter, idx) =>
              filter.kind === 'condition' ? (
                <ConditionRow
                  // biome-ignore lint/suspicious/noArrayIndexKey: persisted conditions have no id, and a key derived from the condition would remount the row (closing its pickers) on every edit
                  key={idx}
                  database={database}
                  filter={filter}
                  onChange={(patch) => updateCondition(idx, patch)}
                  onRemove={() => removeCondition(idx)}
                />
              ) : null,
            )
          )}

          <PropertyMenu
            label={t('databases.filters.add')}
            properties={database.schema.properties}
            onPick={addCondition}
          />
        </View>
      </Dialog>
    </>
  );
}

interface ConditionRowProps {
  database: Database;
  filter: FilterCondition;
  onChange: (patch: Partial<FilterCondition>) => void;
  onRemove: () => void;
}

function ConditionRow({ database, filter, onChange, onRemove }: ConditionRowProps) {
  const { t } = useTranslation();
  const property = database.schema.properties.find((p) => p.id === filter.propertyId);
  const operators = property ? operatorsFor(property.type) : [];

  return (
    <View className="flex-row flex-wrap items-center gap-2 py-1">
      <OptionSelect
        label={t('databases.properties.property')}
        value={filter.propertyId}
        options={database.schema.properties.map((p) => ({ value: p.id, label: p.name }))}
        onValueChange={(id) => {
          const next = database.schema.properties.find((p) => p.id === id);
          if (!next) return;
          onChange({
            propertyId: id,
            operator: operatorsFor(next.type)[0]?.value ?? 'is_empty',
            value: next.type === 'checkbox' ? true : '',
          });
        }}
      />
      <OptionSelect
        value={filter.operator}
        options={operators}
        onValueChange={(operator) => onChange({ operator })}
      />
      <View className="min-w-32 flex-1">
        <ConditionValueInput
          property={property ?? null}
          operator={filter.operator}
          value={filter.value}
          onChange={(value) => onChange({ value })}
        />
      </View>
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

interface OptionSelectProps {
  label?: string;
  value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
}

/** A compact picker for one of a condition's fixed choices. */
function OptionSelect({ label, value, options, onValueChange }: OptionSelectProps) {
  return (
    <Select size="sm" value={value} onValueChange={onValueChange}>
      <SelectTrigger label={label}>
        <SelectValue />
        <SelectIcon />
      </SelectTrigger>
      <SelectContent
        label={label}
        items={options}
        renderItem={(item) => (
          <SelectItem value={item.value} label={item.label}>
            <SelectItemIndicator />
            <SelectItemText>{item.label}</SelectItemText>
          </SelectItem>
        )}
      />
    </Select>
  );
}

interface PropertyMenuProps {
  label: string;
  properties: DatabaseProperty[];
  onPick: (property: DatabaseProperty) => void;
}

/** "+ Add" button opening the database's properties. */
function PropertyMenu({ label, properties, onPick }: PropertyMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button appearance="plain" size="sm" className="self-start" leadingIcon={RiAddLine}>
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" label={label}>
        <ScrollView style={{ maxHeight: 220 }}>
          {properties.map((p) => (
            <DropdownMenuItem key={p.id} onPress={() => onPick(p)}>
              {p.name}
            </DropdownMenuItem>
          ))}
        </ScrollView>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ConditionValueInputProps {
  property: DatabaseProperty | null;
  operator: string;
  value: unknown;
  onChange: (next: unknown) => void;
}

function ConditionValueInput({ property, operator, value, onChange }: ConditionValueInputProps) {
  const { t } = useTranslation();
  // Operators that don't take a value
  if (operator === 'is_empty' || operator === 'is_not_empty') {
    return <View />;
  }

  if (property?.type === 'checkbox') {
    return (
      <SegmentedControl
        type="radio"
        size="sm"
        className="self-start"
        label={t('databases.filters.value')}
        value={value === true ? 'checked' : value === false ? 'unchecked' : ''}
        onValueChange={(next) => onChange(next === 'checked')}
      >
        <SegmentedControlItem value="checked">
          <SegmentedControlItemText>{t('databases.filters.checked')}</SegmentedControlItemText>
        </SegmentedControlItem>
        <SegmentedControlItem value="unchecked">
          <SegmentedControlItemText>{t('databases.filters.unchecked')}</SegmentedControlItemText>
        </SegmentedControlItem>
      </SegmentedControl>
    );
  }

  if (property?.type === 'select' || property?.type === 'status') {
    const opts = property.config?.options ?? [];
    return (
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('databases.filters.value')}
        className="flex-row flex-wrap gap-1"
      >
        {opts.map((o) => (
          <Chip
            key={o.id}
            size="sm"
            role="radio"
            selected={value === o.id}
            onPress={() => onChange(o.id)}
          >
            {o.name}
          </Chip>
        ))}
      </View>
    );
  }

  const text = typeof value === 'string' ? value : String(value ?? '');
  return (
    <TextFieldInput
      size="sm"
      value={text}
      onChangeText={(text) =>
        onChange(
          property?.type === 'number' && text.trim() && Number.isFinite(Number(text))
            ? Number(text)
            : text,
        )
      }
      keyboardType={property?.type === 'number' ? 'numeric' : 'default'}
      label={t('databases.filters.value')}
    />
  );
}

function countFilters(group: FilterGroup): number {
  let count = 0;
  for (const f of group.filters) {
    if (f.kind === 'condition') count += 1;
    else count += countFilters(f);
  }
  return count;
}

function cloneFilterGroup(group: FilterGroup): FilterGroup {
  return {
    kind: 'group',
    combinator: group.combinator,
    filters: group.filters.map((f) => (f.kind === 'condition' ? { ...f } : cloneFilterGroup(f))),
  };
}
