import { apiErrorMessage } from '@/lib/api/error-message';
import { useCreateDatabase } from '@/lib/hooks/use-databases';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useCreatePage, useDuplicatePage } from '@/lib/hooks/use-pages';
import { useNewPageStore, type NewPageDestination } from '@/lib/stores/new-page-store';
import { ImportPagesDialog } from '@/components/page-chrome/import-pages-dialog';
import { TemplateList } from './template-list';

export function NewPageDialog() {
  const destination = useNewPageStore((s) => s.destination);
  if (!destination) return null;
  return (
    <PageChoices
      key={`${destination.workspaceId}:${destination.parentId}:${destination.teamspaceId}`}
      destination={destination}
    />
  );
}

function PageChoices({ destination }: { destination: NewPageDestination }) {
  const { t } = useTranslation();
  const router = useRouter();
  const close = useNewPageStore((s) => s.close);
  const control = useDialogControl();
  const create = useCreatePage();
  const duplicate = useDuplicatePage();
  const database = useCreateDatabase();
  const [importOpen, setImportOpen] = useState(false);
  const [csvOnly, setCsvOnly] = useState(false);
  const [templates, setTemplates] = useState(false);
  const pending = create.isPending || duplicate.isPending || database.isPending;
  // Mounted only while the store holds a destination: open as it mounts, and
  // clear the destination once the dialog has animated out.
  useEffect(() => {
    control.open();
  }, [control]);
  const created = (page: { id: string }) => {
    control.close();
    router.push(`/p/${page.id}`);
  };
  if (importOpen) return <ImportPagesDialog {...destination} csvOnly={csvOnly} onClose={close} />;
  const title = t(templates ? 'pages.templates.choose' : 'pages.templates.newPage');
  return (
    <Dialog
      control={control}
      onClose={close}
      placement={{ base: 'bottom', md: 'center' }}
      dismissOnBackdrop={!pending}
      title={title}
      label={title}
      actions={[{ label: t('common.close'), color: 'cancel', disabled: pending }]}
    >
      {templates ? (
        <TemplateList
          workspaceId={destination.workspaceId}
          pending={pending}
          onUse={(page) =>
            duplicate.mutate(
              { id: page.id, ...destination, fromTemplate: true },
              { onSuccess: created },
            )
          }
        />
      ) : (
        <View className="gap-2">
          {destination.parentId === null ? (
            <Button
              appearance="outline"
              disabled={pending}
              accessibilityLabel={t('workspace.teamspaces.newDatabase')}
              onPress={() =>
                database.mutate(
                  {
                    workspaceId: destination.workspaceId,
                    teamspaceId: destination.teamspaceId,
                    parentPageId: destination.parentId,
                    name: t('workspace.teamspaces.newDatabase'),
                  },
                  {
                    onSuccess: ({ database: createdDatabase }) => {
                      control.close();
                      router.push(`/db/${createdDatabase.id}`);
                    },
                  },
                )
              }
            >
              {t('workspace.teamspaces.newDatabase')}
            </Button>
          ) : null}
          <Button
            appearance="outline"
            accessibilityLabel={t('databases.csv.import')}
            disabled={pending}
            onPress={() => {
              setCsvOnly(true);
              setImportOpen(true);
            }}
          >
            {t('databases.csv.import')}
          </Button>
          <Button
            appearance="outline"
            accessibilityLabel={t('pages.import.title')}
            disabled={pending}
            onPress={() => setImportOpen(true)}
          >
            {t('pages.import.title')}
          </Button>
          <Button
            accessibilityLabel={t('pages.templates.blank')}
            disabled={pending}
            onPress={() => create.mutate({ ...destination, title: '' }, { onSuccess: created })}
          >
            {t('pages.templates.blank')}
          </Button>
          <Button
            appearance="outline"
            accessibilityLabel={t('pages.templates.fromTemplate')}
            disabled={pending}
            onPress={() => setTemplates(true)}
          >
            {t('pages.templates.fromTemplate')}
          </Button>
        </View>
      )}
      {pending ? (
        <Text accessibilityLiveRegion="polite" className="mt-3 text-sm text-muted-foreground">
          {t('pages.templates.creating')}
        </Text>
      ) : null}
      {create.isError || duplicate.isError || database.isError ? (
        <Text accessibilityRole="alert" className="mt-3 text-sm text-destructive">
          {apiErrorMessage(
            create.error ?? duplicate.error ?? database.error,
            t('pages.templates.createFailed'),
          )}
        </Text>
      ) : null}
    </Dialog>
  );
}
