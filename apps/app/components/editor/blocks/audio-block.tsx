import { Platform, Pressable, View } from 'react-native';
import { RiMusic2Line } from '@oxy.so/bloom/icons/RiMusic2Line';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import { BlockCaption, UrlPrompt } from './block-parts';
import { type BlockComponentProps, blockUrl } from './types';

/**
 * Audio block — accepts a URL (paste or upload) and renders a player.
 * On web we use the standard <audio> element; on native we link out to the
 * URL. Nilo stores the block and opens native audio in the system browser;
 * it does not request microphone or background-audio permissions.
 */
export function AudioBlock({ block, onChangeContent, readOnly }: BlockComponentProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const url = blockUrl(block.content.url);

  if (!url) {
    return (
      <UrlPrompt
        icon={RiMusic2Line}
        label={t('editor.blocks.audio.label')}
        paste={t('editor.blocks.audio.paste')}
        readOnly={readOnly}
        onCommit={(next) => onChangeContent({ ...block.content, url: next })}
      />
    );
  }

  return (
    <View className="gap-1">
      {Platform.OS === 'web' ? (
        // biome-ignore lint/a11y/useMediaCaption: user-uploaded audio; the block model has no caption track to attach
        <audio controls src={url} style={{ width: '100%' }} />
      ) : (
        <Pressable
          className="flex-row items-center gap-2 rounded-lg bg-muted/60 px-3 py-2"
          onPress={() => {
            import('expo-web-browser').then((mod) => mod.openBrowserAsync(url));
          }}
        >
          <RiMusic2Line width={14} height={14} fill={colors.foreground} />
          <Text variant="body-regular">{url}</Text>
        </Pressable>
      )}
      <BlockCaption block={block} onChangeContent={onChangeContent} readOnly={readOnly} />
    </View>
  );
}
