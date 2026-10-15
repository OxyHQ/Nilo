import { useState } from 'react';
import { ScrollView, View, ActivityIndicator } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@/components/ui/text';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
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
    return <Text className="p-6 text-muted-foreground">{t('databases.form.editorsOnly')}</Text>;
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
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="p-6 gap-5 max-w-3xl w-full mx-auto"
    >
      <Text accessibilityRole="header" className="text-lg font-semibold">
        {t('databases.form.builder')}
      </Text>
      <Text>{t('databases.form.title')}</Text>
      <Input
        accessibilityLabel={t('databases.form.title')}
        value={current.name}
        editable={!update.isPending}
        onChangeText={(name) => setDraft({ ...current, name })}
      />
      <Text>{t('databases.form.description')}</Text>
      <Textarea
        accessibilityLabel={t('databases.form.description')}
        value={current.description}
        editable={!update.isPending}
        onChangeText={(description) => setDraft({ ...current, description })}
      />
      <Text className="font-medium">{t('databases.form.fields')}</Text>
      {fields.map((field) => (
        <View key={field.id} className="flex-row items-center justify-between gap-3">
          <Text className="flex-1">
            {field.required ? t('databases.form.requiredLabel', { name: field.name }) : field.name}
          </Text>
          <Switch
            accessibilityLabel={t('databases.form.showField', { name: field.name })}
            value={field.required || !current.hiddenProperties.includes(field.id)}
            disabled={field.required || update.isPending}
            onValueChange={(show) =>
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
        <Text accessibilityRole="alert" className="text-destructive">
          {t('databases.form.saveFailed')}
        </Text>
      ) : null}
      <View className="flex-row gap-2">
        <Button
          accessibilityLabel={t('common.save')}
          onPress={save}
          disabled={!draft || !current.name.trim() || update.isPending}
        >
          <Text>{t('common.save')}</Text>
        </Button>
        <Button
          variant="outline"
          accessibilityLabel={t('databases.form.preview')}
          accessibilityState={{ expanded: preview }}
          onPress={() => setPreview(!preview)}
        >
          <Text>{t('databases.form.preview')}</Text>
        </Button>
      </View>
      {preview ? (
        <View className="rounded-lg border border-border p-4 gap-4">
          <Text className="text-xl font-semibold">{current.name}</Text>
          <Text>{current.description}</Text>
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
    </ScrollView>
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
      <Text className="font-semibold">{t('databases.form.link')}</Text>
      {query.isPending ? (
        <ActivityIndicator />
      ) : query.isError ? (
        <>
          <Text accessibilityRole="alert" className="text-destructive">
            {t('databases.form.loadFailed')}
          </Text>
          <Button
            variant="outline"
            accessibilityLabel={t('databases.form.retry')}
            onPress={() => void query.refetch()}
          >
            <Text>{t('databases.form.retry')}</Text>
          </Button>
        </>
      ) : form ? (
        <>
          <Input
            accessibilityLabel={t('databases.form.link')}
            value={buildFormUrl(form.token)}
            editable={false}
          />
          <Button
            variant="outline"
            accessibilityLabel={t('databases.form.copyLink')}
            onPress={copy}
          >
            <Text>{t('databases.form.copyLink')}</Text>
          </Button>
          {(['open', 'requireSignIn'] as const).map((key) => (
            <View key={key} className="flex-row items-center justify-between gap-3">
              <Text className="flex-1">{t(`databases.form.${key}`)}</Text>
              <Switch
                accessibilityLabel={t(`databases.form.${key}`)}
                value={form[key]}
                disabled={change.isPending}
                onValueChange={(value) => change.mutate({ [key]: value })}
              />
            </View>
          ))}
          {confirmDelete ? (
            <View className="gap-2">
              <Text>{t('databases.form.deleteHint')}</Text>
              <Button
                variant="destructive"
                disabled={change.isPending}
                accessibilityLabel={t('databases.form.deleteLink')}
                onPress={() => change.mutate(null, { onSuccess: () => setConfirmDelete(false) })}
              >
                <Text>{t('databases.form.deleteLink')}</Text>
              </Button>
              <Button
                variant="outline"
                disabled={change.isPending}
                accessibilityLabel={t('common.cancel')}
                onPress={() => setConfirmDelete(false)}
              >
                <Text>{t('common.cancel')}</Text>
              </Button>
            </View>
          ) : (
            <Button
              variant="outline"
              disabled={change.isPending}
              accessibilityLabel={t('databases.form.deleteLink')}
              onPress={() => setConfirmDelete(true)}
            >
              <Text>{t('databases.form.deleteLink')}</Text>
            </Button>
          )}
        </>
      ) : (
        <Button
          disabled={change.isPending}
          accessibilityLabel={t('databases.form.createLink')}
          onPress={() => change.mutate({})}
        >
          <Text>{t('databases.form.createLink')}</Text>
        </Button>
      )}
      {change.isError ? (
        <Text accessibilityRole="alert" className="text-destructive">
          {t('databases.form.saveFailed')}
        </Text>
      ) : null}
    </View>
  );
}
