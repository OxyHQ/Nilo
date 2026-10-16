import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { RiFileTextLine } from '@oxy.so/bloom/icons/RiFileTextLine';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import type { BlockComponentProps } from './types';

/**
 * PDF block — embeds the PDF in an iframe on web, links out on native.
 * Falls back to a download pill if the iframe load fails (we can't tell
 * from JS whether the iframe succeeded, so we always show a small "Open in
 * new tab" link alongside it).
 */
export function PdfBlock({ block, onChangeContent }: BlockComponentProps) {
  const { colors } = useColorScheme();
  const url = typeof block.content.url === 'string' ? block.content.url : '';
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
          <RiFileTextLine size="sm" fill={colors.mutedForeground} />
          <Text className="text-sm text-muted-foreground">PDF</Text>
        </View>
        <TextFieldInput
          label="Paste PDF URL"
          value={urlDraft}
          onChangeText={setUrlDraft}
          onBlur={() => onChangeContent({ ...block.content, url: urlDraft.trim() })}
          placeholder="Paste PDF URL"
        />
      </View>
    );
  }

  if (Platform.OS === 'web') {
    return (
      <View className="gap-1">
        <View style={{ width: '100%', aspectRatio: 4 / 5 }}>
          <iframe
            src={url}
            title="PDF preview"
            style={{
              border: 0,
              width: '100%',
              height: '100%',
              borderRadius: 8,
            }}
          />
        </View>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12 }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open in new tab
        </a>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => import('expo-web-browser').then((mod) => mod.openBrowserAsync(url))}
      className="flex-row items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
    >
      <RiFileTextLine width={18} height={18} fill={colors.foreground} />
      <Text variant="body-regular">Open PDF</Text>
    </Pressable>
  );
}
