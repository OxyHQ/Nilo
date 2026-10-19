import { View } from 'react-native';
import { blockFileId } from '@oxy.so/nilo-contracts';
import { Button } from '@oxy.so/bloom/button';
import { RiMusic2Line } from '@oxy.so/bloom/icons/RiMusic2Line';
import { RiUpload2Line } from '@oxy.so/bloom/icons/RiUpload2Line';
import { Text } from '@oxy.so/bloom/typography';
import { useFileRemoved, useFileScope, useMediaFileUrl } from '@/lib/files/file-urls';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import { BlockCaption, UrlPrompt } from './block-parts';
import { AudioPlayer } from './media-players';
import { useMediaUpload } from './media-upload';
import { type BlockComponentProps, blockUrl } from './types';

/** The last part of a link's path, as a name for the sound it points at. */
function nameFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
  } catch {
    return '';
  }
}

/**
 * Audio block — a sound uploaded to the page (`content.fileId`, played from
 * a URL minted for each reader) or a link to one, played by the native player
 * (`expo-audio`) on every platform. Nilo only plays: it asks for no
 * microphone or background-audio permission.
 */
export function AudioBlock({ block, onChangeContent, readOnly }: BlockComponentProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const url = blockUrl(block.content.url);
  const fileId = blockFileId(block.content);
  const scope = useFileScope(block.pageId);
  const fileUrl = useMediaFileUrl(scope, fileId);
  const removed = useFileRemoved(scope, fileId, { fetch: false });
  const upload = useMediaUpload(block.pageId, 'audio', (file) =>
    onChangeContent({ ...block.content, url: '', fileId: file.fileId, name: file.name }),
  );
  const name = typeof block.content.name === 'string' ? block.content.name : '';
  const title = name || (url ? nameFromUrl(url) : '') || t('editor.blocks.audio.label');

  if (!url && !fileId) {
    return (
      <View className="gap-2">
        <UrlPrompt
          icon={RiMusic2Line}
          label={t('editor.blocks.audio.label')}
          paste={t('editor.blocks.audio.paste')}
          readOnly={readOnly}
          onCommit={(next) => onChangeContent({ ...block.content, url: next })}
        >
          <Button
            appearance="solid"
            tone="accent"
            size="md"
            onPress={upload.choose}
            disabled={upload.busy}
            leadingIcon={RiUpload2Line}
          >
            {upload.busy ? t('editor.blocks.uploading') : t('editor.blocks.upload')}
          </Button>
        </UrlPrompt>
        {readOnly ? null : upload.input}
        {upload.error ? <Text className="text-xs text-destructive">{upload.error}</Text> : null}
      </View>
    );
  }

  return (
    <View className="gap-1">
      {fileId && removed ? (
        <View className="flex-row items-center gap-2 rounded-lg bg-muted/40 px-3 py-3">
          <RiMusic2Line width={14} height={14} fill={colors.mutedForeground} />
          <Text className="text-sm text-muted-foreground">{t('editor.blocks.audio.removed')}</Text>
        </View>
      ) : (
        <AudioPlayer url={fileId ? fileUrl : url} title={title} />
      )}
      <BlockCaption block={block} onChangeContent={onChangeContent} readOnly={readOnly} />
    </View>
  );
}
