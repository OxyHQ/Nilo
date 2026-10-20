import { Platform, Pressable, View } from 'react-native';
import { blockFileId } from '@oxy.so/nilo-contracts';
import { Button } from '@oxy.so/bloom/button';
import { RiUpload2Line } from '@oxy.so/bloom/icons/RiUpload2Line';
import { RiVideoLine } from '@oxy.so/bloom/icons/RiVideoLine';
import { Text } from '@oxy.so/bloom/typography';
import { useFileRemoved, useFileScope, useMediaFileUrl } from '@/lib/files/file-urls';
import { useColorScheme } from '@/lib/useColorScheme';
import type { VideoSource } from '@/lib/types/pages';
import { useTranslation } from '@/hooks/useTranslation';
import { BlockCaption, UrlPrompt } from './block-parts';
import { VideoPlayer } from './media-players';
import { useMediaUpload } from './media-upload';
import type { BlockComponentProps } from './types';

export function detectVideoSource(url: string): VideoSource {
  try {
    const u = new URL(url);
    const host = u.host.toLowerCase();
    if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'youtube';
    if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) return 'vimeo';
    if (host.endsWith('loom.com')) return 'loom';
    return 'other';
  } catch {
    return 'other';
  }
}

function youtubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    let id: string | undefined;
    if (u.host === 'youtu.be') id = u.pathname.slice(1);
    else if (u.host.endsWith('youtube.com')) id = u.searchParams.get('v') ?? undefined;
    if (!id) return null;
    return `https://www.youtube.com/embed/${id}`;
  } catch {
    return null;
  }
}

function vimeoEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    const id = u.pathname.split('/').filter(Boolean).pop();
    if (!id) return null;
    return `https://player.vimeo.com/video/${id}`;
  } catch {
    return null;
  }
}

function loomEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    const id = u.pathname.split('/').filter(Boolean).pop();
    if (!id) return null;
    return `https://www.loom.com/embed/${id}`;
  } catch {
    return null;
  }
}

/** The provider's embed for a YouTube, Vimeo or Loom link; null for anything else. */
export function videoEmbedUrl(url: string, source: string): string | null {
  switch (source || detectVideoSource(url)) {
    case 'youtube':
      return youtubeEmbed(url);
    case 'vimeo':
      return vimeoEmbed(url);
    case 'loom':
      return loomEmbed(url);
    default:
      return null;
  }
}

/**
 * Video block. A YouTube, Vimeo or Loom link plays in the provider's embed on
 * the web and opens in the browser elsewhere (no web view). An uploaded video
 * (`content.fileId`, played from a URL minted for each reader) or a link to a
 * video file plays in the native player (`expo-video`) everywhere.
 */
export function VideoBlock({ block, onChangeContent, readOnly }: BlockComponentProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const url = block.content.url ?? '';
  const fileId = blockFileId(block.content);
  const scope = useFileScope(block.pageId);
  const fileUrl = useMediaFileUrl(scope, fileId);
  const removed = useFileRemoved(scope, fileId, { fetch: false });
  const upload = useMediaUpload(block.pageId, 'video', (file) =>
    onChangeContent({
      ...block.content,
      url: '',
      fileId: file.fileId,
      name: file.name,
      source: 'upload',
    }),
  );
  const name = typeof block.content.name === 'string' ? block.content.name : '';
  const label = name || t('editor.blocks.video.label');

  if (fileId) {
    return (
      <View className="gap-1">
        {removed ? (
          <View
            className="items-center justify-center gap-2 rounded-lg bg-muted/40"
            style={{ width: '100%', aspectRatio: 16 / 9 }}
          >
            <RiVideoLine size="sm" fill={colors.mutedForeground} />
            <Text className="text-sm text-muted-foreground">
              {t('editor.blocks.video.removed')}
            </Text>
          </View>
        ) : (
          <VideoPlayer url={fileUrl} label={label} />
        )}
        <BlockCaption block={block} onChangeContent={onChangeContent} readOnly={readOnly} />
      </View>
    );
  }

  if (!url) {
    return (
      <View className="gap-2">
        <UrlPrompt
          icon={RiVideoLine}
          label={t('editor.blocks.video.label')}
          paste={t('editor.blocks.video.paste')}
          readOnly={readOnly}
          onCommit={(next) =>
            onChangeContent({ ...block.content, url: next, source: detectVideoSource(next) })
          }
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

  const source = typeof block.content.source === 'string' ? block.content.source : '';
  const embedUrl = videoEmbedUrl(url, source === 'upload' ? 'other' : source);

  return (
    <View className="gap-1">
      {embedUrl === null ? (
        <VideoPlayer url={url} label={label} />
      ) : Platform.OS === 'web' ? (
        <View style={{ aspectRatio: 16 / 9, width: '100%' }}>
          <iframe
            src={embedUrl}
            title={t('editor.blocks.video.label')}
            allowFullScreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            style={{
              border: 0,
              width: '100%',
              height: '100%',
              borderRadius: 8,
            }}
          />
        </View>
      ) : (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('editor.blocks.video.open')}
          className="rounded-lg bg-muted/60 px-3 py-3"
          onPress={() => {
            void import('expo-web-browser').then((mod) => mod.openBrowserAsync(url));
          }}
        >
          <View className="flex-row items-center gap-2">
            <RiVideoLine size="sm" fill={colors.foreground} />
            <Text variant="body-regular" numberOfLines={1}>
              {url}
            </Text>
          </View>
        </Pressable>
      )}
      <BlockCaption block={block} onChangeContent={onChangeContent} readOnly={readOnly} />
    </View>
  );
}
