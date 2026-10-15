import { resultPropertyFromRows } from '@/lib/formula-results';
import * as React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ChevronDown, Plus, Trash2 } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import i18n from '@/lib/i18n';
import { useColorScheme } from '@/lib/useColorScheme';
import type {
  Database,
  DatabaseProperty,
  DatabaseRow,
  DatabaseView,
  FilterCondition,
  FilterGroup,
} from '@/lib/types/databases';
import { useUpdateView } from '@/lib/hooks/use-database-views';
import { centeredModalStyle } from './centered-modal-style';

interface FilterBuilderProps {
  open: boolean;
  onClose: () => void;
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
 * Filter builder modal — render the AND/OR tree as a flat list of
 * conditions (groups inside groups exist in the data model but aren't
 * exposed in the MVP UI to keep things simple).
 */
export function FilterBuilder({
  open,
  onClose,
  database: sourceDatabase,
  view,
  rows,
}: FilterBuilderProps) {
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
  const [draft, setDraft] = React.useState<FilterGroup>(() => cloneFilterGroup(view.filters));

  React.useEffect(() => {
    if (open) setDraft(cloneFilterGroup(view.filters));
  }, [open, view.filters]);

  const apply = async () => {
    await updateView.mutateAsync({
      databaseId: database.id,
      viewId: view.id,
      filters: draft,
    });
    onClose();
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
    onClose();
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

  const setCombinator = (combinator: 'and' | 'or') => {
    setDraft((prev) => ({ ...prev, combinator }));
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} className="bg-black/50" onPress={onClose} />
      <View
        className="absolute left-0 right-0 bottom-0 web:bottom-auto web:top-1/2 web:left-1/2"
        style={centeredModalStyle(520, 480)}
      >
        <View className="bg-popover border border-border rounded-2xl shadow-xl p-4 m-3 web:m-0 gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-semibold text-foreground">
              {t('databases.filters.title')}
            </Text>
            <CombinatorPicker value={draft.combinator} onChange={setCombinator} />
          </View>

          <ScrollView style={{ maxHeight: 360 }} className="gap-2">
            {draft.filters.length === 0 ? (
              <View className="py-4">
                <Text className="text-sm text-muted-foreground">
                  {t('databases.filters.empty')}
                </Text>
              </View>
            ) : (
              draft.filters.map((filter, idx) =>
                filter.kind === 'condition' ? (
                  <ConditionRow
                    key={idx}
                    database={database}
                    filter={filter}
                    onChange={(patch) => updateCondition(idx, patch)}
                    onRemove={() => removeCondition(idx)}
                  />
                ) : null,
              )
            )}
          </ScrollView>

          <AddConditionButton database={database} onPick={addCondition} />

          <View className="flex-row justify-end gap-2 mt-2">
            <Pressable onPress={reset} className="px-3 py-1.5 rounded-md bg-muted">
              <Text className="text-sm text-foreground">{t('databases.actions.clearAll')}</Text>
            </Pressable>
            <Pressable onPress={onClose} className="px-3 py-1.5 rounded-md bg-muted">
              <Text className="text-sm text-foreground">{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('databases.actions.apply')}
              onPress={apply}
              className="px-3 py-1.5 rounded-md bg-primary"
            >
              <Text className="text-sm text-primary-foreground">
                {t('databases.actions.apply')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface CombinatorPickerProps {
  value: 'and' | 'or';
  onChange: (next: 'and' | 'or') => void;
}

function CombinatorPicker({ value, onChange }: CombinatorPickerProps) {
  const { t } = useTranslation();
  return (
    <View className="flex-row rounded-md border border-border overflow-hidden">
      {(['and', 'or'] as const).map((option) => (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          className={`px-2 py-1 ${value === option ? 'bg-primary' : 'bg-muted'}`}
        >
          <Text
            className={`text-xs uppercase ${
              value === option ? 'text-primary-foreground' : 'text-foreground'
            }`}
          >
            {option === 'and' ? t('databases.filters.and') : t('databases.filters.or')}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

interface ConditionRowProps {
  database: Database;
  filter: FilterCondition;
  onChange: (patch: Partial<FilterCondition>) => void;
  onRemove: () => void;
}

function ConditionRow({ database, filter, onChange, onRemove }: ConditionRowProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [propertyOpen, setPropertyOpen] = React.useState(false);
  const [operatorOpen, setOperatorOpen] = React.useState(false);

  const property = database.schema.properties.find((p) => p.id === filter.propertyId);
  const operators = property ? operatorsFor(property.type) : [];

  return (
    <View className="flex-row items-center gap-2 py-1">
      <PickerButton
        label={property?.name ?? t('databases.properties.property')}
        onPress={() => setPropertyOpen((s) => !s)}
      />
      <PickerButton
        label={operators.find((o) => o.value === filter.operator)?.label ?? filter.operator}
        onPress={() => setOperatorOpen((s) => !s)}
      />
      <View className="flex-1">
        <ConditionValueInput
          property={property ?? null}
          operator={filter.operator}
          value={filter.value}
          onChange={(value) => onChange({ value })}
        />
      </View>
      <Pressable onPress={onRemove} className="p-1.5 rounded hover:bg-muted">
        <Trash2 size={12} color={colors.mutedForeground} />
      </Pressable>

      {propertyOpen ? (
        <ListPopover
          onClose={() => setPropertyOpen(false)}
          options={database.schema.properties.map((p) => ({
            value: p.id,
            label: p.name,
          }))}
          onSelect={(id) => {
            const next = database.schema.properties.find((p) => p.id === id);
            if (!next) return;
            onChange({
              propertyId: id,
              operator: operatorsFor(next.type)[0]?.value ?? 'is_empty',
              value: next.type === 'checkbox' ? true : '',
            });
            setPropertyOpen(false);
          }}
        />
      ) : null}

      {operatorOpen ? (
        <ListPopover
          onClose={() => setOperatorOpen(false)}
          options={operators.map((o) => ({ value: o.value, label: o.label }))}
          onSelect={(op) => {
            onChange({ operator: op });
            setOperatorOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}

interface PickerButtonProps {
  label: string;
  onPress: () => void;
}

function PickerButton({ label, onPress }: PickerButtonProps) {
  const { colors } = useColorScheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-1 px-2 py-1 rounded-md bg-muted/60"
    >
      <Text className="text-xs text-foreground">{label}</Text>
      <ChevronDown size={10} color={colors.mutedForeground} />
    </Pressable>
  );
}

interface ListPopoverProps {
  onClose: () => void;
  options: { value: string; label: string }[];
  onSelect: (value: string) => void;
}

function ListPopover({ onClose, options, onSelect }: ListPopoverProps) {
  // Renders inline below the trigger as an absolute box. Pressing
  // outside dismisses.
  return (
    <View
      style={{
        position: 'absolute',
        top: 32,
        left: 0,
        zIndex: 50,
      }}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} className="-inset-screen" />
      <View className="bg-popover border border-border rounded-md shadow-xl p-1 min-w-[160px]">
        <ScrollView style={{ maxHeight: 220 }}>
          {options.map((o) => (
            <Pressable
              key={o.value}
              onPress={() => onSelect(o.value)}
              className="px-2 py-1.5 rounded hover:bg-muted"
            >
              <Text className="text-xs text-foreground">{o.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

interface ConditionValueInputProps {
  property: DatabaseProperty | null;
  operator: string;
  value: unknown;
  onChange: (next: unknown) => void;
}

function ConditionValueInput({ property, operator, value, onChange }: ConditionValueInputProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  // Operators that don't take a value
  if (operator === 'is_empty' || operator === 'is_not_empty') {
    return <View />;
  }

  if (property?.type === 'checkbox') {
    return (
      <View className="flex-row items-center gap-2">
        <Pressable
          onPress={() => onChange(true)}
          className={`px-2 py-1 rounded-md ${value === true ? 'bg-primary' : 'bg-muted'}`}
        >
          <Text
            className={`text-xs ${value === true ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('databases.filters.checked')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onChange(false)}
          className={`px-2 py-1 rounded-md ${value === false ? 'bg-primary' : 'bg-muted'}`}
        >
          <Text
            className={`text-xs ${value === false ? 'text-primary-foreground' : 'text-foreground'}`}
          >
            {t('databases.filters.unchecked')}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (property?.type === 'select' || property?.type === 'status') {
    const opts = property.config?.options ?? [];
    return (
      <View className="flex-row flex-wrap gap-1">
        {opts.map((o) => (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            className={`px-2 py-1 rounded-md ${value === o.id ? 'bg-primary' : 'bg-muted'}`}
          >
            <Text
              className={`text-xs ${
                value === o.id ? 'text-primary-foreground' : 'text-foreground'
              }`}
            >
              {o.name}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }

  const text = typeof value === 'string' ? value : String(value ?? '');
  return (
    <TextInput
      value={text}
      onChangeText={(text) =>
        onChange(
          property?.type === 'number' && text.trim() && Number.isFinite(Number(text))
            ? Number(text)
            : text,
        )
      }
      keyboardType={property?.type === 'number' ? 'numeric' : 'default'}
      accessibilityLabel={t('databases.filters.value')}
      placeholder={t('databases.filters.value')}
      placeholderTextColor={colors.mutedForeground}
      className="text-sm text-foreground border border-border rounded-md px-2 py-1"
      style={Platform.OS === 'web' ? { outlineWidth: 0 } : undefined}
      underlineColorAndroid="transparent"
    />
  );
}

interface AddConditionButtonProps {
  database: Database;
  onPick: (property: DatabaseProperty) => void;
}

function AddConditionButton({ database, onPick }: AddConditionButtonProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);

  return (
    <View>
      <Pressable
        onPress={() => setOpen((s) => !s)}
        className="flex-row items-center gap-1 self-start px-2 py-1 rounded hover:bg-muted"
      >
        <Plus size={12} color={colors.mutedForeground} />
        <Text className="text-xs text-muted-foreground">{t('databases.filters.add')}</Text>
      </Pressable>
      {open ? (
        <ListPopover
          onClose={() => setOpen(false)}
          options={database.schema.properties.map((p) => ({
            value: p.id,
            label: p.name,
          }))}
          onSelect={(id) => {
            const target = database.schema.properties.find((p) => p.id === id);
            if (target) onPick(target);
            setOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}

function cloneFilterGroup(group: FilterGroup): FilterGroup {
  return {
    kind: 'group',
    combinator: group.combinator,
    filters: group.filters.map((f) => (f.kind === 'condition' ? { ...f } : cloneFilterGroup(f))),
  };
}
