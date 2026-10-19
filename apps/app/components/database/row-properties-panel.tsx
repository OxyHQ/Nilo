import { useTranslation } from '@/hooks/useTranslation';
import * as React from 'react';
import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import type { Database, DatabaseRow, PropertyValue } from '@/lib/types/databases';
import { useDatabaseRow, useUpdateRow } from '@/lib/hooks/use-database-rows';
import { PropertyCell } from './property-cell';

interface RowPropertiesPanelProps {
  database: Database;
  row: DatabaseRow;
  readOnly?: boolean;
}

/**
 * Property panel rendered above the block editor on a row's detail page.
 * Mirrors Notion's "row open in side peek" UX — every property is
 * editable inline.
 */
export function RowPropertiesPanel({ database, row, readOnly = false }: RowPropertiesPanelProps) {
  const updateRow = useUpdateRow();
  const { t } = useTranslation();
  const computed = useDatabaseRow(database.id, row.id);
  const computedRow = computed.data;

  const onChange = React.useCallback(
    (propertyId: string, value: PropertyValue) => {
      updateRow.mutate({
        databaseId: database.id,
        rowId: row.id,
        properties: { [propertyId]: value },
      });
    },
    [database.id, row.id, updateRow],
  );

  // The Name property is the title above this panel; every other one is
  // listed, computed ones (formulas, rollups) included.
  const properties = database.schema.properties.filter((p) => p.id !== 'name');

  return (
    <View className="gap-2">
      {properties.map((property) => (
        <View key={property.id} className="flex-row items-start gap-3">
          <View className="w-36">
            <Text className="text-xs text-muted-foreground py-1">{property.name}</Text>
          </View>
          <View className="flex-1">
            {property.type === 'formula' && !computedRow ? (
              computed.isPending ? (
                <Loading variant="inline" accessibilityLabel={t('common.loading')} />
              ) : computed.isError ? (
                <Button
                  appearance="plain"
                  className="self-start"
                  onPress={() => {
                    void computed.refetch();
                  }}
                >
                  {t('databases.formula.retry')}
                </Button>
              ) : null
            ) : (
              <PropertyCell
                property={property}
                value={(computedRow ?? row).properties[property.id] ?? null}
                variant="panel"
                readOnly={readOnly}
                onChange={(value) => onChange(property.id, value)}
              />
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
