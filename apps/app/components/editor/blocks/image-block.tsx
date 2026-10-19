import * as React from 'react';
import { Platform, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { blockFileId } from '@oxy.so/nilo-contracts';
import { Button } from '@oxy.so/bloom/button';
import { RiImageLine } from '@oxy.so/bloom/icons/RiImageLine';
import { RiUpload2Line } from '@oxy.so/bloom/icons/RiUpload2Line';
import { Text } from '@oxy.so/bloom/typography';
import { useOxy } from '@oxy.so/services/ui/client';
import { useQueryClient } from '@tanstack/react-query';
import { useFileImageSource, useFileRemoved, useFileScope } from '@/lib/files/file-urls';
import { type PickedFile, uploadPageFile } from '@/lib/files/upload-page-file';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { BlockCaption, UrlPrompt } from './block-parts';
import { type BlockComponentProps, blockUrl } from './types';

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
export function ImageBlock({ block, onChangeContent, readOnly }: BlockComponentProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const { oxyServices } = useOxy();
  const queryClient = useQueryClient();
  const fileId = blockFileId(block.content);
  const scope = useFileScope(block.pageId);
  const fileSource = useFileImageSource(scope, fileId);
  const removed = useFileRemoved(scope, fileId);
  const pastedUrl = blockUrl(block.content.url);
  const url = fileId ? (fileSource?.uri ?? null) : pastedUrl;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const attach = async (file: PickedFile) => {
    setBusy(true);
    setError(null);
    try {
      const attached = await uploadPageFile(oxyServices, queryClient, block.pageId, file);
      onChangeContent({ ...block.content, url: '', fileId: attached.fileId });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('editor.blocks.uploadFailed'));
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
  // One Oxy removed (deleted, trashed by its owner, taken down) says so.
  if (fileId && !url) {
    return (
      <View
        className="items-center justify-center gap-2 rounded-lg bg-muted/40"
        style={{ width: '100%', aspectRatio: 16 / 9 }}
        accessibilityLabel={typeof block.content.alt === 'string' ? block.content.alt : undefined}
      >
        {removed ? (
          <>
            <RiImageLine size="sm" fill={colors.mutedForeground} />
            <Text className="text-sm text-muted-foreground">
              {t('editor.blocks.image.removed')}
            </Text>
          </>
        ) : null}
      </View>
    );
  }

  if (!url) {
    return (
      <View className="gap-2">
        <UrlPrompt
          icon={RiImageLine}
          label={t('editor.blocks.image.label')}
          paste={t('editor.blocks.image.paste')}
          readOnly={readOnly}
          onCommit={(next) => onChangeContent({ ...block.content, url: next })}
        >
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
            {busy ? t('editor.blocks.uploading') : t('editor.blocks.upload')}
          </Button>
        </UrlPrompt>
        {Platform.OS === 'web' && !readOnly ? (
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
      <BlockCaption block={block} onChangeContent={onChangeContent} readOnly={readOnly} />
    </View>
  );
}
