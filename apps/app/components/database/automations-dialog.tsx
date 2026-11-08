import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { RiPencilLine } from '@oxy.so/bloom/icons/RiPencilLine';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, type DialogControlProps } from '@oxy.so/bloom/dialog';
import { Switch } from '@oxy.so/bloom/switch';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import {
  AUTOMATION_ACTION_KINDS,
  AUTOMATION_TRIGGER_KINDS,
  type Automation,
  type AutomationAction,
  type AutomationTrigger,
  isSafeUrl,
  MAX_AUTOMATION_ACTIONS,
} from '@oxy.so/nilo-contracts';
import { useTranslation } from '@/hooks/useTranslation';
import { SETTABLE_TYPES } from '@/lib/button-actions';
import {
  useCreateAutomation,
  useDatabaseAutomations,
  useDeleteAutomation,
  useUpdateAutomation,
} from '@/lib/hooks/use-database-automations';
import { useDatabase, useDatabases } from '@/lib/hooks/use-databases';
import type { Database, DatabaseProperty, PropertyValue } from '@/lib/types/databases';
import { SetPropertyAction } from './button-settings';
import { DatabaseCellScopeProvider } from './cell-scope';
import { PropertyCell } from './property-cell';
import { SettingSelect } from './view-settings';

const THIS_DATABASE = '__this__';

/** Properties nobody edits by hand: they never start an automation. */
const NOT_EDITED = new Set([
  'formula',
  'rollup',
  'created_time',
  'last_edited_time',
  'created_by',
  'last_edited_by',
  'unique_id',
  'button',
  'verification',
]);

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** The kinds of action a schedule can take: it has no page to edit or look up. */
const SCHEDULE_ACTIONS = AUTOMATION_ACTION_KINDS.filter((k) => k === 'webhook' || k === 'create_row');

type ScheduleTrigger = Extract<AutomationTrigger, { kind: 'schedule' }>;

function describeSchedule(
  trigger: ScheduleTrigger,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const hour = `${String(trigger.hour).padStart(2, '0')}:00 UTC`;
  return trigger.every === 'week'
    ? t('databases.automations.weeklyAt', {
        day: t(`databases.automations.weekdays.${trigger.weekday ?? 0}`),
        hour,
      })
    : t('databases.automations.dailyAt', { hour });
}

function newAction(kind: AutomationAction['kind'], database: Database): AutomationAction {
  if (kind === 'webhook') return { kind, url: '' };
  if (kind === 'create_row') return { kind };
  if (kind === 'notify') {
    const person = database.schema.properties.find((p) => p.type === 'person');
    return { kind, to: { kind: 'property', propertyId: person?.id ?? '' } };
  }
  const first = database.schema.properties.find((p) => SETTABLE_TYPES.has(p.type));
  return { kind: 'set_property', propertyId: first?.id ?? '', value: null };
}

/**
 * A database's automations: when a page is added or a property is edited, set
 * a property, tell people, call a webhook or add a page. Each runs as whoever
 * saved it last, so it keeps working only while they can edit the database.
 */
