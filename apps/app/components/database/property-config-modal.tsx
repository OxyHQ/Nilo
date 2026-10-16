import { toast } from '@oxy.so/bloom/toast';
import { RelationSettings } from './relation-settings';
import { FormulaEditor } from './formula-editor';
import { UniqueIdEditor } from './unique-id-editor';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { RiSortAlphabetAsc } from '@oxy.so/bloom/icons/RiSortAlphabetAsc';
import { RiSortAlphabetDesc } from '@oxy.so/bloom/icons/RiSortAlphabetDesc';
import { RiEyeOffLine } from '@oxy.so/bloom/icons/RiEyeOffLine';
import { RiHashtag } from '@oxy.so/bloom/icons/RiHashtag';
import { RiPencilLine } from '@oxy.so/bloom/icons/RiPencilLine';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { RiText } from '@oxy.so/bloom/icons/RiText';
import { RiCalendarLine } from '@oxy.so/bloom/icons/RiCalendarLine';
import { RiCheckboxLine } from '@oxy.so/bloom/icons/RiCheckboxLine';
import { RiLink } from '@oxy.so/bloom/icons/RiLink';
import { RiMailLine } from '@oxy.so/bloom/icons/RiMailLine';
import { RiPhoneLine } from '@oxy.so/bloom/icons/RiPhoneLine';
import { RiAccountCircleLine } from '@oxy.so/bloom/icons/RiAccountCircleLine';
import { RiAttachment2 } from '@oxy.so/bloom/icons/RiAttachment2';
import { RiListCheck3 } from '@oxy.so/bloom/icons/RiListCheck3';
import { RiFunctions } from '@oxy.so/bloom/icons/RiFunctions';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons/RiArrowRightSLine';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, type DialogControlProps, useDialogControl } from '@oxy.so/bloom/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
import { Item } from '@oxy.so/bloom/item';
import { Popover, PopoverContent, PopoverTrigger } from '@oxy.so/bloom/popover';
import { confirm } from '@oxy.so/bloom/surfaces';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import i18n from '@/lib/i18n';
import { useColorScheme } from '@/lib/useColorScheme';
import type {
  Database,
  DatabaseProperty,
  DatabasePropertyType,
  DatabaseView,
  SelectColor,
  SelectOption,
} from '@/lib/types/databases';
import { SELECT_COLORS } from '@/lib/types/databases';
import { SELECT_COLOR_CLASSES } from './select-color';
import {
  useAddProperty,
  useDeleteProperty,
  useUpdateProperty,
} from '@/lib/hooks/use-database-properties';
import { useUpdateView } from '@/lib/hooks/use-database-views';
import type { BloomIconComponent } from '@oxy.so/bloom/icons';

interface PropertyHeaderMenuProps {
  /** Opened by the column header that owns it. */
  control: DialogControlProps;
  database: Database;
  view: DatabaseView;
  property: DatabaseProperty;
}

/** Translated at call time: the locale can change while the app runs. */
function propertyTypeLabel(type: DatabasePropertyType): string {
  switch (type) {
    case 'unique_id':
      return i18n.t('databases.propertyTypes.uniqueId');
    case 'text':
      return i18n.t('databases.propertyTypes.text');
    case 'number':
      return i18n.t('databases.propertyTypes.number');
    case 'select':
      return i18n.t('databases.propertyTypes.select');
    case 'multi_select':
      return i18n.t('databases.propertyTypes.multiSelect');
    case 'status':
      return i18n.t('databases.propertyTypes.status');
    case 'date':
      return i18n.t('databases.propertyTypes.date');
    case 'person':
      return i18n.t('databases.propertyTypes.person');
    case 'files':
      return i18n.t('databases.propertyTypes.files');
    case 'checkbox':
      return i18n.t('databases.propertyTypes.checkbox');
    case 'url':
      return i18n.t('databases.propertyTypes.url');
    case 'email':
      return i18n.t('databases.propertyTypes.email');
    case 'phone':
      return i18n.t('databases.propertyTypes.phone');
    case 'relation':
      return i18n.t('databases.propertyTypes.relation');
    case 'rollup':
      return i18n.t('databases.propertyTypes.rollup');
    case 'created_time':
      return i18n.t('databases.propertyTypes.createdTime');
    case 'last_edited_time':
      return i18n.t('databases.propertyTypes.lastEditedTime');
    case 'created_by':
      return i18n.t('databases.propertyTypes.createdBy');
    case 'last_edited_by':
      return i18n.t('databases.propertyTypes.lastEditedBy');
    case 'formula':
      return i18n.t('databases.propertyTypes.formula');
  }
}

