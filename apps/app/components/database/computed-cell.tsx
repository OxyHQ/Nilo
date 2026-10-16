import * as React from 'react';
import { View } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { Button } from '@oxy.so/bloom/button';
import { Checkbox } from '@oxy.so/bloom/checkbox';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import type { DatabaseProperty, PropertyValue } from '@/lib/types/databases';

export function ComputedCell({
  property,
  value,
}: {
  property: DatabaseProperty;
  value: PropertyValue;
}) {
  const { t, locale } = useTranslation();
  const [showError, setShowError] = React.useState(false);
  if (value && 'error' in value && value.error) {
    return (
      <View className="gap-1">
        <Button
          iconOnly
          appearance="plain"
          tone="danger"
          size="xs"
          className="self-start"
          accessibilityLabel={t('databases.formula.error', { message: value.error })}
          onHoverIn={() => setShowError(true)}
          onHoverOut={() => setShowError(false)}
          onFocus={() => setShowError(true)}
          onBlur={() => setShowError(false)}
          onPress={() => setShowError((v) => !v)}
          renderLeadingIcon={({ size, color }) => <AlertTriangle size={size} color={color} />}
        />
        {showError ? (
          <Text accessibilityRole="alert" className="text-xs text-destructive web:select-text">
            {value.error}
          </Text>
        ) : null}
      </View>
    );
  }
  if (value && 'checked' in value) {
    return <Checkbox checked={value.checked} disabled accessibilityLabel={property.name} />;
  }
  let display = '—';
  if (value && 'number' in value && value.number !== null) {
    if (property.type === 'unique_id')
      display = property.config?.prefix
        ? `${property.config.prefix}-${value.number}`
        : String(value.number);
    else {
      const format = property.config?.format;
      display = new Intl.NumberFormat(locale, {
        maximumFractionDigits: property.config?.precision ?? 2,
        ...(format === 'percent'
          ? { style: 'percent' }
          : format?.startsWith('currency:')
            ? { style: 'currency', currency: format.slice(9) }
            : {}),
      }).format(value.number);
    }
  } else if (value && 'text' in value) display = value.text || '—';
  else if (value && 'start' in value && value.start) {
    const date = new Date(value.start);
    if (!Number.isNaN(date.getTime()))
      display = value.includeTime ? date.toLocaleString(locale) : date.toLocaleDateString(locale);
  }
  return <Text variant="body-regular">{display}</Text>;
}
