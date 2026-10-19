import { View } from 'react-native';
import { RiArrowDownSLine } from '@oxy.so/bloom/icons/RiArrowDownSLine';
import { RiArrowUpSLine } from '@oxy.so/bloom/icons/RiArrowUpSLine';
import { Button } from '@oxy.so/bloom/button';
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
import { Switch } from '@oxy.so/bloom/switch';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { databaseChangeError } from '@/lib/database-errors';
import { useReorderProperties } from '@/lib/hooks/use-database-properties';
import { useUpdateView } from '@/lib/hooks/use-database-views';
import type {
  Database,
  DatabaseProperty,
  DatabasePropertyType,
  DatabaseView,
  ViewConfig,
} from '@/lib/types/databases';
import { NAME_PROPERTY_ID } from '@/lib/types/databases';

/** What a board groups by (`view-board.tsx`). */
export const GROUPABLE_TYPES: readonly DatabasePropertyType[] = ['status', 'select', 'checkbox'];

/** Notion's load limits: the rows a view shows before "Load more". */
const PAGE_SIZES = [10, 25, 50, 100] as const;

/** Calendars and timelines read every row of the dates they show; forms read none. */
const PAGED_TYPES: ReadonlySet<DatabaseView['type']> = new Set([
  'table',
  'board',
  'gallery',
  'list',
]);

interface ViewSettingsProps {
  database: Database;
  view: DatabaseView;
  /** May reorder the database's properties (its editor, and it is not locked). */
  canEditSchema: boolean;
}

/**
 * A view's settings, as Notion's view options: what its layout is built from
 * (a board's grouping, a calendar's or a timeline's dates, a gallery's cards,
 * a table's frozen columns), how many rows it loads, and which properties it
 * shows, in the database's order. Every change is saved as it is made.
 */