const PROPERTY_TYPE_ICONS: Record<DatabasePropertyType, BloomIconComponent> = {
  unique_id: RiHashtag,
  text: RiText,
  number: RiHashtag,
  select: RiListCheck3,
  multi_select: RiListCheck3,
  status: RiListCheck3,
  date: RiCalendarLine,
  person: RiAccountCircleLine,
  files: RiAttachment2,
  checkbox: RiCheckboxLine,
  url: RiLink,
  email: RiMailLine,
  phone: RiPhoneLine,
  relation: RiLink,
  rollup: RiFunctions,
  created_time: RiCalendarLine,
  last_edited_time: RiCalendarLine,
  created_by: RiAccountCircleLine,
  last_edited_by: RiAccountCircleLine,
  formula: RiFunctions,
};

/**
 * Column-header menu — rename / change type / sort / hide / delete, in a
 * dialog the column header opens.
 */
export function PropertyHeaderMenu({ control, database, view, property }: PropertyHeaderMenuProps) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const { t } = useTranslation();
  const [mode, setMode] = React.useState<'menu' | 'rename' | 'config'>('menu');
  const updateProperty = useUpdateProperty();
  const deleteProperty = useDeleteProperty();
  const updateView = useUpdateView();
  const [nameDraft, setNameDraft] = React.useState(property.name);

  const close = () => control.close();

  const commitName = async () => {
    if (nameDraft.trim() === '' || nameDraft === property.name) {
      setMode('menu');
      return;
    }
    await updateProperty.mutateAsync({
      databaseId: database.id,
      propertyId: property.id,
      name: nameDraft.trim(),
    });
    setMode('menu');
  };

  const applySort = async (direction: 'asc' | 'desc') => {
    const otherSorts = view.sorts.filter((s) => s.propertyId !== property.id);
    await updateView.mutateAsync({
      databaseId: database.id,
      viewId: view.id,
      sorts: [{ propertyId: property.id, direction }, ...otherSorts],
    });
    close();
  };

  const hide = async () => {
    await updateView.mutateAsync({
      databaseId: database.id,
      viewId: view.id,
      hiddenProperties: Array.from(new Set([...view.hiddenProperties, property.id])),
    });
    close();
  };

  const remove = async () => {
    try {
      await deleteProperty.mutateAsync({ databaseId: database.id, propertyId: property.id });
      close();
    } catch {
      toast.error(t('databases.relations.failed'));
    }
  };

  // Deleting a two-way relation also removes the other database's side.
  const requestRemove = async () => {
    if (!property.config?.twoWay) return remove();
    const confirmed = await confirm({
      title: t('databases.relations.removeTitle'),
      description: t('databases.relations.removeDescription'),
      confirmLabel: t('common.confirm'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (confirmed) await remove();
  };

  const icon = (Icon: BloomIconComponent) => (
    <Icon width={14} height={14} fill={colors.foreground} />
  );

  return (
    <Dialog
      control={control}
      // Each opening starts on the menu.
      onClose={() => setMode('menu')}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={mode === 'config' && property.type === 'formula' ? 512 : 384}
      label={property.name}
      title={mode === 'menu' ? property.name : undefined}
      description={mode === 'menu' ? propertyTypeLabel(property.type) : undefined}
    >
      {mode === 'menu' ? (
        <View>
          <Item
            density="compact"
            accessibilityRole="button"
            leading={icon(RiPencilLine)}
            title={t('databases.properties.rename')}
            onPress={() => {
              setNameDraft(property.name);
              setMode('rename');
            }}
          />
          {property.type === 'select' ||
          property.type === 'multi_select' ||
          property.type === 'status' ? (
            <Item
              density="compact"
              accessibilityRole="button"
              leading={icon(RiListCheck3)}
              title={t('databases.properties.editOptions')}
              onPress={() => setMode('config')}
            />
          ) : null}
          {property.type === 'relation' ? (
            <Item
              density="compact"
              accessibilityRole="button"
              leading={icon(RiLink)}
              title={t('databases.relations.configure')}
              onPress={() => setMode('config')}
            />
          ) : null}
          {property.type === 'formula' || property.type === 'unique_id' ? (
            <Item
              density="compact"
              accessibilityRole="button"
              leading={icon(property.type === 'formula' ? RiFunctions : RiHashtag)}
              title={t(
                property.type === 'formula'
                  ? 'databases.formula.edit'
                  : 'databases.uniqueId.configure',
              )}
              onPress={() => setMode('config')}
            />
          ) : null}
          <Item
            density="compact"
            accessibilityRole="button"
            leading={icon(RiSortAlphabetDesc)}
            title={t('databases.properties.sortAscending')}
            onPress={() => applySort('asc')}
          />
          <Item
            density="compact"
            accessibilityRole="button"
            leading={icon(RiSortAlphabetAsc)}
            title={t('databases.properties.sortDescending')}
            onPress={() => applySort('desc')}
          />
          <Item
            density="compact"
            accessibilityRole="button"
            leading={icon(RiEyeOffLine)}
            title={t('databases.properties.hideInView')}
            onPress={hide}
          />
          {property.id !== 'name' ? (
            <Item
              density="compact"
              accessibilityRole="button"
              destructive
              leading={<RiDeleteBin6Line width={14} height={14} fill={theme.colors.error} />}
              title={t('databases.properties.delete')}
              onPress={() => void requestRemove()}
            />
          ) : null}
        </View>
      ) : null}

      {mode === 'rename' ? (
        <View className="gap-2">
          <Text className="text-xs uppercase tracking-wider text-muted-foreground">
            {t('databases.properties.name')}
          </Text>
          <TextFieldInput
            size="sm"
            label={t('databases.properties.name')}
            value={nameDraft}
            onChangeText={setNameDraft}
            placeholder={t('databases.untitled')}
            autoFocus
            onSubmitEditing={commitName}
          />
          <View className="mt-1 flex-row justify-end gap-2">
            <Button appearance="subtle" size="sm" onPress={() => setMode('menu')}>
              {t('common.cancel')}
            </Button>
            <Button appearance="solid" tone="accent" size="sm" onPress={commitName}>
              {t('common.save')}
            </Button>
          </View>
        </View>
      ) : null}

      {mode === 'config' ? (
        property.type === 'relation' ? (
          <RelationSettings database={database} property={property} onDone={close} />
        ) : property.type === 'formula' ? (
          <FormulaEditor property={property} database={database} viewId={view.id} onDone={close} />
        ) : property.type === 'unique_id' ? (
          <UniqueIdEditor databaseId={database.id} property={property} onDone={close} />
        ) : (
          <SelectOptionsEditor property={property} database={database} onDone={close} />
        )
      ) : null}
    </Dialog>
  );
}

interface SelectOptionsEditorProps {
  property: DatabaseProperty;
  database: Database;
  onDone: () => void;
}

/**
 * Tiny inline editor for select / multi-select / status options.
 * Adds and edits in-place — change is persisted via property PATCH on
 * blur or after rename.
 */
function SelectOptionsEditor({ property, database, onDone }: SelectOptionsEditorProps) {
  const { t } = useTranslation();
  const updateProperty = useUpdateProperty();
  const [options, setOptions] = React.useState<SelectOption[]>(property.config?.options ?? []);
  const [draftName, setDraftName] = React.useState('');

  const persist = async (next: SelectOption[]) => {
    setOptions(next);
    await updateProperty.mutateAsync({
      databaseId: database.id,
      propertyId: property.id,
      config: { ...(property.config ?? {}), options: next },
    });
  };

  const addOption = async () => {
    const name = draftName.trim();
    if (!name) return;
    const next: SelectOption[] = [
      ...options,
      { id: createOptionId(), name, color: pickNextColor(options) },
    ];
    setDraftName('');
    await persist(next);
  };

  const removeOption = async (id: string) => {
    await persist(options.filter((o) => o.id !== id));
  };

  const recolorOption = async (id: string, color: SelectColor) => {
    await persist(options.map((o) => (o.id === id ? { ...o, color } : o)));
  };

  return (
    <View className="gap-2">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground">
        {t('databases.properties.options')}
      </Text>
      <ScrollView style={{ maxHeight: 240 }}>
        {options.map((o) => (
          <OptionRow
            key={o.id}
            option={o}
            onRemove={() => removeOption(o.id)}
            onRecolor={(color) => recolorOption(o.id, color)}
          />
        ))}
      </ScrollView>
      <View className="mt-1 flex-row items-center gap-2">
        <View className="flex-1">
          <TextFieldInput
            size="sm"
            label={t('databases.properties.newOption')}
            value={draftName}
            onChangeText={setDraftName}
            onSubmitEditing={addOption}
          />
        </View>
        <Button
          appearance="solid"
          tone="accent"
          size="sm"
          onPress={addOption}
          leadingIcon={RiAddLine}
        >
          {t('databases.actions.add')}
        </Button>
      </View>
      <View className="mt-2 flex-row justify-end gap-2">
        <Button appearance="subtle" size="sm" onPress={onDone}>
          {t('common.done')}
        </Button>
      </View>
    </View>
  );
}

interface OptionRowProps {
  option: SelectOption;
  onRemove: () => void;
  onRecolor: (color: SelectColor) => void;
}

function OptionRow({ option, onRemove, onRecolor }: OptionRowProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [colorOpen, setColorOpen] = React.useState(false);
  const palette = SELECT_COLOR_CLASSES[option.color] ?? SELECT_COLOR_CLASSES.default;

  // The option pill and its swatches stay on the select palette classes: Bloom's
  // `Chip` hues cannot express every option colour.
  return (
    <View className="flex-row items-center gap-2 py-1">
      <Popover open={colorOpen} onOpenChange={setColorOpen}>
        <PopoverTrigger asChild>
          <Pressable
            accessibilityLabel={option.name}
            className={`px-2 py-0.5 rounded-md ${palette.bg} flex-row items-center gap-1`}
          >
            <Text className={`text-xs ${palette.fg}`}>{option.name}</Text>
            <RiArrowRightSLine width={10} height={10} fill={colors.mutedForeground} />
          </Pressable>
        </PopoverTrigger>
        <PopoverContent align="start" label={option.name}>
          <View className="flex-row gap-1">
            {SELECT_COLORS.map((c) => {
              const p = SELECT_COLOR_CLASSES[c];
              return (
                <Pressable
                  key={c}
                  accessibilityRole="button"
                  onPress={() => {
                    onRecolor(c);
                    setColorOpen(false);
                  }}
                  className={`h-5 w-5 rounded-md ${p.bg}`}
                />
              );
            })}
          </View>
        </PopoverContent>
      </Popover>
      <View className="flex-1" />
      <Button
        iconOnly
        appearance="plain"
        tone="danger"
        size="xs"
        accessibilityLabel={t('common.delete')}
        onPress={onRemove}
        leadingIcon={RiDeleteBin6Line}
      />
    </View>
  );
}

function createOptionId(): string {
  if (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis.crypto as Crypto | undefined)?.randomUUID === 'function'
  ) {
    return (globalThis.crypto as Crypto).randomUUID();
  }
  return `opt-${Math.random().toString(36).slice(2, 10)}`;
}

function pickNextColor(existing: SelectOption[]): SelectColor {
  for (const c of SELECT_COLORS) {
    if (!existing.some((o) => o.color === c)) return c;
  }
  return 'default';
}

/**
 * "+ Add property" entry point for the table header. Opens a small
 * dropdown of property types and adds the chosen one to the database
 * schema.
 */
export interface AddPropertyButtonProps {
  database: Database;
  onAdded?: () => void;
}

const ADDABLE_TYPES: DatabasePropertyType[] = [
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'checkbox',
  'url',
  'email',
  'phone',
  'person',
  'files',
  'relation',
  'rollup',
  'formula',
  'unique_id',
  'created_time',
  'last_edited_time',
  'created_by',
  'last_edited_by',
];

export function AddPropertyButton({ database, onAdded }: AddPropertyButtonProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const relation = useDialogControl();
  const { mutate: addProperty, isPending } = useAddPropertyOptimistic(database, () => {
    setOpen(false);
    onAdded?.();
  });

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button appearance="plain" size="sm" leadingIcon={RiAddLine}>
            {isPending ? t('databases.actions.adding') : t('databases.properties.add')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" label={t('databases.properties.add')}>
          <DropdownMenuLabel>{t('databases.properties.add')}</DropdownMenuLabel>
          <ScrollView style={{ maxHeight: 360 }}>
            {ADDABLE_TYPES.map((type) => {
              const Icon = PROPERTY_TYPE_ICONS[type];
              return (
                <DropdownMenuItem
                  key={type}
                  // The menu stays open until the property is added.
                  keepOpen={type !== 'relation'}
                  leading={<Icon width={14} height={14} fill={colors.foreground} />}
                  onPress={() => {
                    if (type === 'relation') {
                      relation.open();
                      return;
                    }
                    addProperty({
                      databaseId: database.id,
                      name: propertyTypeLabel(type),
                      type,
                    });
                  }}
                >
                  {propertyTypeLabel(type)}
                </DropdownMenuItem>
              );
            })}
          </ScrollView>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        control={relation}
        placement={{ base: 'bottom', md: 'center' }}
        maxWidth={384}
        label={t('databases.propertyTypes.relation')}
      >
        <RelationSettings
          database={database}
          onDone={() => {
            relation.close();
            onAdded?.();
          }}
        />
      </Dialog>
    </>
  );
}

/**
 * Wraps `useAddProperty` so the picker can close itself on success
 * without the parent subscribing to the full mutation result.
 */
function useAddPropertyOptimistic(_database: Database, onDone: () => void) {
  const addProperty = useAddProperty();
  return {
    mutate: (input: Parameters<typeof addProperty.mutate>[0]) => {
      addProperty.mutate(input, { onSuccess: () => onDone() });
    },
    isPending: addProperty.isPending,
  };
}
