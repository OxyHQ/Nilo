import { RelationCell } from './relation-cell';
import { ComputedCell } from './computed-cell';
import { ContactCell, ContactLink } from './contact-cell';
import { DateCell } from './date-cell';
import { FilesCell, FilesChips } from './files-cell';
import { PersonCell, PersonChips } from './person-cell';
import * as React from 'react';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { RiCheckLine } from '@oxy.so/bloom/icons/RiCheckLine';
import { RiArrowDownSLine } from '@oxy.so/bloom/icons/RiArrowDownSLine';
import { RiCloseLine } from '@oxy.so/bloom/icons/RiCloseLine';
import { Button } from '@oxy.so/bloom/button';
import { Checkbox } from '@oxy.so/bloom/checkbox';
import { Chip } from '@oxy.so/bloom/chip';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Item } from '@oxy.so/bloom/item';
import { Popover, PopoverContent, PopoverTrigger } from '@oxy.so/bloom/popover';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import type {
  DatabaseProperty,
  FileEntry,
  PropertyValue,
  SelectOption,
} from '@/lib/types/databases';
import { formatDateValue } from '@/lib/date-values';
import { formatNumberValue } from '@/lib/number-format';
import { SELECT_CHIP_HUE } from './select-color';

export interface PropertyCellProps {
  readOnly?: boolean;
  property: DatabaseProperty;
  value: PropertyValue;
  /** Renders compact for table rows; expanded for the row detail panel. */
  variant?: 'table' | 'panel' | 'card';
  onChange: (next: PropertyValue) => void;
  /** Optional initial focus when becoming interactive (table double-click). */
  autoFocus?: boolean;
  /**
   * The row's page: a file is uploaded to it, and a file in Oxy storage is
   * opened as one of its files. Without it files can be linked, not uploaded.
   */
  rowId?: string;
}

/**
 * PropertyCell — renders + edits a single typed property value.
 *
 * Variants:
 *   - `table`: dense, single-line, inline editor that opens on tap/click.
 *   - `panel`: expanded label + value, used inside a database row's
 *     property panel.
 *   - `card`: read-only chip used in board/gallery card previews.
 *
 * All editors store via the controlled `onChange` callback. The parent
 * (row mutation hook) is responsible for debouncing writes.
 */
export function PropertyCell({
  property,
  value,
  variant = 'table',
  onChange,
  autoFocus,
  readOnly = false,
  rowId,
}: PropertyCellProps) {
  if (property.type === 'formula' || property.type === 'unique_id')
    return <ComputedCell property={property} value={value} />;
  // A card previews its row and opens it when pressed: only its pickers edit in place.
  if (readOnly || (variant === 'card' && SHOWN_ON_CARDS.has(property.type)))
    return <PropertyValueText property={property} value={value} rowId={rowId} />;
  switch (property.type) {
    case 'text':
      return (
        <TextCell
          value={readText(value)}
          variant={variant}
          autoFocus={autoFocus}
          onChange={(text) => onChange({ text })}
        />
      );
    case 'number':
      return (
        <NumberCell
          property={property}
          value={readNumber(value)}
          variant={variant}
          autoFocus={autoFocus}
          onChange={(n) => onChange({ number: n })}
        />
      );
    case 'url':
    case 'email':
    case 'phone':
      return (
        <ContactCell
          kind={property.type}
          label={property.name}
          value={readScalarString(value)}
          variant={variant}
          autoFocus={autoFocus}
          onChange={(v) => onChange({ value: v })}
        />
      );
    case 'checkbox':
      return (
        <CheckboxCell
          label={property.name}
          value={readChecked(value)}
          onChange={(checked) => onChange({ checked })}
        />
      );
    case 'select':
      return (
        <SelectCell
          property={property}
          variant={variant}
          value={readOptionId(value)}
          onChange={(id) => onChange({ optionId: id })}
        />
      );
    case 'status':
      return (
        <SelectCell
          property={property}
          variant={variant}
          value={readOptionId(value)}
          onChange={(id) => onChange({ optionId: id })}
        />
      );
    case 'multi_select':
      return (
        <MultiSelectCell
          property={property}
          variant={variant}
          value={readOptionIds(value)}
          onChange={(ids) => onChange({ optionIds: ids })}
        />
      );
    case 'date':
      return <DateCell label={property.name} variant={variant} value={value} onChange={onChange} />;
    case 'person':
      return (
        <PersonCell
          label={property.name}
          value={readUserIds(value)}
          variant={variant}
          onChange={(userIds) => onChange({ userIds })}
        />
      );
    case 'files':
      return (
        <FilesCell
          label={property.name}
          value={readFiles(value)}
          rowId={rowId}
          variant={variant}
          onChange={(files) => onChange({ files })}
        />
      );
    case 'relation':
      return (
        <RelationCell
          label={property.name}
          value={readPageIds(value)}
          variant={variant}
          targetDatabaseId={property.config?.targetDatabaseId}
          onChange={(pageIds) => onChange({ pageIds })}
        />
      );
    case 'rollup':
      return <DerivedCell value={value} variant={variant} />;
    case 'created_time':
    case 'last_edited_time':
      return <DerivedCell value={value} variant={variant} format="date" />;
    case 'created_by':
    case 'last_edited_by':
      return <PersonChips userIds={readUserIds(value)} />;
  }
}

