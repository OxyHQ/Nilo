import { apiErrorMessage } from '@/lib/api/error-message';
import { useCreateDatabase } from '@/lib/hooks/use-databases';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
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
  const create = useCreatePage();
  const duplicate = useDuplicatePage();
  const database = useCreateDatabase();
  const [importOpen, setImportOpen] = useState(false);
  const [csvOnly, setCsvOnly] = useState(false);
  const [templates, setTemplates] = useState(false);
  const pending = create.isPending || duplicate.isPending || database.isPending;
  const created = (page: { id: string }) => {
    close();
    router.push(`/p/${page.id}`);
  };
  if (importOpen) return <ImportPagesDialog {...destination} csvOnly={csvOnly} onClose={close} />;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) close();
      }}
    >
      <DialogContent
        role="dialog"
        accessibilityLabel={t(templates ? 'pages.templates.choose' : 'pages.templates.newPage')}
        className="max-w-md gap-3 p-4"
        showCloseButton={false}
      >
        <View className="flex-row items-center justify-between">
          <DialogTitle accessibilityRole="header">
            {t(templates ? 'pages.templates.choose' : 'pages.templates.newPage')}
          </DialogTitle>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            disabled={pending}
            onPress={close}
            className="rounded-md px-2 py-2 hover:bg-muted"
          >
            <Text className="text-sm text-muted-foreground">{t('common.close')}</Text>
          </Pressable>
        </View>
        {templates ? (
          <ScrollView className="max-h-80" keyboardShouldPersistTaps="handled">
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
          </ScrollView>
        ) : (
          <View className="gap-2">
            {destination.parentId === null ? (
              <Button
                variant="outline"
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
                        close();
                        router.push(`/db/${createdDatabase.id}`);
                      },
                    },
                  )
                }
              >
                <Text>{t('workspace.teamspaces.newDatabase')}</Text>
              </Button>
            ) : null}
            <Button
              variant="outline"
              accessibilityLabel={t('databases.csv.import')}
              disabled={pending}
              onPress={() => {
                setCsvOnly(true);
                setImportOpen(true);
              }}
            >
              <Text>{t('databases.csv.import')}</Text>
            </Button>
            <Button
              variant="outline"
              accessibilityLabel={t('pages.import.title')}
              disabled={pending}
              onPress={() => setImportOpen(true)}
            >
              <Text>{t('pages.import.title')}</Text>
            </Button>
            <Button
              accessibilityLabel={t('pages.templates.blank')}
              disabled={pending}
              onPress={() => create.mutate({ ...destination, title: '' }, { onSuccess: created })}
            >
              <Text>{t('pages.templates.blank')}</Text>
            </Button>
            <Button
              variant="outline"
              accessibilityLabel={t('pages.templates.fromTemplate')}
              disabled={pending}
              onPress={() => setTemplates(true)}
            >
              <Text>{t('pages.templates.fromTemplate')}</Text>
            </Button>
          </View>
        )}
        {pending ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-muted-foreground">
            {t('pages.templates.creating')}
          </Text>
        ) : null}
        {create.isError || duplicate.isError || database.isError ? (
          <Text accessibilityRole="alert" className="text-sm text-destructive">
            {apiErrorMessage(
              create.error ?? duplicate.error ?? database.error,
              t('pages.templates.createFailed'),
            )}
          </Text>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
