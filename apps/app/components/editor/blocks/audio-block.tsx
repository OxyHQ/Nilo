import * as React from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { RiMusic2Line } from '@oxy.so/bloom/icons/RiMusic2Line';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import type { BlockComponentProps } from './types';

/**
 * Audio block — accepts a URL (paste or upload) and renders a player.
 * On web we use the standard <audio> element; on native we link out to the
 * URL. Nilo stores the block and opens native audio in the system browser;
 * it does not request microphone or background-audio permissions.
 */
export function AudioBlock({ block, onChangeContent }: BlockComponentProps) {
  const { colors } = useColorScheme();
  const url = typeof block.content.url === 'string' ? block.content.url : '';
  const caption = typeof block.content.caption === 'string' ? block.content.caption : '';
  const [urlDraft, setUrlDraft] = React.useState(url);
  const lastBlockId = React.useRef(block.id);
  if (lastBlockId.current !== block.id) {
    lastBlockId.current = block.id;
    setUrlDraft(url);
  }

  if (!url) {
    return (
      <View className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4 gap-3">
        <View className="flex-row items-center gap-2">
          <RiMusic2Line size="sm" fill={colors.mutedForeground} />
          <Text className="text-sm text-muted-foreground">Audio</Text>
        </View>
        <TextFieldInput
          label="Paste audio URL"
          value={urlDraft}
          onChangeText={setUrlDraft}
          onBlur={() => onChangeContent({ ...block.content, url: urlDraft.trim() })}
          placeholder="Paste audio URL"
        />
      </View>
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
      <TextInput
        value={caption}
        onChangeText={(t) => onChangeContent({ ...block.content, caption: t })}
        placeholder="Write a caption…"
        placeholderTextColor={colors.mutedForeground}
        className="text-xs text-muted-foreground py-1"
      />
    </View>
  );
}
