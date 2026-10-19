import { Platform, Pressable, View } from 'react-native';
import { RiVideoLine } from '@oxy.so/bloom/icons/RiVideoLine';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import type { VideoSource } from '@/lib/types/pages';
import { useTranslation } from '@/hooks/useTranslation';
import { BlockCaption, UrlPrompt } from './block-parts';
import { type BlockComponentProps, blockUrl } from './types';

function detectVideoSource(url: string): VideoSource {
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

/**
 * Video block. Detects YouTube / Vimeo / Loom URLs and renders the standard
 * embed iframe. Uploaded video URLs (source='upload') render via a native
 * `<video>` element on web; on native we link out (RN doesn't ship a built-in
 * `<video>` widget — apps that need playback wire in `expo-av` separately).
 */
export function VideoBlock({ block, onChangeContent, readOnly }: BlockComponentProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const url = blockUrl(block.content.url);

  if (!url) {
    return (
      <UrlPrompt
        icon={RiVideoLine}
        label={t('editor.blocks.video.label')}
        paste={t('editor.blocks.video.paste')}
        readOnly={readOnly}
        onCommit={(next) =>
          onChangeContent({ ...block.content, url: next, source: detectVideoSource(next) })
        }
      />
    );
  }

  const source =
    (typeof block.content.source === 'string' ? block.content.source : '') ||
    detectVideoSource(url);
  const embedUrl =
    source === 'youtube'
      ? youtubeEmbed(url)
      : source === 'vimeo'
        ? vimeoEmbed(url)
        : source === 'loom'
          ? loomEmbed(url)
          : null;

  return (
    <View className="gap-1">
      {Platform.OS === 'web' ? (
        embedUrl ? (
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
          // biome-ignore lint/a11y/useMediaCaption: user-uploaded video; the block model has no caption track to attach
          <video src={url} controls style={{ width: '100%', borderRadius: 8 }} />
        )
      ) : (
        <Pressable
          accessibilityLabel={t('editor.blocks.video.label')}
          className="rounded-lg bg-muted/60 px-3 py-3"
          onPress={() => {
            if (Platform.OS !== 'web') {
              import('expo-web-browser').then((mod) => mod.openBrowserAsync(url));
            }
          }}
        >
          <View className="flex-row items-center gap-2">
            <RiVideoLine size="sm" fill={colors.foreground} />
            <Text variant="body-regular">{url}</Text>
          </View>
        </Pressable>
      )}
      <BlockCaption block={block} onChangeContent={onChangeContent} readOnly={readOnly} />
    </View>
  );
}
