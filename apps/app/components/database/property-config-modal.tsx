import { toast } from '@oxy.so/bloom/toast';
import { RelationSettings } from './relation-settings';
import { FormulaEditor } from './formula-editor';
import { UniqueIdEditor } from './unique-id-editor';
import * as React from 'react';
import { Pressable, View } from 'react-native';
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
import { RiArrowDownSLine } from '@oxy.so/bloom/icons/RiArrowDownSLine';
import { RiArrowUpSLine } from '@oxy.so/bloom/icons/RiArrowUpSLine';
import { RiExchangeLine } from '@oxy.so/bloom/icons/RiExchangeLine';
import { RiArrowLeftLine } from '@oxy.so/bloom/icons/RiArrowLeftLine';
import { RiArrowRightLine } from '@oxy.so/bloom/icons/RiArrowRightLine';
import { RiCursorLine } from '@oxy.so/bloom/icons/RiCursorLine';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
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
  StatusGroup,
  StatusGroupId,
} from '@/lib/types/databases';
import { NAME_PROPERTY_ID, SELECT_COLORS, STATUS_GROUP_IDS } from '@/lib/types/databases';
import { statusGroups } from '@/lib/status-groups';
import { DateSettings, NumberSettings, RollupSettings } from './property-settings';
import { ButtonSettings } from './button-settings';
import { SettingSelect } from './view-settings';
import { SELECT_CHIP_HUE } from './select-color';
import {
  useAddProperty,
  useDeleteProperty,
  useUpdateProperty,
} from '@/lib/hooks/use-database-properties';
import { useUpdateView } from '@/lib/hooks/use-database-views';
import { databaseChangeError } from '@/lib/database-errors';
import type { BloomIconComponent } from '@oxy.so/bloom/icons';

interface PropertyHeaderMenuProps {
  /** Opened by the column header that owns it. */
  control: DialogControlProps;
  database: Database;
  view: DatabaseView;
  property: DatabaseProperty;
  /** A table's column, moved left or right in the view's order (by whoever may change it). */
  move?: { onMove: (by: -1 | 1) => void; left: boolean; right: boolean };
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
    case 'button':
      return i18n.t('databases.propertyTypes.button');
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
  button: RiCursorLine,
};

/** The settings each type has besides its name, by the menu item that opens them. */
const CONFIG_LABELS: Partial<Record<DatabasePropertyType, string>> = {
  select: 'databases.properties.editOptions',
  multi_select: 'databases.properties.editOptions',
  status: 'databases.properties.editOptions',
  relation: 'databases.relations.configure',
  formula: 'databases.formula.edit',
  unique_id: 'databases.uniqueId.configure',
  number: 'databases.numberFormat.title',
  date: 'databases.dateFormat.title',
  rollup: 'databases.rollup.configure',
  button: 'databases.button.configure',
};

/**
 * Column-header menu — rename / settings / change type / sort / hide /
 * delete, in a dialog the column header opens.
 */
