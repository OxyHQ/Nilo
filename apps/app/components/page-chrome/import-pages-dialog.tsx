import { apiErrorMessage } from '@/lib/api/error-message';
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import axios from 'axios';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, type DialogAction, useDialogControl } from '@oxy.so/bloom/dialog';
import { Loading } from '@oxy.so/bloom/loading';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useImportPages } from '@/lib/hooks/use-page-transfer';

export function ImportPagesDialog({
  workspaceId,
  parentId,
  teamspaceId,
  onClose,
  csvOnly = false,
}: {
  workspaceId: string;
  parentId?: string | null;
  teamspaceId?: string | null;
  onClose: () => void;
  csvOnly?: boolean;
}) {
  const { t } = useTranslation();
  const control = useDialogControl();
  const router = useRouter();
  const mutation = useImportPages();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const result = mutation.data;
  const first = result?.pages[0];
  const title = t(
    csvOnly ? 'databases.csv.import' : parentId ? 'pages.import.intoPage' : 'pages.import.title',
  );

  const pick = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErrorKey(null);
    setProgress(null);
    mutation.reset();
    try {
      const selection = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: !csvOnly,
        copyToCacheDirectory: true,
      });
      if (selection.canceled) return;
      if (csvOnly && !/\.csv$/i.test(selection.assets[0].name)) throw new Error('invalidFiles');
      const imported = await mutation.mutateAsync({
        workspaceId,
        parentId,
        teamspaceId,
        assets: selection.assets,
        onProgress: setProgress,
      });
      if (imported.database) {
        const id = imported.database.id;
        control.close(() => router.push(`/db/${id}`));
      }
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const reason = error instanceof Error ? error.message : '';
      setErrorKey(
        status === 413 || reason === 'tooLarge'
          ? 'tooLarge'
          : status === 403
            ? 'noAccess'
            : status === 400
              ? 'invalidContent'
              : reason === 'invalidFiles'
                ? 'invalidFiles'
                : 'failed',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const actions: DialogAction[] = [
    { label: t('common.close'), color: 'cancel', disabled: busy },
    ...(!result
      ? [
          {
            label: t('pages.import.chooseFiles'),
            disabled: busy,
            shouldCloseOnPress: false,
            onPress: () => void pick(),
          } satisfies DialogAction,
        ]
      : []),
  ];

  return (
    <Dialog
      control={control}
      startOpen
      onClose={onClose}
      dismissOnBackdrop={!busy}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={512}
      label={title}
      title={title}
      actions={actions}
    >
      <View className="gap-4">
        <Text className="text-sm text-muted-foreground">{t('pages.import.description')}</Text>
        <Text className="text-sm text-muted-foreground">{t('pages.import.csvHint')}</Text>
        {busy ? (
          <View className="flex-row items-center gap-2" accessibilityRole="progressbar">
            <Loading variant="inline" size="sm" />
            <Text accessibilityLiveRegion="polite" className="text-sm text-muted-foreground">
              {t(
                progress === null
                  ? 'pages.import.reading'
                  : progress === 100
                    ? 'pages.import.processing'
                    : 'pages.import.uploading',
                { percent: progress },
              )}
            </Text>
          </View>
        ) : null}
        {errorKey ? (
          <Text accessibilityRole="alert" className="text-sm text-destructive">
            {apiErrorMessage(mutation.error, t(`pages.import.${errorKey}`))}
          </Text>
        ) : null}
        {result ? (
          <View className="gap-3">
            <Text variant="headline-regular" accessibilityLiveRegion="polite">
              {t('pages.import.result', { count: result.pages.length })}
            </Text>
            {result.skipped.length > 0 ? (
              <>
                <Text className="text-sm text-muted-foreground">
                  {t('pages.import.skipped', { count: result.skipped.length })}
                </Text>
                <ScrollView className="max-h-40" keyboardShouldPersistTaps="handled">
                  {result.skipped.map((path) => (
                    <Text key={path} className="text-sm text-muted-foreground">
                      {path}
                    </Text>
                  ))}
                </ScrollView>
              </>
            ) : null}
            {first ? (
              <Button
                appearance="solid"
                tone="accent"
                accessibilityRole="link"
                accessibilityLabel={t('pages.import.openFirst')}
                onPress={() => control.close(() => router.push(`/p/${first.id}`))}
              >
                {t('pages.import.openFirst')}
              </Button>
            ) : null}
          </View>
        ) : null}
      </View>
    </Dialog>
  );
}