export function AutomationsDialog({
  databaseId,
  control,
}: {
  databaseId: string;
  control: DialogControlProps;
}) {
  const { t } = useTranslation();
  const { data } = useDatabase(databaseId);
  const [editing, setEditing] = React.useState<Automation | 'new' | null>(null);
  const [secret, setSecret] = React.useState<{ name: string; value: string } | null>(null);
  const automations = useDatabaseAutomations(databaseId, Boolean(data));
  const update = useUpdateAutomation(databaseId);
  const remove = useDeleteAutomation(databaseId);
  const database = data?.database;

  const summary = (a: Automation) => {
    const trigger =
      a.trigger.kind === 'row_added'
        ? t('databases.automations.triggers.row_added')
        : a.trigger.kind === 'schedule'
          ? t('databases.automations.scheduleSummary', { when: describeSchedule(a.trigger, t) })
          : t('databases.automations.editedSummary', {
            property:
              database?.schema.properties.find(
                (p) => a.trigger.kind === 'property_edited' && p.id === a.trigger.propertyId,
              )?.name ?? '?',
          });
    return `${trigger} → ${a.actions.map((x) => t(`databases.automations.actions.${x.kind}`)).join(', ')}`;
  };

  return (
    <Dialog
      control={control}
      onClose={() => {
        setEditing(null);
        setSecret(null);
      }}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={480}
      label={t('databases.automations.title')}
      title={t('databases.automations.title')}
      description={editing ? undefined : t('databases.automations.description')}
    >
      {!database ? null : editing ? (
        <AutomationForm
          databaseId={databaseId}
          database={database}
          automation={editing === 'new' ? null : editing}
          onDone={(created) => {
            if (created) setSecret({ name: created.name, value: created.secret });
            setEditing(null);
          }}
        />
      ) : (
        <ScrollView className="max-h-96" contentContainerClassName="gap-2">
          {secret ? (
            <View className="gap-1 rounded-md bg-muted p-2">
              <Text className="text-xs text-muted-foreground">
                {t('databases.automations.secretHint', { name: secret.name })}
              </Text>
              <Text selectable className="font-mono text-xs text-foreground">
                {secret.value}
              </Text>
            </View>
          ) : null}
          {(automations.data ?? []).length === 0 && !automations.isLoading ? (
            <Text className="text-sm text-muted-foreground">
              {t('databases.automations.empty')}
            </Text>
          ) : null}
          {(automations.data ?? []).map((a) => (
            <View key={a.id} className="gap-1 rounded-md border border-border p-2">
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>
                  {a.name}
                </Text>
                <Switch
                  size="sm"
                  checked={a.enabled}
                  accessibilityLabel={t('databases.automations.enabled', { name: a.name })}
                  onCheckedChange={(enabled) =>
                    update.mutate(
                      { id: a.id, patch: { enabled } },
                      { onError: () => toast.error(t('databases.automations.failed')) },
                    )
                  }
                />
                <Button
                  iconOnly
                  appearance="plain"
                  size="sm"
                  leadingIcon={RiPencilLine}
                  accessibilityLabel={t('databases.automations.edit', { name: a.name })}
                  onPress={() => setEditing(a)}
                />
                <Button
                  iconOnly
                  appearance="plain"
                  size="sm"
                  leadingIcon={RiDeleteBin6Line}
                  accessibilityLabel={t('databases.automations.delete', { name: a.name })}
                  onPress={() =>
                    remove.mutate(a.id, {
                      onError: () => toast.error(t('databases.automations.failed')),
                    })
                  }
                />
              </View>
              <Text className="text-xs text-muted-foreground">{summary(a)}</Text>
              {a.lastStatus === 'failed' ? (
                <Text accessibilityRole="alert" className="text-xs text-destructive">
                  {t('databases.automations.lastFailed', { error: a.lastError ?? '' })}
                </Text>
              ) : null}
            </View>
          ))}
          <Button
            appearance="plain"
            size="sm"
            className="self-start"
            leadingIcon={RiAddLine}
            onPress={() => setEditing('new')}
          >
            {t('databases.automations.add')}
          </Button>
        </ScrollView>
      )}
    </Dialog>
  );
}