export function PropertyHeaderMenu({
  control,
  database,
  view,
  property,
  move,
}: PropertyHeaderMenuProps) {
  const { colors } = useColorScheme();
  const theme = useTheme();
  const { t } = useTranslation();
  const [mode, setMode] = React.useState<'menu' | 'rename' | 'config' | 'type'>('menu');
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
    try {
      await updateProperty.mutateAsync({
        databaseId: database.id,
        propertyId: property.id,
        name: nameDraft.trim(),
      });
      setMode('menu');
    } catch (error) {
      toast.error(databaseChangeError(error, database, t('databases.properties.updateFailed')));
    }
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

  // A relation needs its database, chosen in its own settings: it is added, not converted to.
  const retype = async (type: DatabasePropertyType) => {
    const confirmed = await confirm({
      title: t('databases.properties.changeTypeTitle', { type: propertyTypeLabel(type) }),
      description: t('databases.properties.changeTypeDescription'),
      confirmLabel: t('databases.properties.changeType'),
      cancelLabel: t('common.cancel'),
    });
    if (!confirmed) return;
    try {
      await updateProperty.mutateAsync({ databaseId: database.id, propertyId: property.id, type });
      setMode('menu');
    } catch (error) {
      toast.error(databaseChangeError(error, database, t('databases.properties.updateFailed')));
    }
  };

  const remove = async () => {
    try {
      await deleteProperty.mutateAsync({ databaseId: database.id, propertyId: property.id });
      close();
    } catch (error) {
      toast.error(databaseChangeError(error, database, t('databases.properties.deleteFailed')));
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
          {CONFIG_LABELS[property.type] ? (
            <Item
              density="compact"
              accessibilityRole="button"
              leading={icon(PROPERTY_TYPE_ICONS[property.type])}
              title={t(CONFIG_LABELS[property.type] as string)}
              onPress={() => setMode('config')}
            />
          ) : null}
          {/* The Name is the rows' titles: always text. */}
          {property.id !== NAME_PROPERTY_ID ? (
            <Item
              density="compact"
              accessibilityRole="button"
              leading={icon(RiExchangeLine)}
              title={t('databases.properties.changeType')}
              onPress={() => setMode('type')}
            />
          ) : null}
          <Item
            density="compact"
            accessibilityRole="button"
            leading={icon(RiSortAlphabetAsc)}
            title={t('databases.properties.sortAscending')}
            onPress={() => applySort('asc')}
          />
          <Item
            density="compact"
            accessibilityRole="button"
            leading={icon(RiSortAlphabetDesc)}
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
          {move ? (
            <>
              <Item
                density="compact"
                accessibilityRole="button"
                disabled={!move.left}
                leading={icon(RiArrowLeftLine)}
                title={t('databases.properties.moveLeft')}
                onPress={() => {
                  move.onMove(-1);
                  close();
                }}
              />
              <Item
                density="compact"
                accessibilityRole="button"
                disabled={!move.right}
                leading={icon(RiArrowRightLine)}
                title={t('databases.properties.moveRight')}
                onPress={() => {
                  move.onMove(1);
                  close();
                }}
              />
            </>
          ) : null}
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
        ) : property.type === 'number' ? (
          <NumberSettings database={database} property={property} onDone={close} />
        ) : property.type === 'date' ? (
          <DateSettings database={database} property={property} onDone={close} />
        ) : property.type === 'rollup' ? (
          <RollupSettings database={database} property={property} onDone={close} />
        ) : property.type === 'button' ? (
          <ButtonSettings database={database} property={property} onDone={close} />
        ) : (
          <SelectOptionsEditor property={property} database={database} onDone={close} />
        )
      ) : null}

      {mode === 'type' ? (
        <View>
          <Text className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
            {t('databases.properties.changeType')}
          </Text>

          {ADDABLE_TYPES.filter((type) => type !== property.type && type !== 'relation').map(
            (type) => (
              <Item
                key={type}
                density="compact"
                accessibilityRole="button"
                disabled={updateProperty.isPending}
                leading={icon(PROPERTY_TYPE_ICONS[type])}
                title={propertyTypeLabel(type)}
                onPress={() => void retype(type)}
              />
            ),
          )}

          <View className="mt-2 flex-row justify-end">
            <Button appearance="subtle" size="sm" onPress={() => setMode('menu')}>
              {t('common.back')}
            </Button>
          </View>
        </View>
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
 * The options of a select, multi-select or status: added, renamed,
 * recoloured, moved up or down and removed in place, each change saved as it
 * is made. A status's are listed by group (To-do, In progress, Complete), and
 * each can be moved to another group.
 */
function SelectOptionsEditor({ property, database, onDone }: SelectOptionsEditorProps) {
  const { t } = useTranslation();
  const updateProperty = useUpdateProperty();
  const [options, setOptions] = React.useState<SelectOption[]>(property.config?.options ?? []);
  const isStatus = property.type === 'status';
  const [groups, setGroups] = React.useState<StatusGroup[]>(() =>
    statusGroups(property.config?.options ?? [], property.config?.groups),
  );
  const [draftName, setDraftName] = React.useState('');

  const persist = async (next: SelectOption[], nextGroups: StatusGroup[] = groups) => {
    const previous = { options, groups };
    const grouped = isStatus ? statusGroups(next, nextGroups) : undefined;
    setOptions(next);
    if (grouped) setGroups(grouped);
    try {
      await updateProperty.mutateAsync({
        databaseId: database.id,
        propertyId: property.id,
        config: { ...(property.config ?? {}), options: next, ...(grouped && { groups: grouped }) },
      });
    } catch (error) {
      setOptions(previous.options);
      setGroups(previous.groups);
      toast.error(databaseChangeError(error, database, t('databases.properties.updateFailed')));
    }
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

  const removeOption = (id: string) => persist(options.filter((o) => o.id !== id));
  const recolorOption = (id: string, color: SelectColor) =>
    persist(options.map((o) => (o.id === id ? { ...o, color } : o)));
  const renameOption = (id: string, name: string) =>
    persist(options.map((o) => (o.id === id ? { ...o, name } : o)));
  // Up or down among the options it is listed with: its group's, for a status.
  const moveOption = (id: string, by: -1 | 1) => {
    const peers = isStatus
      ? (groups.find((g) => g.optionIds.includes(id))?.optionIds ?? [])
      : options.map((o) => o.id);
    const other = peers[peers.indexOf(id) + by];
    if (!other) return;
    const next = [...options];
    const a = next.findIndex((o) => o.id === id);
    const b = next.findIndex((o) => o.id === other);
    [next[a], next[b]] = [next[b] as SelectOption, next[a] as SelectOption];
    return persist(next);
  };
  const regroupOption = (id: string, groupId: StatusGroupId) =>
    persist(
      options,
      groups.map((g) => ({
        ...g,
        optionIds:
          g.id === groupId
            ? [...g.optionIds.filter((o) => o !== id), id]
            : g.optionIds.filter((o) => o !== id),
      })),
    );

  const row = (o: SelectOption, peers: string[]) => (
    <OptionRow
      key={o.id}
      option={o}
      first={peers[0] === o.id}
      last={peers[peers.length - 1] === o.id}
      group={isStatus ? groups.find((g) => g.optionIds.includes(o.id))?.id : undefined}
      onRemove={() => removeOption(o.id)}
      onRecolor={(color) => recolorOption(o.id, color)}
      onRename={(name) => renameOption(o.id, name)}
      onMove={(by) => moveOption(o.id, by)}
      onRegroup={(groupId) => regroupOption(o.id, groupId)}
    />
  );
  const byId = new Map(options.map((o) => [o.id, o]));

  return (
    <View className="gap-2">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground">
        {t('databases.properties.options')}
      </Text>

      {isStatus
        ? groups.map((group) => (
            <View key={group.id} className="mb-2">
              <Text className="text-xs font-semibold text-muted-foreground">
                {t(`databases.statusGroups.${group.id}`)}
              </Text>
              {group.optionIds.flatMap((id) => {
                const option = byId.get(id);
                return option ? [row(option, group.optionIds)] : [];
              })}
            </View>
          ))
        : options.map((o) =>
            row(
              o,
              options.map((x) => x.id),
            ),
          )}

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
  first: boolean;
  last: boolean;
  /** A status option's group; a select's options have none. */
  group?: StatusGroupId;
  onRemove: () => void;
  onRecolor: (color: SelectColor) => void;
  onRename: (name: string) => void;
  onMove: (by: -1 | 1) => void;
  onRegroup: (group: StatusGroupId) => void;
}

function OptionRow({
  option,
  first,
  last,
  group,
  onRemove,
  onRecolor,
  onRename,
  onMove,
  onRegroup,
}: OptionRowProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const [colorOpen, setColorOpen] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState<string | null>(null);
  const hue = SELECT_CHIP_HUE[option.color] ?? 'neutral';
  const commitName = () => {
    const name = nameDraft?.trim();
    setNameDraft(null);
    if (name && name !== option.name) onRename(name);
  };

  return (
    <View className="gap-1 py-1">
      <View className="flex-row items-center gap-1">
        <Popover open={colorOpen} onOpenChange={setColorOpen}>
          <PopoverTrigger asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('databases.options.color', { name: option.name })}
              className="flex-row items-center gap-1"
            >
              <Chip size="xs" hue={hue}>
                {option.name}
              </Chip>
              <RiArrowRightSLine width={10} height={10} fill={colors.mutedForeground} />
            </Pressable>
          </PopoverTrigger>
          <PopoverContent align="start" label={option.name}>
            <View className="max-w-[240px] flex-row flex-wrap gap-1">
              {SELECT_COLORS.map((c) => (
                <Chip
                  key={c}
                  size="xs"
                  hue={SELECT_CHIP_HUE[c]}
                  onPress={() => {
                    onRecolor(c);
                    setColorOpen(false);
                  }}
                >
                  {t(`editor.colors.${c}`)}
                </Chip>
              ))}
            </View>
          </PopoverContent>
        </Popover>
        <View className="flex-1" />
        <Button
          iconOnly
          appearance="plain"
          size="xs"
          accessibilityLabel={t('databases.options.rename', { name: option.name })}
          onPress={() => setNameDraft(option.name)}
          leadingIcon={RiPencilLine}
        />
        <Button
          iconOnly
          appearance="plain"
          size="xs"
          disabled={first}
          accessibilityLabel={t('databases.options.moveUp', { name: option.name })}
          onPress={() => onMove(-1)}
          leadingIcon={RiArrowUpSLine}
        />
        <Button
          iconOnly
          appearance="plain"
          size="xs"
          disabled={last}
          accessibilityLabel={t('databases.options.moveDown', { name: option.name })}
          onPress={() => onMove(1)}
          leadingIcon={RiArrowDownSLine}
        />
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
      {nameDraft !== null ? (
        <TextFieldInput
          size="sm"
          label={t('databases.options.name')}
          value={nameDraft}
          onChangeText={setNameDraft}
          autoFocus
          maxLength={120}
          onSubmitEditing={commitName}
          onBlur={commitName}
        />
      ) : null}
      {group ? (
        <SettingSelect
          label={t('databases.options.group')}
          value={group}
          options={STATUS_GROUP_IDS.map((id) => ({
            value: id,
            label: t(`databases.statusGroups.${id}`),
          }))}
          onChange={(next) => onRegroup(next as StatusGroupId)}
        />
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
  'button',
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
