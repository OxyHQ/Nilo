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
import {
  CHART_AGGREGATES,
  CHART_TYPES,
  DATE_GROUP_GRANULARITIES,
  GROUPABLE_PROPERTY_TYPES,
  OPEN_ROW_MODES,
} from '@oxy.so/nilo-contracts';
import { useTranslation } from '@/hooks/useTranslation';
import { useUpdateView } from '@/lib/hooks/use-database-views';
import type {
  ChartAggregate,
  ChartType,
  Database,
  DatabaseProperty,
  DatabasePropertyType,
  DatabaseView,
  DateGroupGranularity,
  OpenRowMode,
  ViewChartConfig,
  ViewConfig,
  ViewGroupBy,
} from '@/lib/types/databases';
import { NAME_PROPERTY_ID } from '@/lib/types/databases';
import { moveProperty, orderedProperties } from '@/lib/view-properties';

/** What a board groups by (`view-board.tsx`). */
export const GROUPABLE_TYPES: readonly DatabasePropertyType[] = ['status', 'select', 'checkbox'];

/** What a table's or a list's rows, a board's sub-groups and a chart's axis group by. */
const ROW_GROUPABLE: readonly DatabasePropertyType[] = GROUPABLE_PROPERTY_TYPES;

/** The types grouped by day, week, month or year. */
const DATED: ReadonlySet<DatabasePropertyType> = new Set([
  'date',
  'created_time',
  'last_edited_time',
]);

/** The views that open rows; a form takes responses, a chart shows none. */
const OPENS_ROWS: ReadonlySet<DatabaseView['type']> = new Set([
  'table',
  'board',
  'gallery',
  'list',
  'calendar',
  'timeline',
]);

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
}

/**
 * A view's settings, as Notion's view options: what its layout is built from
 * (a board's grouping and sub-grouping, a table's or a list's groups, a
 * calendar's or a timeline's dates, a gallery's cards, a table's frozen
 * columns, a chart's axes), where it opens rows, how many it loads, and which
 * properties it shows, in its own order (`config.propertyOrder`). Every
 * change is saved as it is made.
 */
