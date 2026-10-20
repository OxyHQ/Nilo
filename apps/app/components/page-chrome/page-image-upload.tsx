import { View } from 'react-native';
import { RiUpload2Line } from '@oxy.so/bloom/icons/RiUpload2Line';
import { Button } from '@oxy.so/bloom/button';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { apiErrorMessage } from '@/lib/api/error-message';
import { FileTooLargeError } from '@/lib/files/upload-page-file';
import { useMediaUpload } from '@/components/editor/blocks/media-upload';

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
 * image block (`useMediaUpload`): the file goes to Oxy as the member's own and
 * is recorded on the page, which is what lets readers of the page see it.
 */
export function PageImageUpload({ pageId, hint, onUploaded }: PageImageUploadProps) {
  const { t } = useTranslation();
  const upload = useMediaUpload(
    pageId,
    'image',
    (attached) => onUploaded(attached.fileId),
    (err) =>
      err instanceof FileTooLargeError
        ? t('pages.imageUpload.tooLarge')
        : apiErrorMessage(err, t('pages.imageUpload.failed')),
  );

  return (
    <View className="items-start gap-3 px-1 py-4">
      <Text variant="body-regular">{hint}</Text>
      <Button
        appearance="solid"
        tone="accent"
        onPress={upload.choose}
        disabled={upload.busy}
        leadingIcon={RiUpload2Line}
      >
        {upload.busy ? t('pages.imageUpload.uploading') : t('pages.imageUpload.choose')}
      </Button>
      {upload.input}
      {upload.error ? <Text className="text-sm text-destructive">{upload.error}</Text> : null}
    </View>
  );
}
