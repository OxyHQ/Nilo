import * as React from 'react';
import { View } from 'react-native';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { Button } from '@oxy.so/bloom/button';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { BUTTON_ACTION_KINDS, MAX_BUTTON_ACTIONS } from '@oxy.so/nilo-contracts';
import { useTranslation } from '@/hooks/useTranslation';
import { isButtonLink, SETTABLE_TYPES } from '@/lib/button-actions';
import { databaseChangeError } from '@/lib/database-errors';
import { useUpdateProperty } from '@/lib/hooks/use-database-properties';
import { useDatabases } from '@/lib/hooks/use-databases';
import type {
  ButtonAction,
  Database,
  DatabaseProperty,
  PropertyValue,
} from '@/lib/types/databases';
import { DatabaseCellScopeProvider } from './cell-scope';
import { PropertyCell } from './property-cell';
import { SettingSelect } from './view-settings';

interface ButtonSettingsProps {
  database: Database;
  property: DatabaseProperty;
  onDone: () => void;
}

const THIS_DATABASE = '__this__';

/** A new action of `kind`, filled with what it can start from. */
function newAction(kind: ButtonAction['kind'], settable: DatabaseProperty[]): ButtonAction {
  if (kind === 'open_url') return { kind, url: '' };
  if (kind === 'create_row') return { kind };
  const first = settable[0];
  return { kind: 'set_property', propertyId: first?.id ?? '', value: null };
}

/**
 * A button's actions, edited in a list and saved together: open a link, set
 * a property of the row to a value (picked with that property's own editor),
 * add a page to this database or another. A link that is not the web or an
 * email, or an action with nothing set, keeps the list from being saved.
 */
export function ButtonSettings({ database, property, onDone }: ButtonSettingsProps) {
  const { t } = useTranslation();
  const update = useUpdateProperty();
  const databases = useDatabases(database.workspaceId);
  const [actions, setActions] = React.useState<ButtonAction[]>(property.config?.actions ?? []);
  const settable = database.schema.properties.filter(
    (p) => SETTABLE_TYPES.has(p.type) && p.id !== property.id,
  );
  const others = (databases.data?.databases ?? []).filter(
    (d) => d.id !== database.id && !d.archived,
  );

  const change = (index: number, next: ButtonAction) =>
    setActions((list) => list.map((a, i) => (i === index ? next : a)));
  const remove = (index: number) => setActions((list) => list.filter((_, i) => i !== index));

  const invalid = actions.some(
    (a) =>
      (a.kind === 'open_url' && !isButtonLink(a.url)) ||
      (a.kind === 'set_property' && (!a.propertyId || a.value === null || a.value === undefined)),
  );

  const save = () => {
    update.mutate(
      {
        databaseId: database.id,
        propertyId: property.id,
        config: { ...(property.config ?? {}), actions },
      },
      {
        onSuccess: onDone,
        onError: (error) =>
          toast.error(databaseChangeError(error, database, t('databases.properties.updateFailed'))),
      },
    );
  };

  return (
    <DatabaseCellScopeProvider databaseId={database.id}>
      <View className="gap-3">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground">
          {t('databases.button.actions')}
        </Text>
        {actions.length === 0 ? (
          <Text className="text-sm text-muted-foreground">{t('databases.button.noActions')}</Text>
        ) : null}
        {actions.map((action, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an action is its place in the list
          <View key={index} className="gap-2 rounded-md border border-border p-2">
            <View className="flex-row items-end gap-2">
              <View className="flex-1">
                <SettingSelect
                  label={t('databases.button.kind')}
                  value={action.kind}
                  options={BUTTON_ACTION_KINDS.map((kind) => ({
                    value: kind,
                    label: t(`databases.button.kinds.${kind}`),
                  }))}
                  onChange={(kind) =>
                    change(index, newAction(kind as ButtonAction['kind'], settable))
                  }
                />
              </View>
              <Button
                iconOnly
                appearance="plain"
                size="sm"
                leadingIcon={RiDeleteBin6Line}
                accessibilityLabel={t('databases.button.remove', { index: index + 1 })}
                onPress={() => remove(index)}
              />
            </View>
            {action.kind === 'open_url' ? (
              <View className="gap-1">
                <TextFieldInput
                  size="sm"
                  label={t('databases.button.url')}
                  value={action.url}
                  placeholder="https://"
                  autoCapitalize="none"
                  keyboardType="url"
                  onChangeText={(url) => change(index, { ...action, url })}
                />
                {action.url !== '' && !isButtonLink(action.url) ? (
                  <Text accessibilityRole="alert" className="text-xs text-destructive">
                    {t('databases.button.invalidUrl')}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {action.kind === 'set_property' ? (
              <SetPropertyAction
                action={action}
                settable={settable}
                onChange={(next) => change(index, next)}
              />
            ) : null}
            {action.kind === 'create_row' ? (
              <>
                <SettingSelect
                  label={t('databases.button.database')}
                  value={action.databaseId ?? THIS_DATABASE}
                  options={[
                    { value: THIS_DATABASE, label: t('databases.button.thisDatabase') },
                    ...others.map((d) => ({
                      value: d.id,
                      label: d.name || t('databases.untitledDatabase'),
                    })),
                  ]}
                  onChange={(id) =>
                    change(index, {
                      kind: 'create_row',
                      ...(id !== THIS_DATABASE && { databaseId: id }),
                      ...(action.title && { title: action.title }),
                    })
                  }
                />
                <TextFieldInput
                  size="sm"
                  label={t('databases.button.title')}
                  value={action.title ?? ''}
                  placeholder={t('databases.untitled')}
                  onChangeText={(title) =>
                    change(index, { ...action, ...(title ? { title } : { title: undefined }) })
                  }
                />
              </>
            ) : null}
          </View>
        ))}
        <View className="flex-row items-center justify-between gap-2">
          <Button
            appearance="plain"
            size="sm"
            leadingIcon={RiAddLine}
            disabled={actions.length >= MAX_BUTTON_ACTIONS}
            onPress={() => setActions((list) => [...list, newAction('open_url', settable)])}
          >
            {t('databases.button.add')}
          </Button>
          <View className="flex-row gap-2">
            <Button appearance="subtle" size="sm" onPress={onDone}>
              {t('common.cancel')}
            </Button>
            <Button
              appearance="solid"
              tone="accent"
              size="sm"
              disabled={invalid || update.isPending}
              onPress={save}
            >
              {t('common.save')}
            </Button>
          </View>
        </View>
      </View>
    </DatabaseCellScopeProvider>
  );
}

/** An "edit a property" action: which property, and the value it gets, in that property's editor. */
function SetPropertyAction({
  action,
  settable,
  onChange,
}: {
  action: Extract<ButtonAction, { kind: 'set_property' }>;
  settable: DatabaseProperty[];
  onChange: (next: ButtonAction) => void;
}) {
  const { t } = useTranslation();
  const target = settable.find((p) => p.id === action.propertyId);
  return (
    <>
      <SettingSelect
        label={t('databases.button.property')}
        value={action.propertyId}
        options={settable.map((p) => ({ value: p.id, label: p.name }))}
        onChange={(propertyId) => onChange({ kind: 'set_property', propertyId, value: null })}
      />
      {target ? (
        <View className="gap-1">
          <Text className="text-xs uppercase tracking-wider text-muted-foreground">
            {t('databases.button.value')}
          </Text>
          <PropertyCell
            property={target}
            value={(action.value ?? null) as PropertyValue}
            variant="panel"
            onChange={(value) => onChange({ ...action, value })}
          />
        </View>
      ) : null}
    </>
  );
}
