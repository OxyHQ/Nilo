import { View } from 'react-native';
import type { PageActivityChange } from '@oxy.so/nilo-contracts';
import { Text } from '@oxy.so/bloom/typography';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons/RiArrowRightSLine';
import { useTranslation } from '@/hooks/useTranslation';
import type { DatabaseProperty, PropertyValue } from '@/lib/types/databases';
import { useColorScheme } from '@/lib/useColorScheme';
import { PropertyCell } from '../database/property-cell';
import { IconDisplay } from './icon-display';

const noChange = () => {};
const opaqueFields = new Set(['parentId', 'teamspaceId', 'cover']);

/** Nilo supplies domain values; the feed owns entry layout, rhythm and material. */
export function ActivityChanges({
  changes,
  pageId,
}: {
  changes: PageActivityChange[];
  pageId: string;
}) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  return (
    <View className="gap-3">
      {changes.map((change) => {
        const property =
          change.property && change.propertyId
            ? ({ id: change.propertyId, ...change.property } as DatabaseProperty)
            : undefined;
        const label = property?.name ?? t(`pages.activity.fields.${change.field}`);
        // A row-only grant cannot reveal historical database schema. Nor should
        // move events disclose names of a former parent the reader cannot access.
        const generic =
          (change.field === 'properties' && (!property || property.type === 'relation')) ||
          opaqueFields.has(change.field);
        const renderValue = (value: unknown) => {
          if (value === null || value === undefined || value === '')
            return (
              <Text variant="body-2-regular" className="text-muted-foreground">
                {t('pages.activity.emptyValue')}
              </Text>
            );
          if (property)
            return (
              <PropertyCell
                readOnly
                property={property}
                value={value as PropertyValue}
                variant="panel"
                rowId={pageId}
                onChange={noChange}
              />
            );
          if (change.field === 'icon' && typeof value === 'string')
            return <IconDisplay value={value} size={18} pageId={pageId} />;
          return (
            <Text variant="body-2-regular">
              {typeof value === 'boolean'
                ? t(value ? 'pages.activity.enabled' : 'pages.activity.disabled')
                : typeof value === 'string' || typeof value === 'number'
                  ? String(value)
                  : t('pages.activity.changedValue')}
            </Text>
          );
        };
        return (
          <View key={`${change.field}:${change.propertyId ?? ''}`} className="gap-1">
            <Text variant="caption-1-regular" className="text-muted-foreground">
              {label}
            </Text>
            {generic ? (
              <Text variant="body-2-regular">{t('pages.activity.changedValue')}</Text>
            ) : (
              <View className="flex-row flex-wrap items-center gap-2" accessibilityLabel={label}>
                <View className="min-w-0 shrink" accessibilityLabel={t('pages.activity.before')}>
                  {renderValue(change.before)}
                </View>
                <RiArrowRightSLine width={14} height={14} fill={colors.mutedForeground} />
                <View className="min-w-0 shrink" accessibilityLabel={t('pages.activity.after')}>
                  {renderValue(change.after)}
                </View>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
