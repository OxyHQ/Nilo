import * as React from 'react';
import { Platform, TextInput, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { blockFileId } from '@oxy.so/nilo-contracts';
import { Button } from '@oxy.so/bloom/button';
import { RiImageLine } from '@oxy.so/bloom/icons/RiImageLine';
import { RiUpload2Line } from '@oxy.so/bloom/icons/RiUpload2Line';
import { TextField, TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useOxy } from '@oxy.so/services';
import { useQueryClient } from '@tanstack/react-query';
import { useFileImageSource, useFileScope } from '@/lib/files/file-urls';
import { type PickedFile, uploadPageFile } from '@/lib/files/upload-page-file';
import { useColorScheme } from '@/lib/useColorScheme';
import type { BlockComponentProps } from './types';

/**
 * Image block — renders a captioned image. Empty state offers two paths:
 *   1) Paste a URL into the URL field (`content.url`).
 *   2) Upload a picture: it goes to Oxy's file manager as the member's own
 *      file, attached to this page (`lib/files`), and the block keeps its id
 *      (`content.fileId`); the URL it is shown with is minted per reader.
 *
 * Cross-platform note: web uses a `<input type=file>` (hidden) since RN doesn't
 * expose one. Native picks via `expo-image-picker` (dynamic import so the web
 * bundle doesn't include native-only deps).
 */
export function ImageBlock({ block, onChangeContent }: BlockComponentProps) {
  const { colors } = useColorScheme();
  const { oxyServices } = useOxy();
  const queryClient = useQueryClient();
  const fileId = blockFileId(block.content);
  const fileSource = useFileImageSource(useFileScope(block.pageId), fileId);
  const pastedUrl = typeof block.content.url === 'string' ? block.content.url : '';
  const url = fileId ? (fileSource?.uri ?? null) : pastedUrl;
  const caption = typeof block.content.caption === 'string' ? block.content.caption : '';
  const [urlDraft, setUrlDraft] = React.useState(pastedUrl);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Reset the input when the block changes identity (e.g. fresh remount).
  const lastBlockId = React.useRef(block.id);
  if (lastBlockId.current !== block.id) {
    lastBlockId.current = block.id;
    setUrlDraft(pastedUrl);
  }

  const commitUrl = (next: string) => {
    onChangeContent({ ...block.content, url: next.trim() });
  };
  const commitCaption = (next: string) => {
    onChangeContent({ ...block.content, caption: next });
  };

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const attach = async (file: PickedFile) => {
    setBusy(true);
    setError(null);
    try {
      const attached = await uploadPageFile(oxyServices, queryClient, block.pageId, file);
      onChangeContent({ ...block.content, url: '', fileId: attached.fileId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const handleNativeUpload = async () => {
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

  // An attachment whose URL has not arrived yet: its place, not the picker.
  if (fileId && !url) {
    return (
      <View
        className="rounded-lg bg-muted/40"
        style={{ width: '100%', aspectRatio: 16 / 9 }}
        accessibilityLabel={typeof block.content.alt === 'string' ? block.content.alt : undefined}
      />
    );
  }

  if (!url) {
    return (
      <View className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4 gap-3">
        <View className="flex-row items-center gap-2">
          <RiImageLine size="sm" fill={colors.mutedForeground} />
          <Text className="text-sm text-muted-foreground">Image</Text>
        </View>
        <View className="flex-row items-center gap-2">
          <TextField className="flex-1">
            <TextFieldInput
              label="Paste image URL"
              value={urlDraft}
              onChangeText={setUrlDraft}
              onBlur={() => commitUrl(urlDraft)}
              placeholder="Paste image URL"
            />
          </TextField>
          <Button
            appearance="solid"
            tone="accent"
            size="md"
            onPress={() => {
              if (Platform.OS === 'web') {
                fileInputRef.current?.click();
              } else {
                void handleNativeUpload();
              }
            }}
            disabled={busy}
            leadingIcon={RiUpload2Line}
          >
            {busy ? 'Uploading…' : 'Upload'}
          </Button>
        </View>
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
        {error ? <Text className="text-xs text-destructive">{error}</Text> : null}
      </View>
    );
  }

  return (
    <View className="gap-1">
      <ExpoImage
        // An attachment's URL changes every few minutes; its id names it in the cache.
        source={fileSource ?? { uri: url }}
        style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 8 }}
        contentFit="contain"
        transition={150}
        accessibilityLabel={typeof block.content.alt === 'string' ? block.content.alt : undefined}
      />
      <TextInput
        value={caption}
        onChangeText={commitCaption}
        placeholder="Write a caption…"
        placeholderTextColor={colors.mutedForeground}
        className="text-xs text-muted-foreground py-1"
      />
    </View>
  );
}
