import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { blockFileId } from '@oxy.so/nilo-contracts';
import { Button } from '@oxy.so/bloom/button';
import { RiFileLine } from '@oxy.so/bloom/icons/RiFileLine';
import { RiUpload2Line } from '@oxy.so/bloom/icons/RiUpload2Line';
import { Text } from '@oxy.so/bloom/typography';
import { useQueryClient } from '@tanstack/react-query';
import { freshFileUrl, isFileRemoved, useFileRemoved, useFileScope } from '@/lib/files/file-urls';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import { useMediaUpload } from './media-upload';
import type { BlockComponentProps } from './types';

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Generic file block. An empty one offers an upload: it goes to Oxy's file
 * manager as the member's own file, attached to this page
 * (`useMediaUpload`). Once it holds a file, it is `FileView`'s to draw.
 */
export function FileBlock(props: BlockComponentProps) {
  const { block, onChangeContent, readOnly } = props;
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const upload = useMediaUpload(block.pageId, 'file', (attached) =>
    onChangeContent({
      ...block.content,
      url: '',
      fileId: attached.fileId,
      name: attached.name,
      size: attached.size,
      mimeType: attached.mimeType,
    }),
  );

  if (blockFileId(block.content) || block.content.url) return <FileView {...props} />;
  return (
    <View className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4 gap-3">
      <View className="flex-row items-center gap-2">
        <RiFileLine size="sm" fill={colors.mutedForeground} />
        <Text className="text-sm text-muted-foreground">{t('editor.blocks.file.label')}</Text>
      </View>
      {readOnly ? null : (
        <Button
          appearance="solid"
          tone="accent"
          size="sm"
          className="self-start"
          onPress={upload.choose}
          disabled={upload.busy}
          leadingIcon={RiUpload2Line}
        >
          {upload.busy ? t('editor.blocks.uploading') : t('editor.blocks.file.choose')}
        </Button>
      )}
      {readOnly ? null : upload.input}
      {upload.error ? <Text className="text-xs text-destructive">{upload.error}</Text> : null}
    </View>
  );
}

/**
 * A file block as it is shown: a download pill. Pressing it asks for a URL
 * that works now and opens it (web: new tab; native: in-app browser). With no
 * file it draws nothing: a shared page shows it as it is, without the
 * editor's upload (`FileBlock`).
 */
export function FileView({ block }: BlockComponentProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const queryClient = useQueryClient();
  const scope = useFileScope(block.pageId);
  const fileId = blockFileId(block.content);
  // A file's URL is asked for only when the pill is pressed: this only listens.
  const removed = useFileRemoved(scope, fileId, { fetch: false });
  const url = block.content.url ?? '';
  const name = typeof block.content.name === 'string' ? block.content.name : '';
  const size = typeof block.content.size === 'number' ? block.content.size : 0;
  const [error, setError] = React.useState<string | null>(null);

  /** Open the file: a pasted URL as it is, an attachment through a URL minted now. */
  const open = async () => {
    setError(null);
    try {
      const target = fileId && scope ? await freshFileUrl(queryClient, scope, fileId) : url;
      if (!target) {
        setError(
          fileId && scope && isFileRemoved(queryClient, scope, fileId)
            ? t('editor.blocks.file.removed')
            : t('editor.blocks.file.unavailable'),
        );
        return;
      }
      if (Platform.OS === 'web') window.open(target, '_blank', 'noopener,noreferrer');
      else await (await import('expo-web-browser')).openBrowserAsync(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('editor.blocks.file.unavailable'));
    }
  };

  if (!url && !fileId) return null;
  const sizeLabel = formatBytes(size);
  const displayName = name || url.split('/').pop() || 'file';

  return (
    <View className="gap-1">
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={displayName}
        onPress={() => void open()}
        className="flex-row items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
      >
        <RiFileLine width={18} height={18} fill={colors.foreground} />
        <View className="flex-1">
          <Text variant="body-regular">{displayName}</Text>
          {sizeLabel ? <Text className="text-xs text-muted-foreground">{sizeLabel}</Text> : null}
        </View>
      </Pressable>
      {error ? (
        <Text className="text-xs text-destructive">{error}</Text>
      ) : removed ? (
        <Text className="text-xs text-muted-foreground">{t('editor.blocks.file.removed')}</Text>
      ) : null}
    </View>
  );
}