/** The types a card shows as they read, not as an editor (which would take the press). */
const SHOWN_ON_CARDS: ReadonlySet<DatabaseProperty['type']> = new Set([
  'text',
  'number',
  'url',
  'email',
  'phone',
  'date',
  'person',
  'files',
]);

/** Static rendering keeps read-only values out of the keyboard edit path. */
function PropertyValueText({
  property,
  value,
  rowId,
}: Pick<PropertyCellProps, 'property' | 'value' | 'rowId'>) {
  const { t, locale } = useTranslation();
  let display: string;
  switch (property.type) {
    case 'text':
      display = readText(value);
      break;
    case 'number':
      display = formatNumberValue(readNumber(value), property.config, locale);
      break;
    case 'url':
    case 'email':
    case 'phone':
      return <ContactLink kind={property.type} value={readScalarString(value)} />;
    case 'checkbox':
      display = t(readChecked(value) ? 'sharing.checked' : 'sharing.unchecked');
      break;
    case 'select':
    case 'status':
      display =
        property.config?.options?.find((option) => option.id === readOptionId(value))?.name ?? '';
      break;
    case 'multi_select':
      display = (property.config?.options ?? [])
        .filter((option) => readOptionIds(value).includes(option.id))
        .map((option) => option.name)
        .join(', ');
      break;
    case 'date':
      display = formatDateValue(value, locale);
      break;
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      return <PersonChips userIds={readUserIds(value)} />;
    case 'files':
      return <FilesChips value={readFiles(value)} rowId={rowId} />;
    case 'relation':
      return (
        <RelationCell
          value={readPageIds(value)}
          targetDatabaseId={property.config?.targetDatabaseId}
        />
      );
    default:
      return <DerivedCell value={value} variant="card" />;
  }
  return <Text className="py-1 text-sm text-foreground">{display || '—'}</Text>;
}

// --- typed readers ---------------------------------------------------------

function readText(v: PropertyValue): string {
  if (v && typeof v === 'object' && 'text' in v && typeof v.text === 'string') {
    return v.text;
  }
  return '';
}
function readScalarString(v: PropertyValue): string {
  if (v && typeof v === 'object' && 'value' in v && typeof v.value === 'string') {
    return v.value;
  }
  return '';
}
function readNumber(v: PropertyValue): number | null {
  if (
    v &&
    typeof v === 'object' &&
    'number' in v &&
    (typeof v.number === 'number' || v.number === null)
  ) {
    return v.number;
  }
  return null;
}
function readChecked(v: PropertyValue): boolean {
  if (v && typeof v === 'object' && 'checked' in v) {
    return Boolean(v.checked);
  }
  return false;
}
function readOptionId(v: PropertyValue): string | null {
  if (v && typeof v === 'object' && 'optionId' in v) {
    const id = v.optionId;
    return typeof id === 'string' ? id : null;
  }
  return null;
}
function readOptionIds(v: PropertyValue): string[] {
  if (v && typeof v === 'object' && 'optionIds' in v) {
    const ids = v.optionIds;
    if (Array.isArray(ids)) {
      return ids.filter((id): id is string => typeof id === 'string');
    }
  }
  return [];
}
function readUserIds(v: PropertyValue): string[] {
  if (v && typeof v === 'object' && 'userIds' in v) {
    const ids = v.userIds;
    if (Array.isArray(ids)) {
      return ids.filter((id): id is string => typeof id === 'string');
    }
  }
  return [];
}
/** A file is a link or a file in Oxy storage (`fileId`, Noted's attachments): either has a name. */
function readFiles(v: PropertyValue): FileEntry[] {
  if (v && typeof v === 'object' && 'files' in v) {
    const files = v.files;
    if (Array.isArray(files)) {
      return files.filter((f): f is FileEntry => {
        if (typeof f !== 'object' || f === null) return false;
        const { name, url, fileId } = f as { name?: unknown; url?: unknown; fileId?: unknown };
        return typeof name === 'string' && (typeof url === 'string' || typeof fileId === 'string');
      });
    }
  }
  return [];
}
function readPageIds(v: PropertyValue): string[] {
  if (v && typeof v === 'object' && 'pageIds' in v) {
    const ids = v.pageIds;
    if (Array.isArray(ids)) {
      return ids.filter((id): id is string => typeof id === 'string');
    }
  }
  return [];
}

