import { FILTER_OPERATORS_BY_TYPE } from '@oxy.so/nilo-contracts';
import { resultPropertyFromRows } from '@/lib/formula-results';
import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { RiFilter3Line } from '@oxy.so/bloom/icons/RiFilter3Line';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { DatePicker } from '@oxy.so/bloom/date-picker';
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
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import i18n from '@/lib/i18n';
import type {
  Database,
  DatabaseProperty,
  DatabasePropertyType,
  DatabaseRow,
  DatabaseView,
  Filter,
  FilterCondition,
  FilterGroup,
} from '@/lib/types/databases';
import { dayKey, fromDayKey } from '@/lib/date-values';
import { useRowSearch } from '@/lib/hooks/use-database-rows';
import { useUpdateView } from '@/lib/hooks/use-database-views';
import { memberProfileName, useWorkspaceMembers } from '@/lib/hooks/use-workspace-members';

interface FilterBuilderProps {
  database: Database;
  view: DatabaseView;
  rows: DatabaseRow[];
}

/** Translated at call time: the locale can change while the app runs. */
function operatorLabel(operator: string): string {
  switch (operator) {
    case 'contains':
      return i18n.t('databases.filters.operators.contains');
    case 'does_not_contain':
      return i18n.t('databases.filters.operators.doesNotContain');
    case 'equals':
      return i18n.t('databases.filters.operators.equals');
    case 'does_not_equal':
      return i18n.t('databases.filters.operators.doesNotEqual');
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
    case 'in_last':
      return i18n.t('databases.filters.operators.inLast');
    case 'in_next':
      return i18n.t('databases.filters.operators.inNext');
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

/** The operators a property's type takes, as the API checks them (`@oxy.so/nilo-contracts`). */
function operatorsFor(type: DatabasePropertyType): { value: string; label: string }[] {
  return FILTER_OPERATORS_BY_TYPE[type].map((value) => ({ value, label: operatorLabel(value) }));
}

/** What a new condition on a property starts with: its first operator, and no value. */
function startCondition(property: DatabaseProperty): Pick<FilterCondition, 'operator' | 'value'> {
  return {
    operator: operatorsFor(property.type)[0]?.value ?? 'is_empty',
    value: property.type === 'checkbox' ? true : '',
  };
}

/** How deep groups nest under the view's own, as in Notion: a group, and a group in it. */
const MAX_GROUP_DEPTH = 2;

/** `group` without the groups nested in it that hold no condition: they would filter nothing. */
export function withoutEmptyGroups(group: FilterGroup): FilterGroup {
  return {
    ...group,
    filters: group.filters.flatMap((filter): Filter[] => {
      if (filter.kind === 'condition') return [filter];
      const child = withoutEmptyGroups(filter);
      return child.filters.length > 0 ? [child] : [];
    }),
  };
}

/**
 * The toolbar's Filter button and the dialog it opens: the view's AND/OR tree,
 * each group with its own "and"/"or", its conditions and the groups nested in
 * it (up to `MAX_GROUP_DEPTH`), each of which can be added and removed.
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
  // A condition on a property the database no longer has is dropped: the API
  // refuses to save one.
  const fromView = () =>
    cloneFilterGroup(view.filters, new Set(database.schema.properties.map((p) => p.id)));
  const [draft, setDraft] = React.useState<FilterGroup>(fromView);
  const filterCount = countFilters(view.filters);

  const open = () => {
    setDraft(fromView());
    control.open();
  };

  const save = async (filters: FilterGroup) => {
    try {
      await updateView.mutateAsync({
        databaseId: database.id,
        viewId: view.id,
        filters: withoutEmptyGroups(filters),
      });
      control.close();
    } catch {
      toast.error(t('databases.filters.saveFailed'));
    }
  };

  const reset = async () => {
    const empty: FilterGroup = {
      kind: 'group',
      combinator: 'and',
      filters: [],
    };
    setDraft(empty);
    await save(empty);
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
        maxWidth={560}
        title={t('databases.filters.title')}
        actions={[
          {
            label: t('databases.actions.apply'),
            shouldCloseOnPress: false,
            onPress: () => void save(draft),
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
        <View className="pb-4">
          <GroupEditor
            database={database}
            group={draft}
            depth={0}
            onChange={(change) => setDraft((prev) => change(prev))}
          />
        </View>
      </Dialog>
    </>
  );
}

interface GroupEditorProps {
  database: Database;
  group: FilterGroup;
  /** 0 for the view's own group. */
  depth: number;
  /** Applies `change` to this group in the draft. */
  onChange: (change: (group: FilterGroup) => FilterGroup) => void;
  onRemove?: () => void;
}

/** One group of the tree: its combinator, its filters, and what can be added to it. */
function GroupEditor({ database, group, depth, onChange, onRemove }: GroupEditorProps) {
  const { t } = useTranslation();
  const first = database.schema.properties[0];
  const condition = (property: DatabaseProperty): FilterCondition => ({
    kind: 'condition',
    propertyId: property.id,
    ...startCondition(property),
  });
  const setFilters = (change: (filters: Filter[]) => Filter[]) =>
    onChange((prev) => ({ ...prev, filters: change(prev.filters) }));

  return (
    <View
      accessibilityLabel={depth > 0 ? t('databases.filters.group') : undefined}
      className={depth > 0 ? 'gap-2 rounded-lg border border-border p-2' : 'gap-3'}
    >
      <View className="flex-row items-center justify-between gap-2">
        <SegmentedControl
          type="radio"
          size="sm"
          className="self-start"
          label={t('databases.filters.combinator')}
          value={group.combinator}
          onValueChange={(combinator) => onChange((prev) => ({ ...prev, combinator }))}
        >
          {(['and', 'or'] as const).map((option) => (
            <SegmentedControlItem key={option} value={option}>
              <SegmentedControlItemText>
                {option === 'and' ? t('databases.filters.and') : t('databases.filters.or')}
              </SegmentedControlItemText>
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        {onRemove ? (
          <Button
            iconOnly
            appearance="plain"
            size="xs"
            accessibilityLabel={t('databases.filters.removeGroup')}
            onPress={onRemove}
            leadingIcon={RiDeleteBin6Line}
          />
        ) : null}
      </View>

      {group.filters.length === 0 ? (
        <Text className="py-2 text-sm text-muted-foreground">
          {depth === 0 ? t('databases.filters.empty') : t('databases.filters.emptyGroup')}
        </Text>
      ) : (
        group.filters.map((filter, idx) =>
          filter.kind === 'condition' ? (
            <ConditionRow
              // biome-ignore lint/suspicious/noArrayIndexKey: persisted conditions have no id, and a key derived from the condition would remount the row (closing its pickers) on every edit
              key={idx}
              database={database}
              filter={filter}
              onChange={(patch) =>
                setFilters((filters) =>
                  filters.map((f, i) =>
                    i === idx && f.kind === 'condition' ? { ...f, ...patch } : f,
                  ),
                )
              }
              onRemove={() => setFilters((filters) => filters.filter((_, i) => i !== idx))}
            />
          ) : (
            <GroupEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: persisted groups have no id either
              key={idx}
              database={database}
              group={filter}
              depth={depth + 1}
              onChange={(change) =>
                setFilters((filters) =>
                  filters.map((f, i) => (i === idx && f.kind === 'group' ? change(f) : f)),
                )
              }
              onRemove={() => setFilters((filters) => filters.filter((_, i) => i !== idx))}
            />
          ),
        )
      )}

      <View className="flex-row flex-wrap gap-1">
        <PropertyMenu
          label={t('databases.filters.add')}
          properties={database.schema.properties}
          onPick={(property) => setFilters((filters) => [...filters, condition(property)])}
        />
        {depth < MAX_GROUP_DEPTH && first ? (
          <Button
            appearance="plain"
            size="sm"
            leadingIcon={RiAddLine}
            onPress={() =>
              setFilters((filters) => [
                ...filters,
                { kind: 'group', combinator: 'and', filters: [condition(first)] },
              ])
            }
          >
            {t('databases.filters.addGroup')}
          </Button>
        ) : null}
      </View>
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
          onChange({ propertyId: id, ...startCondition(next) });
        }}
      />
      <OptionSelect
        value={filter.operator}
        options={operators}
        onValueChange={(operator) => onChange({ operator })}
      />
      <View className="min-w-32 flex-1">
        <ConditionValueInput
          workspaceId={database.workspaceId}
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
        {properties.map((p) => (
          <DropdownMenuItem key={p.id} onPress={() => onPick(p)}>
            {p.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ConditionValueInputProps {
  workspaceId: string;
  property: DatabaseProperty | null;
  operator: string;
  value: unknown;
  onChange: (next: unknown) => void;
}

/**
 * The value a condition compares with, in the form its property holds it: an
 * option, a member or a row is picked by its id and a date from a calendar;
 * only text, a number and a count of days are typed.
 */
function ConditionValueInput({
  workspaceId,
  property,
  operator,
  value,
  onChange,
}: ConditionValueInputProps) {
  const { t } = useTranslation();
  // Operators that don't take a value
  if (operator === 'is_empty' || operator === 'is_not_empty') {
    return <View />;
  }

  switch (property?.type) {
    case 'checkbox':
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
    case 'select':
    case 'status':
    case 'multi_select':
      return (
        <ChoiceChips
          choices={(property.config?.options ?? []).map((o) => ({ value: o.id, label: o.name }))}
          value={value}
          onChange={onChange}
        />
      );
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      return <MemberChoice workspaceId={workspaceId} value={value} onChange={onChange} />;
    case 'relation':
      return (
        <RowChoice
          databaseId={property.config?.targetDatabaseId}
          value={value}
          onChange={onChange}
        />
      );
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return operator === 'in_last' || operator === 'in_next' ? (
        <NumberInput label={t('databases.filters.days')} value={value} onChange={onChange} />
      ) : (
        <DateChoice value={value} onChange={onChange} />
      );
    case 'number':
      return <NumberInput label={t('databases.filters.value')} value={value} onChange={onChange} />;
    default:
      return (
        <TextFieldInput
          size="sm"
          value={typeof value === 'string' ? value : String(value ?? '')}
          onChangeText={onChange}
          label={t('databases.filters.value')}
        />
      );
  }
}

/** A typed number, or a count of days: sent as a number once it reads as one. */
function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  return (
    <TextFieldInput
      size="sm"
      value={typeof value === 'string' ? value : String(value ?? '')}
      onChangeText={(text) =>
        onChange(text.trim() && Number.isFinite(Number(text)) ? Number(text) : text)
      }
      keyboardType="numeric"
      label={label}
    />
  );
}

interface ChoiceChipsProps {
  choices: { value: string; label: string }[];
  value: unknown;
  onChange: (next: string) => void;
}

/** One of a set of choices, sent by its id: an option, a member, a row. */
function ChoiceChips({ choices, value, onChange }: ChoiceChipsProps) {
  const { t } = useTranslation();
  if (choices.length === 0) {
    return (
      <Text className="py-1 text-sm text-muted-foreground">{t('databases.filters.noChoices')}</Text>
    );
  }
  return (
    <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('databases.filters.value')}
        className="flex-row flex-wrap gap-1"
      >
        {choices.map((choice) => (
          <Chip
            key={choice.value}
            size="sm"
            role="radio"
            selected={value === choice.value}
            onPress={() => onChange(choice.value)}
          >
            {choice.label}
          </Chip>
        ))}
      </View>
    </ScrollView>
  );
}

/** A person of the workspace, by user id. */
function MemberChoice({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string;
  value: unknown;
  onChange: (next: string) => void;
}) {
  const { data: members = [] } = useWorkspaceMembers(workspaceId);
  return (
    <ChoiceChips
      choices={members.map((m) => ({ value: m.userId, label: memberProfileName(m) ?? m.userId }))}
      value={value}
      onChange={onChange}
    />
  );
}

/** A row of the relation's database, by page id, searched by title in the API. */
function RowChoice({
  databaseId,
  value,
  onChange,
}: {
  databaseId: string | undefined;
  value: unknown;
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = React.useState('');
  const { data: rows = [] } = useRowSearch(databaseId, search);
  return (
    <View className="gap-1">
      <TextFieldInput
        size="sm"
        value={search}
        onChangeText={setSearch}
        label={t('databases.filters.searchRows')}
      />
      <ChoiceChips
        choices={rows.map((row) => ({
          value: row.id,
          label: row.title || t('databases.untitled'),
        }))}
        value={value}
        onChange={onChange}
      />
    </View>
  );
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** A day from a calendar, sent as `YYYY-MM-DD`: the UTC day a date filter compares. */
function DateChoice({ value, onChange }: { value: unknown; onChange: (next: string) => void }) {
  const { t, locale } = useTranslation();
  const day = typeof value === 'string' ? ISO_DAY.exec(value) : null;
  const selected = day ? fromDayKey(day[0]) : null;
  return (
    <DatePicker
      value={selected}
      locale={locale}
      accessibilityLabel={t('databases.filters.value')}
      placeholder={t('databases.filters.pickDate')}
      onChange={(next) => onChange(next ? dayKey(next) : '')}
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

/**
 * A copy of `group` without the conditions on a property not among
 * `propertyIds`, and without a nested group left with none.
 */
function cloneFilterGroup(group: FilterGroup, propertyIds: ReadonlySet<string>): FilterGroup {
  return {
    kind: 'group',
    combinator: group.combinator,
    filters: group.filters.flatMap((f): Filter[] => {
      if (f.kind === 'condition') return propertyIds.has(f.propertyId) ? [{ ...f }] : [];
      const child = cloneFilterGroup(f, propertyIds);
      return child.filters.length > 0 || f.filters.length === 0 ? [child] : [];
    }),
  };
}
