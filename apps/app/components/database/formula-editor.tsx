import { MONO_FONT_FAMILY } from '@/lib/fonts';
import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { useDatabaseRows } from '@/lib/hooks/use-database-rows';
import { useUpdateProperty } from '@/lib/hooks/use-database-properties';
import { FORMULA_FUNCTIONS } from '@/lib/formula-functions';
import { propertyExpression } from '@/lib/formula-results';
import type { Database, DatabaseProperty, PropertyValue } from '@/lib/types/databases';
import { ComputedCell } from './computed-cell';

export function FormulaEditor({
  database,
  property,
  onDone,
  viewId = null,
}: {
  database: Database;
  property: DatabaseProperty;
  onDone: () => void;
  viewId?: string | null;
}) {
  const { t } = useTranslation();
  const [expression, setExpression] = React.useState(property.config?.expression ?? '');
  const [selection, setSelection] = React.useState({
    start: expression.length,
    end: expression.length,
  });
  const [preview, setPreview] = React.useState<{ value: PropertyValue; expression: string } | null>(
    null,
  );
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const rows = useDatabaseRows(database.id, viewId);
  const update = useUpdateProperty();
  const insert = (text: string) => {
    const next = expression.slice(0, selection.start) + text + expression.slice(selection.end);
    setExpression(next);
    setSelection({ start: selection.start + text.length, end: selection.start + text.length });
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    setPreview(null);
    try {
      await update.mutateAsync({
        databaseId: database.id,
        propertyId: property.id,
        config: { ...property.config, expression },
      });
      const result = await rows.refetch();
      if (result.isError) setError(t('databases.formula.refreshFailed'));
      else
        setPreview({
          value: result.data?.pages[0]?.rows[0]?.properties[property.id] ?? null,
          expression,
        });
    } catch {
      setError(t('databases.formula.saveFailed'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <ScrollView style={{ maxHeight: 480, flexShrink: 1 }} keyboardShouldPersistTaps="handled">
      <View className="gap-3">
        <Text className="font-semibold text-foreground">{t('databases.formula.edit')}</Text>
        <Textarea
          maxLength={2000}
          style={{ fontFamily: MONO_FONT_FAMILY }}
          value={expression}
          editable={!saving}
          accessibilityLabel={t('databases.formula.expression')}
          className="font-mono min-h-24"
          autoCapitalize="none"
          autoCorrect={false}
          selection={selection}
          onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
          onChangeText={setExpression}
        />
        <Text className="text-xs text-muted-foreground">{t('databases.formula.operators')}</Text>
        <Text className="text-sm font-medium">{t('databases.formula.properties')}</Text>
        <View className="flex-row flex-wrap gap-1">
          {database.schema.properties.map((p) => (
            <Button
              key={p.id}
              disabled={saving}
              size="sm"
              variant="outline"
              accessibilityLabel={t('databases.formula.insert', { name: p.name })}
              onPress={() => insert(propertyExpression(p.name))}
            >
              <Text>{p.name}</Text>
            </Button>
          ))}
        </View>
        <Text className="text-sm font-medium">{t('databases.formula.functions')}</Text>
        <ScrollView
          style={{ maxHeight: 160 }}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          {FORMULA_FUNCTIONS.map((name) => (
            <Button
              key={name}
              disabled={saving}
              variant="ghost"
              className="h-auto items-start py-2"
              accessibilityLabel={t('databases.formula.insert', { name })}
              onPress={() => insert(t(`databases.formula.help.${name}.example`))}
            >
              <Text className="font-mono">{name}</Text>
              <Text className="text-xs text-muted-foreground whitespace-normal">
                {t(`databases.formula.help.${name}.description`)}
              </Text>
              <Text className="font-mono text-xs">
                {t(`databases.formula.help.${name}.example`)}
              </Text>
            </Button>
          ))}
        </ScrollView>
        {error ? (
          <Text accessibilityRole="alert" className="text-sm text-destructive">
            {error}
          </Text>
        ) : null}
        {preview && preview.expression === expression ? (
          <View className="gap-2 rounded bg-muted p-3" accessibilityLiveRegion="polite">
            <Text className="text-xs text-muted-foreground">{t('databases.formula.preview')}</Text>
            {preview.value === null ? (
              <Text>{t('databases.formula.empty')}</Text>
            ) : (
              <ComputedCell property={property} value={preview.value} />
            )}
          </View>
        ) : null}
        <View className="flex-row justify-end gap-2">
          <Button variant="outline" onPress={onDone} disabled={saving}>
            <Text>{t('common.done')}</Text>
          </Button>
          <Button
            onPress={() => {
              void save();
            }}
            disabled={saving}
          >
            <Text>{t('common.save')}</Text>
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}
