import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { databaseChangeError } from '@/lib/database-errors';
import { useUpdateProperty } from '@/lib/hooks/use-database-properties';
import { useDatabase } from '@/lib/hooks/use-databases';
import { formatNumberValue } from '@/lib/number-format';
import {
  DATE_FORMATS,
  ROLLUP_FUNCTIONS,
  type Database,
  type DatabaseProperty,
  type DateFormat,
  type NumberFormat,
  type PropertyConfig,
  type RollupFunction,
} from '@/lib/types/databases';
import { SettingSelect, SettingSwitch } from './view-settings';

const NUMBER_FORMATS: readonly NumberFormat[] = [
  'number',
  'number_with_commas',
  'percent',
  'currency:USD',
  'currency:EUR',
  'currency:GBP',
  'currency:JPY',
];

/** Digits after the point a number may show: its format's own, or 0 to 5. */
const PRECISIONS = ['default', '0', '1', '2', '3', '4', '5'] as const;

interface PropertySettingsProps {
  database: Database;
  property: DatabaseProperty;
  onDone: () => void;
}

/** A setting of the property's config saved as it is changed, with the rest of its config. */
function useSaveConfig(database: Database, property: DatabaseProperty) {
  const { t } = useTranslation();
  const update = useUpdateProperty();
  const save = (patch: Partial<PropertyConfig>) => {
    const config: PropertyConfig = { ...(property.config ?? {}), ...patch };
    for (const key of Object.keys(patch) as (keyof PropertyConfig)[]) {
      if (patch[key] === undefined) delete config[key];
    }
    update.mutate(
      { databaseId: database.id, propertyId: property.id, config },
      {
        onError: (error) =>
          toast.error(databaseChangeError(error, database, t('databases.properties.updateFailed'))),
      },
    );
  };
  return { save, pending: update.isPending };
}

/** A number's format and the digits it shows, with how 1234.5 then reads. */
export function NumberSettings({ database, property, onDone }: PropertySettingsProps) {
  const { t, locale } = useTranslation();
  const { save } = useSaveConfig(database, property);
  const config = property.config ?? {};
  return (
    <View className="gap-3">
      <SettingSelect
        label={t('databases.numberFormat.format')}
        value={config.format ?? 'number'}
        options={NUMBER_FORMATS.map((format) => ({
          value: format,
          label: t(`databases.numberFormat.formats.${format.replace(':', '_')}`),
        }))}
        onChange={(format) => save({ format: format as NumberFormat })}
      />
      <SettingSelect
        label={t('databases.numberFormat.precision')}
        value={config.precision === undefined ? 'default' : String(config.precision)}
        options={PRECISIONS.map((p) => ({
          value: p,
          label:
            p === 'default'
              ? t('databases.numberFormat.defaultPrecision')
              : formatNumberValue(1, { format: 'number', precision: Number(p) }, locale),
        }))}
        onChange={(p) => save({ precision: p === 'default' ? undefined : Number(p) })}
      />
      <Text className="text-xs text-muted-foreground">
        {t('databases.numberFormat.example', {
          value: formatNumberValue(1234.5, config, locale),
        })}
      </Text>
      <Done onDone={onDone} />
    </View>
  );
}

/** Whether a date property holds times too, and how its dates read. */
export function DateSettings({ database, property, onDone }: PropertySettingsProps) {
  const { t } = useTranslation();
  const { save } = useSaveConfig(database, property);
  const config = property.config ?? {};
  return (
    <View className="gap-3">
      <SettingSelect
        label={t('databases.dateFormat.format')}
        value={config.dateFormat ?? 'full'}
        options={DATE_FORMATS.map((format) => ({
          value: format,
          label: t(`databases.dateFormat.formats.${format}`),
        }))}
        onChange={(dateFormat) => save({ dateFormat: dateFormat as DateFormat })}
      />
      <SettingSwitch
        label={t('databases.dateFormat.includeTime')}
        checked={config.includeTime === true}
        onChange={(includeTime) => save({ includeTime })}
      />
      <Done onDone={onDone} />
    </View>
  );
}

/** The functions that read the related values, not only count the rows. */
const READS_TARGET: ReadonlySet<RollupFunction> = new Set(
  ROLLUP_FUNCTIONS.filter((fn) => fn !== 'count'),
);

/**
 * A rollup's relation, the property of the related database it reads and
 * what it computes from them, as Notion's rollup settings.
 */
export function RollupSettings({ database, property, onDone }: PropertySettingsProps) {
  const { t } = useTranslation();
  const { save } = useSaveConfig(database, property);
  const config = property.config ?? {};
  const relations = database.schema.properties.filter((p) => p.type === 'relation');
  const relation = relations.find((p) => p.id === config.relationPropertyId);
  const targetId = relation?.config?.targetDatabaseId;
  // The related database's schema: this one's own when it relates to itself.
  const related = useDatabase(targetId && targetId !== database.id ? targetId : undefined);
  const targetSchema = targetId === database.id ? database.schema : related.data?.database.schema;
  const fn = config.function ?? 'count';
  return (
    <View className="gap-3">
      {relations.length === 0 ? (
        <Text className="text-sm text-muted-foreground">{t('databases.rollup.noRelation')}</Text>
      ) : null}
      <SettingSelect
        label={t('databases.rollup.relation')}
        value={config.relationPropertyId ?? ''}
        options={relations.map((p) => ({ value: p.id, label: p.name }))}
        // Another relation reads another database: its target property is not that one's.
        onChange={(relationPropertyId) => save({ relationPropertyId, targetPropertyId: undefined })}
      />
      {READS_TARGET.has(fn) ? (
        <SettingSelect
          label={t('databases.rollup.property')}
          value={config.targetPropertyId ?? ''}
          options={(targetSchema?.properties ?? []).map((p) => ({ value: p.id, label: p.name }))}
          onChange={(targetPropertyId) => save({ targetPropertyId })}
        />
      ) : null}
      <SettingSelect
        label={t('databases.rollup.function')}
        value={fn}
        options={ROLLUP_FUNCTIONS.map((value) => ({
          value,
          label: t(`databases.rollup.functions.${value}`),
        }))}
        onChange={(next) => save({ function: next as RollupFunction })}
      />
      <Done onDone={onDone} />
    </View>
  );
}

function Done({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  return (
    <View className="flex-row justify-end">
      <Button appearance="subtle" size="sm" onPress={onDone}>
        {t('common.done')}
      </Button>
    </View>
  );
}
