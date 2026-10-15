import * as React from 'react';
import { Pressable, View } from 'react-native';
import { AlertTriangle, Check } from 'lucide-react-native';
import { Text } from '@/components/ui/text';
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('databases.formula.error', { message: value.error })}
          onHoverIn={() => setShowError(true)}
          onHoverOut={() => setShowError(false)}
          onFocus={() => setShowError(true)}
          onBlur={() => setShowError(false)}
          onPress={() => setShowError((v) => !v)}
          className="self-start p-1"
        >
          <AlertTriangle size={14} className="text-destructive" />
        </Pressable>
        {showError ? (
          <Text accessibilityRole="alert" className="text-xs text-destructive">
            {value.error}
          </Text>
        ) : null}
      </View>
    );
  }
  if (value && 'checked' in value) {
    return (
      <View
        accessibilityRole="checkbox"
        accessibilityLabel={property.name}
        accessibilityState={{ checked: value.checked, disabled: true }}
        className="h-5 w-5 rounded border border-border items-center justify-center"
      >
        {value.checked ? <Check size={14} className="text-foreground" /> : null}
      </View>
    );
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
  return <Text className="text-sm text-foreground">{display}</Text>;
}