function AutomationForm({
  databaseId,
  database,
  automation,
  onDone,
}: {
  databaseId: string;
  database: Database;
  automation: Automation | null;
  onDone: (created?: { name: string; secret: string }) => void;
}) {
  const { t } = useTranslation();
  const create = useCreateAutomation(databaseId);
  const update = useUpdateAutomation(databaseId);
  const others = (useDatabases(database.workspaceId).data?.databases ?? []).filter(
    (d) => d.id !== database.id && !d.archived,
  );
  const watchable = database.schema.properties.filter((p) => !NOT_EDITED.has(p.type));
  const people = database.schema.properties.filter((p) => p.type === 'person');
  const settable = database.schema.properties.filter((p) => SETTABLE_TYPES.has(p.type));
  const [name, setName] = React.useState(automation?.name ?? '');
  const [trigger, setTrigger] = React.useState<AutomationTrigger>(
    automation?.trigger ?? { kind: 'row_added' },
  );
  const [actions, setActions] = React.useState<AutomationAction[]>(
    automation?.actions ?? [newAction('set_property', database)],
  );
  const change = (index: number, next: AutomationAction) =>
    setActions((list) => list.map((a, i) => (i === index ? next : a)));

  const watched =
    trigger.kind === 'property_edited'
      ? watchable.find((p) => p.id === trigger.propertyId)
      : undefined;
  const invalid =
    name.trim() === '' ||
    (trigger.kind === 'property_edited' && !watched) ||
    actions.some(
      (a) =>
        (a.kind === 'set_property' && (!a.propertyId || a.value == null)) ||
        (a.kind === 'notify' && a.to.kind === 'property' && !a.to.propertyId) ||
        (a.kind === 'webhook' && !isSafeUrl(a.url)),
    );
  const pending = create.isPending || update.isPending;

  const save = () => {
    const input = { name: name.trim(), trigger, actions };
    const failed = () => toast.error(t('databases.automations.failed'));
    if (automation) {
      update.mutate(
        { id: automation.id, patch: input },
        { onSuccess: () => onDone(), onError: failed },
      );
    } else {
      create.mutate(input, {
        onSuccess: ({ automation: made, secret }) =>
          onDone(
            actions.some((a) => a.kind === 'webhook') ? { name: made.name, secret } : undefined,
          ),
        onError: failed,
      });
    }
  };

  return (
    <DatabaseCellScopeProvider databaseId={database.id}>
      <ScrollView className="max-h-96" contentContainerClassName="gap-3">
        <TextFieldInput
          size="sm"
          label={t('databases.automations.name')}
          value={name}
          maxLength={120}
          onChangeText={setName}
        />
        <SettingSelect
          label={t('databases.automations.trigger')}
          value={trigger.kind}
          options={AUTOMATION_TRIGGER_KINDS.map((kind) => ({
            value: kind,
            label: t(`databases.automations.triggers.${kind}`),
          }))}
          onChange={(kind) => {
            if (kind === 'schedule') {
              setTrigger({ kind: 'schedule', every: 'day', hour: 9 });
              // Nothing to edit or look up on a page: keep only what a schedule can do.
              setActions((list) => {
                const kept = list.filter((a) => a.kind === 'webhook' || a.kind === 'create_row');
                return kept.length > 0 ? kept : [newAction('create_row', database)];
              });
            } else {
              setTrigger(
                kind === 'row_added'
                  ? { kind }
                  : { kind: 'property_edited', propertyId: watchable[0]?.id ?? '' },
              );
            }
          }}
        />
        {trigger.kind === 'schedule' ? (
          <>
            <SettingSelect
              label={t('databases.automations.every')}
              value={trigger.every}
              options={[
                { value: 'day', label: t('databases.automations.everyDay') },
                { value: 'week', label: t('databases.automations.everyWeek') },
              ]}
              onChange={(every) =>
                setTrigger(
                  every === 'week'
                    ? { kind: 'schedule', every, hour: trigger.hour, weekday: 1 }
                    : { kind: 'schedule', every: 'day', hour: trigger.hour },
                )
              }
            />
            {trigger.every === 'week' ? (
              <SettingSelect
                label={t('databases.automations.weekday')}
                value={String(trigger.weekday ?? 1)}
                options={WEEKDAYS.map((d) => ({
                  value: String(d),
                  label: t(`databases.automations.weekdays.${d}`),
                }))}
                onChange={(weekday) => setTrigger({ ...trigger, weekday: Number(weekday) })}
              />
            ) : null}
            <SettingSelect
              label={t('databases.automations.hour')}
              value={String(trigger.hour)}
              options={HOURS.map((h) => ({
                value: String(h),
                label: `${String(h).padStart(2, '0')}:00 UTC`,
              }))}
              onChange={(hour) => setTrigger({ ...trigger, hour: Number(hour) })}
            />
          </>
        ) : null}
        {trigger.kind === 'property_edited' ? (
          <>
            <SettingSelect
              label={t('databases.automations.property')}
              value={trigger.propertyId}
              options={watchable.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(propertyId) => setTrigger({ kind: 'property_edited', propertyId })}
            />
            {watched && SETTABLE_TYPES.has(watched.type) ? (
              <WhenBecomes
                property={watched}
                value={trigger.equals}
                onChange={(equals) =>
                  setTrigger({
                    kind: 'property_edited',
                    propertyId: trigger.propertyId,
                    ...(equals !== undefined && { equals }),
                  })
                }
              />
            ) : null}
          </>
        ) : null}
        <Text className="text-xs uppercase tracking-wider text-muted-foreground">
          {t('databases.automations.doThis')}
        </Text>
        {actions.map((action, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an action is its place in the list
          <View key={index} className="gap-2 rounded-md border border-border p-2">
            <View className="flex-row items-end gap-2">
              <View className="flex-1">
                <SettingSelect
                  label={t('databases.automations.action')}
                  value={action.kind}
                  options={(trigger.kind === 'schedule' ? SCHEDULE_ACTIONS : AUTOMATION_ACTION_KINDS).map((kind) => ({
                    value: kind,
                    label: t(`databases.automations.actions.${kind}`),
                  }))}
                  onChange={(kind) =>
                    change(index, newAction(kind as AutomationAction['kind'], database))
                  }
                />
              </View>
              <Button
                iconOnly
                appearance="plain"
                size="sm"
                leadingIcon={RiDeleteBin6Line}
                disabled={actions.length === 1}
                accessibilityLabel={t('databases.button.remove', { index: index + 1 })}
                onPress={() => setActions((list) => list.filter((_, i) => i !== index))}
              />
            </View>
            {action.kind === 'set_property' ? (
              <SetPropertyAction
                action={action}
                settable={settable}
                onChange={(next) => change(index, next)}
              />
            ) : null}
            {action.kind === 'notify' ? (
              <>
                <SettingSelect
                  label={t('databases.automations.notifyWho')}
                  value={action.to.kind === 'property' ? action.to.propertyId : ''}
                  options={people.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(propertyId) =>
                    change(index, { ...action, to: { kind: 'property', propertyId } })
                  }
                />
                <TextFieldInput
                  size="sm"
                  label={t('databases.automations.message')}
                  value={action.message ?? ''}
                  maxLength={500}
                  onChangeText={(message) =>
                    change(index, { ...action, message: message || undefined })
                  }
                />
              </>
            ) : null}
            {action.kind === 'webhook' ? (
              <View className="gap-1">
                <TextFieldInput
                  size="sm"
                  label={t('databases.automations.webhookUrl')}
                  value={action.url}
                  placeholder="https://"
                  autoCapitalize="none"
                  keyboardType="url"
                  onChangeText={(url) => change(index, { ...action, url })}
                />
                {action.url !== '' && !isSafeUrl(action.url) ? (
                  <Text accessibilityRole="alert" className="text-xs text-destructive">
                    {t('databases.automations.invalidUrl')}
                  </Text>
                ) : null}
              </View>
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
                  onChangeText={(title) => change(index, { ...action, title: title || undefined })}
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
            disabled={actions.length >= MAX_AUTOMATION_ACTIONS}
            onPress={() => setActions((list) => [...list, newAction('notify', database)])}
          >
            {t('databases.automations.addAction')}
          </Button>
          <View className="flex-row gap-2">
            <Button appearance="subtle" size="sm" onPress={() => onDone()}>
              {t('common.cancel')}
            </Button>
            <Button
              appearance="solid"
              tone="accent"
              size="sm"
              disabled={invalid || pending}
              onPress={save}
            >
              {t('common.save')}
            </Button>
          </View>
        </View>
      </ScrollView>
    </DatabaseCellScopeProvider>
  );
}

/** "Only when it becomes…": the edited property's own editor picks the value. */
function WhenBecomes({
  property,
  value,
  onChange,
}: {
  property: DatabaseProperty;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const { t } = useTranslation();
  const on = value !== undefined;
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between gap-2">
        <Text variant="body-regular">{t('databases.automations.onlyWhen')}</Text>
        <Switch
          size="sm"
          checked={on}
          accessibilityLabel={t('databases.automations.onlyWhen')}
          onCheckedChange={(next) => onChange(next ? null : undefined)}
        />
      </View>
      {on ? (
        <PropertyCell
          property={property}
          value={(value ?? null) as PropertyValue}
          variant="panel"
          onChange={(next) => onChange(next)}
        />
      ) : null}
    </View>
  );
}
