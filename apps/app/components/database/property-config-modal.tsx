import * as React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  EyeOff,
  Hash,
  Pencil,
  Trash2,
  Type as TypeIcon,
  Calendar,
  CheckSquare,
  Link as LinkIcon,
  Mail,
  Phone,
  CircleUserRound,
  PaperclipIcon,
  ListTodo,
  Sigma,
  Plus,
  ChevronRight,
} from 'lucide-react-native';
import { Text } from '@/components/ui/text';
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
import { centeredModalStyle } from './centered-modal-style';

interface PropertyHeaderMenuProps {
  open: boolean;
  onClose: () => void;
  database: Database;
  view: DatabaseView;
  property: DatabaseProperty;
}

/** Translated at call time: the locale can change while the app runs. */
function propertyTypeLabel(type: DatabasePropertyType): string {
  switch (type) {
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

const PROPERTY_TYPE_ICONS: Record<
  DatabasePropertyType,
  React.ComponentType<{ size?: number; color?: string }>
> = {
  text: TypeIcon,
  number: Hash,
  select: ListTodo,
  multi_select: ListTodo,
  status: ListTodo,
  date: Calendar,
  person: CircleUserRound,
  files: PaperclipIcon,
  checkbox: CheckSquare,
  url: LinkIcon,
  email: Mail,
  phone: Phone,
  relation: LinkIcon,
  rollup: Sigma,
  created_time: Calendar,
  last_edited_time: Calendar,
  created_by: CircleUserRound,
  last_edited_by: CircleUserRound,
  formula: Sigma,
};

/**
 * Column-header menu — rename / change type / sort / hide / delete.
 * Renders in a Modal that anchors to the screen for both web + native to
 * keep the code one-platform-only here.
 */
export function PropertyHeaderMenu({
  open,
  onClose,
  database,
  view,
  property,
}: PropertyHeaderMenuProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [mode, setMode] = React.useState<'menu' | 'rename' | 'config'>('menu');
  const updateProperty = useUpdateProperty();
  const deleteProperty = useDeleteProperty();
  const updateView = useUpdateView();
  const [nameDraft, setNameDraft] = React.useState(property.name);

  React.useEffect(() => {
    setNameDraft(property.name);
    if (open) setMode('menu');
  }, [open, property.name]);

  const close = () => {
    onClose();
    setMode('menu');
  };

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
    await deleteProperty.mutateAsync({
      databaseId: database.id,
      propertyId: property.id,
    });
    close();
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={StyleSheet.absoluteFill} className="bg-black/40" onPress={close} />
      <View
        className="absolute left-0 right-0 bottom-0 web:bottom-auto web:top-1/2 web:left-1/2"
        style={centeredModalStyle(320, 360)}
      >
        <View className="bg-popover border border-border rounded-2xl shadow-xl p-3 m-3 web:m-0">
          {mode === 'menu' ? (
            <>
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-sm font-semibold text-foreground">{property.name}</Text>
                <Text className="text-xs text-muted-foreground">
                  {propertyTypeLabel(property.type)}
                </Text>
              </View>
              <MenuItem
                icon={Pencil}
                label={t('databases.properties.rename')}
                onPress={() => setMode('rename')}
              />
              {property.type === 'select' ||
              property.type === 'multi_select' ||
              property.type === 'status' ? (
                <MenuItem
                  icon={ListTodo}
                  label={t('databases.properties.editOptions')}
                  onPress={() => setMode('config')}
                />
              ) : null}
              <MenuItem
                icon={ArrowUpAZ}
                label={t('databases.properties.sortAscending')}
                onPress={() => applySort('asc')}
              />
              <MenuItem
                icon={ArrowDownAZ}
                label={t('databases.properties.sortDescending')}
                onPress={() => applySort('desc')}
              />
              <MenuItem icon={EyeOff} label={t('databases.properties.hideInView')} onPress={hide} />
              {property.id !== 'name' ? (
                <MenuItem
                  icon={Trash2}
                  label={t('databases.properties.delete')}
                  destructive
                  onPress={remove}
                />
              ) : null}
            </>
          ) : null}

          {mode === 'rename' ? (
            <View className="gap-2">
              <Text className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('databases.properties.name')}
              </Text>
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder={t('databases.untitled')}
                placeholderTextColor={colors.mutedForeground}
                className="text-sm text-foreground border border-border rounded-md px-2 py-1"
                style={Platform.OS === 'web' ? { outlineWidth: 0 } : undefined}
                underlineColorAndroid="transparent"
                autoFocus
                onSubmitEditing={commitName}
              />
              <View className="flex-row justify-end gap-2 mt-1">
                <Pressable
                  onPress={() => setMode('menu')}
                  className="px-3 py-1 rounded-md bg-muted"
                >
                  <Text className="text-sm text-foreground">{t('common.cancel')}</Text>
                </Pressable>
                <Pressable onPress={commitName} className="px-3 py-1 rounded-md bg-primary">
                  <Text className="text-sm text-primary-foreground">{t('common.save')}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {mode === 'config' ? (
            <SelectOptionsEditor property={property} database={database} onDone={close} />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

interface MenuItemProps {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

function MenuItem({ icon: Icon, label, onPress, destructive }: MenuItemProps) {
  const { colors } = useColorScheme();
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-2 px-2 py-1.5 rounded hover:bg-muted"
    >
      <Icon size={14} color={destructive ? '#ef4444' : colors.foreground} />
      <Text className={`text-sm ${destructive ? 'text-red-500' : 'text-foreground'}`}>{label}</Text>
    </Pressable>
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
  const { colors } = useColorScheme();
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
      <View className="flex-row items-center gap-2 mt-1">
        <TextInput
          value={draftName}
          onChangeText={setDraftName}
          placeholder={t('databases.properties.newOption')}
          placeholderTextColor={colors.mutedForeground}
          className="text-sm text-foreground border border-border rounded-md px-2 py-1 flex-1"
          onSubmitEditing={addOption}
          style={Platform.OS === 'web' ? { outlineWidth: 0 } : undefined}
          underlineColorAndroid="transparent"
        />
        <Pressable
          onPress={addOption}
          className="px-2 py-1 rounded-md bg-primary flex-row items-center gap-1"
        >
          <Plus size={12} color="#ffffff" />
          <Text className="text-xs text-primary-foreground">{t('databases.actions.add')}</Text>
        </Pressable>
      </View>
      <View className="flex-row justify-end gap-2 mt-2">
        <Pressable onPress={onDone} className="px-3 py-1 rounded-md bg-muted">
          <Text className="text-sm text-foreground">{t('common.done')}</Text>
        </Pressable>
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
  const [colorOpen, setColorOpen] = React.useState(false);
  const palette = SELECT_COLOR_CLASSES[option.color] ?? SELECT_COLOR_CLASSES.default;

  return (
    <View className="flex-row items-center gap-2 py-1">
      <Pressable
        onPress={() => setColorOpen((s) => !s)}
        className={`px-2 py-0.5 rounded-md ${palette.bg} flex-row items-center gap-1`}
      >
        <Text className={`text-xs ${palette.fg}`}>{option.name}</Text>
        <ChevronRight size={10} color={colors.mutedForeground} />
      </Pressable>
      <View className="flex-1" />
      <Pressable onPress={onRemove} className="px-2 py-1 rounded hover:bg-muted">
        <Trash2 size={12} color="#ef4444" />
      </Pressable>
      {colorOpen ? (
        <View className="absolute left-0 top-7 z-50 bg-popover border border-border rounded-md p-2 flex-row gap-1 shadow-lg">
          {SELECT_COLORS.map((c) => {
            const p = SELECT_COLOR_CLASSES[c];
            return (
              <Pressable
                key={c}
                onPress={() => {
                  onRecolor(c);
                  setColorOpen(false);
                }}
                className={`h-5 w-5 rounded-md ${p.bg}`}
              />
            );
          })}
        </View>
      ) : null}
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

export function AddPropertyButton({ database, onAdded }: AddPropertyButtonProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const { mutate: addProperty, isPending } = useAddPropertyOptimistic(database, () => {
    setOpen(false);
    onAdded?.();
  });

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center gap-1 px-2 py-1 rounded hover:bg-muted"
      >
        <Plus size={14} color={colors.mutedForeground} />
        <Text className="text-xs text-muted-foreground">
          {isPending ? t('databases.actions.adding') : t('databases.properties.add')}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={StyleSheet.absoluteFill}
          className="bg-black/40"
          onPress={() => setOpen(false)}
        />
        <View
          className="absolute left-0 right-0 bottom-0 web:bottom-auto web:top-1/2 web:left-1/2"
          style={centeredModalStyle(280, 420)}
        >
          <View className="bg-popover border border-border rounded-2xl shadow-xl p-3 m-3 web:m-0">
            <Text className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              {t('databases.properties.add')}
            </Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {(
                [
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
                  'created_time',
                  'last_edited_time',
                  'created_by',
                  'last_edited_by',
                ] as DatabasePropertyType[]
              ).map((type) => {
                const Icon = PROPERTY_TYPE_ICONS[type];
                return (
                  <Pressable
                    key={type}
                    onPress={() =>
                      addProperty({
                        databaseId: database.id,
                        name: propertyTypeLabel(type),
                        type,
                      })
                    }
                    className="flex-row items-center gap-2 px-2 py-1.5 rounded hover:bg-muted"
                  >
                    <Icon size={14} color={colors.foreground} />
                    <Text className="text-sm text-foreground">{propertyTypeLabel(type)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
