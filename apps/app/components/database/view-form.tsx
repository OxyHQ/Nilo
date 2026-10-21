import { useState } from 'react';
import { View } from 'react-native';
import { ScreenScrollView } from '@oxy.so/bloom/screen';
import * as Clipboard from 'expo-clipboard';
import { Button } from '@oxy.so/bloom/button';
import { Loading } from '@oxy.so/bloom/loading';
import { Switch } from '@oxy.so/bloom/switch';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Textarea } from '@oxy.so/bloom/textarea';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { FormFields } from '@/components/forms/form-fields';
import { buildFormUrl } from '@/components/sharing/build-share-url';
import { formFields, type FormDraft } from '@/lib/forms';
import { useFormLink, useChangeFormLink } from '@/lib/hooks/use-forms';
import { useUpdateView } from '@/lib/hooks/use-database-views';
import type { Database, DatabaseView } from '@/lib/types/databases';

export function ViewForm({
  database,
  view,
  readOnly,
}: {
  database: Database;
  view: DatabaseView;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  if (readOnly)
    return (
      <Text className="p-6 text-base text-muted-foreground">{t('databases.form.editorsOnly')}</Text>
    );
  return <FormBuilder key={view.id} database={database} view={view} />;
}
function FormBuilder({ database, view }: { database: Database; view: DatabaseView }) {
  const { t } = useTranslation();
  const update = useUpdateView();
  const [draft, setDraft] = useState<{
    name: string;
    description: string;
    hiddenProperties: string[];
  } | null>(null);
  const current = draft ?? {
    name: view.name,
    description: view.config.description ?? '',
    hiddenProperties: view.hiddenProperties,
  };
  const [preview, setPreview] = useState(false);
  const [answers, setAnswers] = useState<FormDraft>({});
  const fields = formFields(database.schema.properties, []);
  const save = () =>
    update.mutate(
      {
        databaseId: database.id,
        viewId: view.id,
        name: current.name.trim(),
        config: { ...view.config, description: current.description },
        hiddenProperties: current.hiddenProperties.filter((id) => id !== 'name'),
      },
      {
        onSuccess: () => {
          setDraft(null);
          toast.success(t('databases.form.saved'));
        },
      },
    );
  return (
    <ScreenScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="p-6 gap-5 max-w-3xl w-full mx-auto"
    >
      <Text accessibilityRole="header" variant="title-3-semibold">
        {t('databases.form.builder')}
      </Text>
      <Text variant="body-regular">{t('databases.form.title')}</Text>
      <TextFieldInput
        label={t('databases.form.title')}
        placeholder={null}
        value={current.name}
        editable={!update.isPending}
        onChangeText={(name) => setDraft({ ...current, name })}
      />
      <Text variant="body-regular">{t('databases.form.description')}</Text>
      <Textarea
        accessibilityLabel={t('databases.form.description')}
        value={current.description}
        editable={!update.isPending}
        onChangeText={(description) => setDraft({ ...current, description })}
      />
      <Text variant="headline-medium">{t('databases.form.fields')}</Text>
      {fields.map((field) => (
        <View key={field.id} className="flex-row items-center justify-between gap-3">
          <Text className="flex-1 text-base text-foreground">
            {field.required ? t('databases.form.requiredLabel', { name: field.name }) : field.name}
          </Text>
          <Switch
            accessibilityLabel={t('databases.form.showField', { name: field.name })}
            checked={field.required || !current.hiddenProperties.includes(field.id)}
            disabled={field.required || update.isPending}
            onCheckedChange={(show) =>
              setDraft({
                ...current,
                hiddenProperties: show
                  ? current.hiddenProperties.filter((id) => id !== field.id)
                  : [...current.hiddenProperties, field.id],
              })
            }
          />
        </View>
      ))}
      {update.isError ? (
        <Text accessibilityRole="alert" className="text-base text-destructive">
          {t('databases.form.saveFailed')}
        </Text>
      ) : null}
      <View className="flex-row gap-2">
        <Button
          appearance="solid"
          tone="accent"
          accessibilityLabel={t('common.save')}
          onPress={save}
          disabled={!draft || !current.name.trim() || update.isPending}
        >
          {t('common.save')}
        </Button>
        <Button
          appearance="outline"
          accessibilityLabel={t('databases.form.preview')}
          aria-expanded={preview}
          onPress={() => setPreview(!preview)}
        >
          {t('databases.form.preview')}
        </Button>
      </View>
      {preview ? (
        <View className="rounded-lg border border-border p-4 gap-4">
          <Text variant="title-2-semibold">{current.name}</Text>
          <Text variant="body-regular">{current.description}</Text>
          <FormFields
            fields={formFields(
              database.schema.properties,
              current.hiddenProperties.filter((id) => id !== 'name'),
            )}
            draft={answers}
            onChange={setAnswers}
          />
          <Text className="text-sm text-muted-foreground">{t('databases.form.previewHint')}</Text>
        </View>
      ) : null}
      <FormLinkPanel databaseId={database.id} viewId={view.id} />
    </ScreenScrollView>
  );
}
function FormLinkPanel({ databaseId, viewId }: { databaseId: string; viewId: string }) {
  const { t } = useTranslation();
  const query = useFormLink(databaseId, viewId);
  const change = useChangeFormLink(databaseId, viewId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const form = query.data?.form;
  const copy = async () => {
    if (!form) return;
    try {
      await Clipboard.setStringAsync(buildFormUrl(form.token));
      toast.success(t('pages.toasts.linkCopied'));
    } catch {
      toast.error(t('databases.form.copyFailed'));
    }
  };
  return (
    <View className="gap-3 border-t border-border pt-5">
      <Text variant="headline-semibold">{t('databases.form.link')}</Text>
      {query.isPending ? (
        <Loading variant="inline" />
      ) : query.isError ? (
        <>
          <Text accessibilityRole="alert" className="text-base text-destructive">
            {t('databases.form.loadFailed')}
          </Text>
          <Button
            appearance="outline"
            accessibilityLabel={t('databases.form.retry')}
            onPress={() => void query.refetch()}
          >
            {t('databases.form.retry')}
          </Button>
        </>
      ) : form ? (
        <>
          <TextFieldInput
            label={t('databases.form.link')}
            placeholder={null}
            value={buildFormUrl(form.token)}
            editable={false}
          />
          <Button
            appearance="outline"
            accessibilityLabel={t('databases.form.copyLink')}
            onPress={copy}
          >
            {t('databases.form.copyLink')}
          </Button>
          {(['open', 'requireSignIn'] as const).map((key) => (
            <View key={key} className="flex-row items-center justify-between gap-3">
              <Text className="flex-1 text-base text-foreground">{t(`databases.form.${key}`)}</Text>
              <Switch
                accessibilityLabel={t(`databases.form.${key}`)}
                checked={form[key]}
                disabled={change.isPending}
                onCheckedChange={(value) => change.mutate({ [key]: value })}
              />
            </View>
          ))}
          {confirmDelete ? (
            <View className="gap-2">
              <Text variant="body-regular">{t('databases.form.deleteHint')}</Text>
              <Button
                appearance="solid"
                tone="danger"
                disabled={change.isPending}
                accessibilityLabel={t('databases.form.deleteLink')}
                onPress={() => change.mutate(null, { onSuccess: () => setConfirmDelete(false) })}
              >
                {t('databases.form.deleteLink')}
              </Button>
              <Button
                appearance="outline"
                disabled={change.isPending}
                accessibilityLabel={t('common.cancel')}
                onPress={() => setConfirmDelete(false)}
              >
                {t('common.cancel')}
              </Button>
            </View>
          ) : (
            <Button
              appearance="outline"
              disabled={change.isPending}
              accessibilityLabel={t('databases.form.deleteLink')}
              onPress={() => setConfirmDelete(true)}
            >
              {t('databases.form.deleteLink')}
            </Button>
          )}
        </>
      ) : (
        <Button
          appearance="solid"
          tone="accent"
          disabled={change.isPending}
          accessibilityLabel={t('databases.form.createLink')}
          onPress={() => change.mutate({})}
        >
          {t('databases.form.createLink')}
        </Button>
      )}
      {change.isError ? (
        <Text accessibilityRole="alert" className="text-base text-destructive">
          {t('databases.form.saveFailed')}
        </Text>
      ) : null}
    </View>
  );
}