export function ViewSettings({ database, view, canEditSchema }: ViewSettingsProps) {
  const { t } = useTranslation();
  const updateView = useUpdateView();
  const reorder = useReorderProperties();
  const properties = database.schema.properties;
  const ofType = (...types: DatabasePropertyType[]) =>
    properties.filter((p) => types.includes(p.type));

  const update = (patch: Omit<Parameters<typeof updateView.mutate>[0], 'databaseId' | 'viewId'>) =>
    updateView.mutate(
      { databaseId: database.id, viewId: view.id, ...patch },
      { onError: () => toast.error(t('databases.views.updateFailed')) },
    );
  const setConfig = (patch: Partial<ViewConfig>) => {
    const config: ViewConfig = { ...view.config, ...patch };
    for (const key of Object.keys(patch) as (keyof ViewConfig)[]) {
      if (patch[key] === undefined) delete config[key];
    }
    update({ config });
  };

  const choices = (list: DatabaseProperty[]) => list.map((p) => ({ value: p.id, label: p.name }));
  const NONE = '__none__';
  const none = { value: NONE, label: t('databases.viewSettings.none') };

  // A table's columns as it shows them: the Name, then the properties it does not hide.
  const columns = [
    properties.find((p) => p.id === NAME_PROPERTY_ID),
    ...properties.filter((p) => p.id !== NAME_PROPERTY_ID && !view.hiddenProperties.includes(p.id)),
  ].filter((p): p is DatabaseProperty => Boolean(p));
  const frozen = new Set(view.frozenProperties);
  const lastFrozen = [...columns].reverse().find((p) => frozen.has(p.id));

  const move = (id: string, by: -1 | 1) => {
    const ids = properties.map((p) => p.id);
    const from = ids.indexOf(id);
    const to = from + by;
    if (from === -1 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to] as string, ids[from] as string];
    reorder.mutate(
      { databaseId: database.id, ids },
      {
        onError: (error) =>
          toast.error(databaseChangeError(error, database, t('databases.properties.updateFailed'))),
      },
    );
  };

  return (
    <View className="gap-3">
      {view.type === 'board' ? (
        <SettingSelect
          label={t('databases.viewSettings.groupBy')}
          value={view.groupBy?.propertyId ?? ''}
          options={choices(ofType(...GROUPABLE_TYPES))}
          onChange={(propertyId) => update({ groupBy: { propertyId } })}
        />
      ) : null}
      {view.type === 'calendar' ? (
        <SettingSelect
          label={t('databases.viewSettings.calendarBy')}
          value={view.config.datePropertyId ?? ofType('date')[0]?.id ?? ''}
          options={choices(ofType('date'))}
          onChange={(datePropertyId) => setConfig({ datePropertyId })}
        />
      ) : null}
      {view.type === 'timeline' ? (
        <>
          <SettingSelect
            label={t('databases.viewSettings.start')}
            value={view.config.startPropertyId ?? ofType('date')[0]?.id ?? ''}
            options={choices(ofType('date'))}
            onChange={(startPropertyId) => setConfig({ startPropertyId })}
          />
          <SettingSelect
            label={t('databases.viewSettings.end')}
            value={view.config.endPropertyId ?? NONE}
            options={[none, ...choices(ofType('date'))]}
            onChange={(id) => setConfig({ endPropertyId: id === NONE ? undefined : id })}
          />
        </>
      ) : null}
      {view.type === 'gallery' ? (
        <>
          <SettingSelect
            label={t('databases.viewSettings.cardPreview')}
            value={
              view.config.coverSource === 'property' && view.config.coverPropertyId
                ? view.config.coverPropertyId
                : (view.config.coverSource ?? 'pageCover')
            }
            options={[
              { value: 'none', label: t('databases.viewSettings.none') },
              { value: 'pageCover', label: t('databases.viewSettings.pageCover') },
              ...choices(ofType('files')),
            ]}
            onChange={(next) =>
              next === 'none' || next === 'pageCover'
                ? setConfig({ coverSource: next, coverPropertyId: undefined })
                : setConfig({ coverSource: 'property', coverPropertyId: next })
            }
          />
          <SettingSwitch
            label={t('databases.viewSettings.fitImage')}
            checked={view.config.fit === 'contain'}
            onChange={(fit) => setConfig({ fit: fit ? 'contain' : 'cover' })}
          />
        </>
      ) : null}
      {view.type === 'table' ? (
        <SettingSelect
          label={t('databases.viewSettings.freezeUpTo')}
          value={lastFrozen?.id ?? NONE}
          options={[none, ...choices(columns)]}
          onChange={(id) => {
            const upTo = columns.findIndex((p) => p.id === id);
            update({ frozenProperties: columns.slice(0, upTo + 1).map((p) => p.id) });
          }}
        />
      ) : null}
      {PAGED_TYPES.has(view.type) ? (
        <SettingSelect
          label={t('databases.viewSettings.loadLimit')}
          value={String(view.pageSize)}
          options={PAGE_SIZES.map((size) => ({
            value: String(size),
            label: t('databases.viewSettings.rows', { count: size }),
          }))}
          onChange={(size) => update({ pageSize: Number(size) })}
        />
      ) : null}

      <View className="gap-1">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground">
          {t('databases.viewSettings.properties')}
        </Text>
        {properties.map((property, index) => {
          const shown = !view.hiddenProperties.includes(property.id);
          return (
            <View key={property.id} className="flex-row items-center gap-1 py-0.5">
              <Text variant="body-regular" numberOfLines={1} className="flex-1">
                {property.name}
              </Text>
              {canEditSchema ? (
                <>
                  <Button
                    iconOnly
                    appearance="plain"
                    size="xs"
                    disabled={index === 0 || reorder.isPending}
                    accessibilityLabel={t('databases.viewSettings.moveUp', { name: property.name })}
                    leadingIcon={RiArrowUpSLine}
                    onPress={() => move(property.id, -1)}
                  />
                  <Button
                    iconOnly
                    appearance="plain"
                    size="xs"
                    disabled={index === properties.length - 1 || reorder.isPending}
                    accessibilityLabel={t('databases.viewSettings.moveDown', {
                      name: property.name,
                    })}
                    leadingIcon={RiArrowDownSLine}
                    onPress={() => move(property.id, 1)}
                  />
                </>
              ) : null}
              {/* The Name is every view's title: it is never hidden. */}
              {property.id !== NAME_PROPERTY_ID ? (
                <Switch
                  size="sm"
                  checked={shown}
                  accessibilityLabel={t('databases.viewSettings.show', { name: property.name })}
                  onCheckedChange={(next) =>
                    update({
                      hiddenProperties: next
                        ? view.hiddenProperties.filter((id) => id !== property.id)
                        : [...new Set([...view.hiddenProperties, property.id])],
                    })
                  }
                />
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

interface SettingSelectProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

export function SettingSelect({ label, value, options, onChange }: SettingSelectProps) {
  return (
    <View className="gap-1">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Text>
      <Select size="sm" value={value} onValueChange={onChange} disabled={options.length === 0}>
        <SelectTrigger label={label}>
          <SelectValue placeholder={label} />
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
    </View>
  );
}

interface SettingSwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function SettingSwitch({ label, checked, onChange }: SettingSwitchProps) {
  return (
    <View className="flex-row items-center justify-between gap-2">
      <Text variant="body-regular">{label}</Text>
      <Switch size="sm" checked={checked} accessibilityLabel={label} onCheckedChange={onChange} />
    </View>
  );
}
