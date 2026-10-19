import * as React from 'react';
import { Platform, View } from 'react-native';
import { RiUpload2Line } from '@oxy.so/bloom/icons/RiUpload2Line';
import { Button } from '@oxy.so/bloom/button';
import { Text } from '@oxy.so/bloom/typography';
import { useOxy } from '@oxy.so/services/ui/client';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import { apiErrorMessage } from '@/lib/api/error-message';
import { FileTooLargeError, type PickedFile, uploadPageFile } from '@/lib/files/upload-page-file';

interface PageImageUploadProps {
  /** The page the image is uploaded to, and whose icon or cover it becomes. */
  pageId: string;
  /** What the image is for, shown above the button. */
  hint: string;
  /** Called with the uploaded file's id once the page holds it. */
  onUploaded: (fileId: string) => void;
}

/**
 * Upload an image for a page's icon or cover through the same flow as an
 * image block (`uploadPageFile`): the file goes to Oxy as the member's own and
 * is recorded on the page, which is what lets readers of the page see it.
 */
export function PageImageUpload({ pageId, hint, onUploaded }: PageImageUploadProps) {
  const { t } = useTranslation();
  const { oxyServices } = useOxy();
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const attach = async (file: PickedFile) => {
    setBusy(true);
    setError(null);
    try {
      const attached = await uploadPageFile(oxyServices, queryClient, pageId, file);
      onUploaded(attached.fileId);
    } catch (err) {
      setError(
        err instanceof FileTooLargeError
          ? t('pages.imageUpload.tooLarge')
          : apiErrorMessage(err, t('pages.imageUpload.failed')),
      );
    } finally {
      setBusy(false);
    }
  };

  const pickNative = async () => {
    const picker = await import('expo-image-picker');
    const result = await picker.launchImageLibraryAsync({
      mediaTypes: picker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    await attach({
      uri: asset.uri,
      name: asset.fileName ?? `image-${Date.now()}.jpg`,
      type: asset.mimeType ?? 'image/jpeg',
      ...(asset.fileSize !== undefined && { size: asset.fileSize }),
    });
  };

  return (
    <View className="items-start gap-3 px-1 py-4">
      <Text variant="body-regular">{hint}</Text>
      <Button
        appearance="solid"
        tone="accent"
        onPress={() => {
          if (Platform.OS === 'web') fileInputRef.current?.click();
          else void pickNative();
        }}
        disabled={busy}
        leadingIcon={RiUpload2Line}
      >
        {busy ? t('pages.imageUpload.uploading') : t('pages.imageUpload.choose')}
      </Button>
      {Platform.OS === 'web' ? (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(ev) => {
            const file = ev.target.files?.[0];
            if (file) void attach(file);
            ev.target.value = '';
          }}
        />
      ) : null}
      {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
    </View>
  );
}