// --- individual cell editors ----------------------------------------------

interface CellVariantProps {
  variant: PropertyCellProps['variant'];
}

interface TextCellProps extends CellVariantProps {
  value: string;
  autoFocus?: boolean;
  onChange: (next: string) => void;
}

function TextCell({ value, autoFocus, onChange, variant }: TextCellProps) {
  const { colors } = useColorScheme();
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (draft !== value) onChange(draft);
  };

  return (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      autoFocus={autoFocus}
      placeholder=""
      placeholderTextColor={colors.mutedForeground}
      className={variant === 'panel' ? 'text-sm text-foreground py-1' : 'text-sm text-foreground'}
      style={
        Platform.OS === 'web'
          ? { outlineWidth: 0, borderWidth: 0, padding: 0, minWidth: 60 }
          : undefined
      }
      underlineColorAndroid="transparent"
    />
  );
}

interface NumberCellProps extends CellVariantProps {
  property: DatabaseProperty;
  value: number | null;
  autoFocus?: boolean;
  onChange: (next: number | null) => void;
}

function NumberCell({ property, value, autoFocus, onChange, variant }: NumberCellProps) {
  const { colors } = useColorScheme();
  const { locale } = useTranslation();
  // The number as typed while it is edited, as its format shows it otherwise.
  const [focused, setFocused] = React.useState(false);
  const [draft, setDraft] = React.useState(value === null ? '' : String(value));
  React.useEffect(() => {
    setDraft(value === null ? '' : String(value));
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === '') {
      if (value !== null) onChange(null);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      if (parsed !== value) onChange(parsed);
    } else {
      setDraft(value === null ? '' : String(value));
    }
  };

  const displayValue = formatNumberValue(value, property.config, locale);

  return (
    <View className="flex-row items-center">
      {variant === 'table' ? (
        <TextInput
          value={focused || draft !== (value === null ? '' : String(value)) ? draft : displayValue}
          onChangeText={setDraft}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onSubmitEditing={commit}
          autoFocus={autoFocus}
          keyboardType={NUMBER_KEYBOARD}
          inputMode="decimal"
          placeholder=""
          placeholderTextColor={colors.mutedForeground}
          className="text-sm text-foreground text-right flex-1"
          style={
            Platform.OS === 'web'
              ? { outlineWidth: 0, borderWidth: 0, padding: 0, minWidth: 40 }
              : undefined
          }
          underlineColorAndroid="transparent"
        />
      ) : (
        <View className="flex-row items-center">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onBlur={commit}
            onSubmitEditing={commit}
            autoFocus={autoFocus}
            keyboardType={NUMBER_KEYBOARD}
            inputMode="decimal"
            placeholder="—"
            placeholderTextColor={colors.mutedForeground}
            className="text-sm text-foreground py-1"
            style={
              Platform.OS === 'web'
                ? { outlineWidth: 0, borderWidth: 0, padding: 0, minWidth: 60 }
                : undefined
            }
          />
          {displayValue !== draft && draft.length > 0 ? (
            <Text className="ml-2 text-xs text-muted-foreground">{displayValue}</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

/**
 * iOS's number pad has no minus sign and its decimal pad no minus either:
 * numbers with punctuation take a negative or a decimal number. Android's
 * numeric keyboard has both.
 */
const NUMBER_KEYBOARD = Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric';

interface CheckboxCellProps {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}

function CheckboxCell({ label, value, onChange }: CheckboxCellProps) {
  return <Checkbox checked={value} onCheckedChange={onChange} accessibilityLabel={label} />;
}

interface SelectCellProps extends CellVariantProps {
  property: DatabaseProperty;
  value: string | null;
  onChange: (next: string | null) => void;
}

function SelectCell({ property, value, onChange, variant }: SelectCellProps) {
  const { colors } = useColorScheme();
  const [open, setOpen] = React.useState(false);
  const options = property.config?.options ?? [];
  const selected = options.find((o) => o.id === value) ?? null;

  return (
    <SelectPicker
      open={open}
      onOpenChange={setOpen}
      options={options}
      selectedIds={selected ? [selected.id] : []}
      multi={false}
      onSelect={(id) => {
        onChange(id);
        setOpen(false);
      }}
      onClear={() => {
        onChange(null);
        setOpen(false);
      }}
    >
      <Pressable
        accessibilityLabel={property.name}
        className={`flex-row items-center ${variant === 'table' ? 'py-0.5' : 'py-1'}`}
      >
        {selected ? (
          <SelectChip option={selected} />
        ) : (
          <Text className="text-sm text-muted-foreground">—</Text>
        )}
        {variant !== 'card' ? (
          <RiArrowDownSLine size="xs" fill={colors.mutedForeground} style={{ marginLeft: 4 }} />
        ) : null}
      </Pressable>
    </SelectPicker>
  );
}

interface MultiSelectCellProps extends CellVariantProps {
  property: DatabaseProperty;
  value: string[];
  onChange: (next: string[]) => void;
}

function MultiSelectCell({ property, value, onChange, variant }: MultiSelectCellProps) {
  const [open, setOpen] = React.useState(false);
  const options = property.config?.options ?? [];
  const selected = options.filter((o) => value.includes(o.id));

  return (
    <SelectPicker
      open={open}
      onOpenChange={setOpen}
      options={options}
      selectedIds={value}
      multi
      onSelect={(id) => {
        const next = value.includes(id) ? value.filter((x) => x !== id) : [...value, id];
        onChange(next);
      }}
      onClear={() => onChange([])}
    >
      <Pressable
        accessibilityLabel={property.name}
        className={`flex-row flex-wrap items-center gap-1 ${
          variant === 'table' ? 'py-0.5' : 'py-1'
        }`}
      >
        {selected.length === 0 ? (
          <Text className="text-sm text-muted-foreground">—</Text>
        ) : (
          selected.map((o) => <SelectChip key={o.id} option={o} />)
        )}
      </Pressable>
    </SelectPicker>
  );
}

/** An option's colour pill. */
function SelectChip({ option }: { option: SelectOption }) {
  return (
    <Chip size="xs" hue={SELECT_CHIP_HUE[option.color] ?? 'neutral'}>
      {option.name}
    </Chip>
  );
}

interface SelectPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: SelectOption[];
  selectedIds: string[];
  multi: boolean;
  onSelect: (id: string) => void;
  onClear: () => void;
  /** The cell that opens the picker; the popover anchors to it. */
  children: React.ReactElement;
}

function SelectPicker({
  open,
  onOpenChange,
  options,
  selectedIds,
  multi,
  onSelect,
  onClear,
  children,
}: SelectPickerProps) {
  const [query, setQuery] = React.useState('');
  const { colors } = useColorScheme();
  const { t } = useTranslation();

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        minWidth={280}
        label={t('databases.properties.searchOptions')}
        className="gap-2"
      >
        <TextFieldInput
          size="sm"
          label={t('databases.properties.searchOptions')}
          value={query}
          onChangeText={setQuery}
        />
        <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled">
          {filtered.length === 0 ? (
            <EmptyState
              // icon: ListTodo
              variant="compact"
              title={t('databases.properties.noOptions')}
            />
          ) : (
            filtered.map((o) => {
              const selected = selectedIds.includes(o.id);
              return (
                <Item
                  key={o.id}
                  density="compact"
                  role={multi ? 'checkbox' : 'option'}
                  selected={selected}
                  accessibilityLabel={o.name}
                  title={<SelectChip option={o} />}
                  trailing={
                    selected ? (
                      <RiCheckLine width={14} height={14} fill={colors.foreground} />
                    ) : null
                  }
                  onPress={() => onSelect(o.id)}
                />
              );
            })
          )}
        </ScrollView>
        {selectedIds.length > 0 ? (
          <Button
            appearance="plain"
            size="sm"
            className="self-start"
            // The picker portals out of a card that opens its row; on web the
            // click still bubbles to it through React.
            stopPropagation
            onPress={onClear}
            leadingIcon={RiCloseLine}
          >
            {multi ? t('databases.actions.clearAll') : t('databases.actions.clear')}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

interface DerivedCellProps extends CellVariantProps {
  value: PropertyValue;
  format?: 'date';
}

function DerivedCell({ value, format }: DerivedCellProps) {
  const { locale } = useTranslation();
  if (!value || typeof value !== 'object') {
    return <Text className="text-sm text-muted-foreground">—</Text>;
  }
  if ('number' in value && typeof value.number === 'number') {
    return <Text variant="body-regular">{value.number}</Text>;
  }
  if ('text' in value && typeof value.text === 'string') {
    return (
      <Text variant="body-regular" numberOfLines={1}>
        {value.text || '—'}
      </Text>
    );
  }
  if ('start' in value && typeof value.start === 'string') {
    const d = new Date(value.start);
    if (format === 'date' && !Number.isNaN(d.getTime())) {
      return <Text variant="body-regular">{d.toLocaleDateString(locale)}</Text>;
    }
  }
  return <Text className="text-sm text-muted-foreground">—</Text>;
}