export function ViewSettings({ database, view }: ViewSettingsProps) {
  const { t } = useTranslation();
  const updateView = useUpdateView();
  // In the view's order: the one its table's columns and its cards follow.
  const properties = orderedProperties(database, view);
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
  const granularities = DATE_GROUP_GRANULARITIES.map((g) => ({
    value: g,
    label: t(`databases.viewSettings.granularities.${g}`),
  }));

  // A table's columns as it shows them: the Name, then the properties it does not hide.
  const columns = [
    properties.find((p) => p.id === NAME_PROPERTY_ID),
    ...properties.filter((p) => p.id !== NAME_PROPERTY_ID && !view.hiddenProperties.includes(p.id)),
  ].filter((p): p is DatabaseProperty => Boolean(p));
  const frozen = new Set(view.frozenProperties);
  const lastFrozen = [...columns].reverse().find((p) => frozen.has(p.id));

  // Up or down in the view's own order; the database's stays as it is.
  const move = (id: string, by: -1 | 1) => {
    const ids = properties.map((p) => p.id);
    const propertyOrder = moveProperty(ids, ids, id, by);
    if (propertyOrder) setConfig({ propertyOrder });
  };

  /** A grouping (a table's or a list's groups, a board's sub-groups), its dates' unit, and empty groups. */
  const grouping = (key: 'groupBy' | 'subGroupBy', label: string) => {
    const current = view[key] ?? null;
    const property = current ? properties.find((p) => p.id === current.propertyId) : undefined;
    const set = (next: ViewGroupBy | null) => update({ [key]: next });
    return (
      <>
        <SettingSelect
          label={label}
          value={current?.propertyId ?? NONE}
          options={[none, ...choices(ofType(...ROW_GROUPABLE))]}
          onChange={(id) =>
            set(
              id === NONE
                ? null
                : { propertyId: id, ...(current?.hideEmpty && { hideEmpty: true }) },
            )
          }
        />
        {current && property && DATED.has(property.type) ? (
          <SettingSelect
            label={t('databases.viewSettings.granularity')}
            value={current.granularity ?? 'day'}
            options={granularities}
            onChange={(g) => set({ ...current, granularity: g as DateGroupGranularity })}
          />
        ) : null}
        {current ? (
          <SettingSwitch
            label={t('databases.viewSettings.hideEmpty')}
            checked={current.hideEmpty === true}
            onChange={(hideEmpty) => set({ ...current, hideEmpty })}
          />
        ) : null}
      </>
    );
  };

  const chart: ViewChartConfig = view.config.chart ?? { type: 'bar' };
  const setChart = (patch: Partial<ViewChartConfig>) =>
    setConfig({ chart: { ...chart, ...patch } });
  const xAxis = chart.xAxis;
  const xProperty = xAxis ? properties.find((p) => p.id === xAxis.propertyId) : undefined;
  const yAxis = chart.yAxis;
  const numbers = ofType('number', 'unique_id');

  return (
    <View className="gap-3">
      {OPENS_ROWS.has(view.type) ? (
        <SettingSelect
          label={t('databases.viewSettings.openIn')}
          value={view.config.openIn ?? 'side_peek'}
          options={OPEN_ROW_MODES.map((mode) => ({
            value: mode,
            label: t(`databases.viewSettings.openModes.${mode}`),
          }))}
          onChange={(openIn) => setConfig({ openIn: openIn as OpenRowMode })}
        />
      ) : null}
      {view.type === 'board' ? (
        <SettingSelect
          label={t('databases.viewSettings.groupBy')}
          value={view.groupBy?.propertyId ?? ''}
          options={choices(ofType(...GROUPABLE_TYPES))}
          onChange={(propertyId) => update({ groupBy: { propertyId } })}
        />
      ) : null}
      {view.type === 'board'
        ? grouping('subGroupBy', t('databases.viewSettings.subGroupBy'))
        : null}
      {view.type === 'table' || view.type === 'list'
        ? grouping('groupBy', t('databases.viewSettings.groupBy'))
        : null}
      {view.type === 'chart' ? (
        <>
          <SettingSelect
            label={t('databases.viewSettings.chartType')}
            value={chart.type}
            options={CHART_TYPES.map((type) => ({
              value: type,
              label: t(`databases.viewSettings.chartTypes.${type}`),
            }))}
            onChange={(type) => setChart({ type: type as ChartType })}
          />
          <SettingSelect
            label={t('databases.viewSettings.xAxis')}
            value={xAxis?.propertyId ?? ''}
            options={choices(ofType(...ROW_GROUPABLE))}
            onChange={(propertyId) => setChart({ xAxis: { propertyId } })}
          />
          {xAxis && xProperty && DATED.has(xProperty.type) ? (
            <SettingSelect
              label={t('databases.viewSettings.granularity')}
              value={xAxis.granularity ?? 'day'}
              options={granularities}
              onChange={(g) =>
                setChart({ xAxis: { ...xAxis, granularity: g as DateGroupGranularity } })
              }
            />
          ) : null}
          <SettingSelect
            label={t('databases.viewSettings.yAxis')}
            value={yAxis?.aggregate ?? 'count'}
            options={CHART_AGGREGATES.filter((a) => a === 'count' || numbers.length > 0).map(
              (a) => ({ value: a, label: t(`databases.viewSettings.aggregates.${a}`) }),
            )}
            onChange={(aggregate) =>
              setChart({
                yAxis:
                  aggregate === 'count'
                    ? { aggregate: 'count' }
                    : {
                        aggregate: aggregate as ChartAggregate,
                        propertyId: yAxis?.propertyId ?? numbers[0]?.id,
                      },
              })
            }
          />
          {yAxis && yAxis.aggregate !== 'count' ? (
            <SettingSelect
              label={t('databases.viewSettings.yProperty')}
              value={yAxis.propertyId ?? ''}
              options={choices(numbers)}
              onChange={(propertyId) => setChart({ yAxis: { ...yAxis, propertyId } })}
            />
          ) : null}
        </>
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
              <Button
                iconOnly
                appearance="plain"
                size="xs"
                disabled={index === 0}
                accessibilityLabel={t('databases.viewSettings.moveUp', { name: property.name })}
                leadingIcon={RiArrowUpSLine}
                onPress={() => move(property.id, -1)}
              />
              <Button
                iconOnly
                appearance="plain"
                size="xs"
                disabled={index === properties.length - 1}
                accessibilityLabel={t('databases.viewSettings.moveDown', {
                  name: property.name,
                })}
                leadingIcon={RiArrowDownSLine}
                onPress={() => move(property.id, 1)}
              />
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
