import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { blockFileId } from '@nilo/contracts';
import { Button } from '@oxy.so/bloom/button';
import { RiFileLine } from '@oxy.so/bloom/icons/RiFileLine';
import { RiUpload2Line } from '@oxy.so/bloom/icons/RiUpload2Line';
import { Text } from '@oxy.so/bloom/typography';
import { useOxy } from '@oxy.so/services';
import { useQueryClient } from '@tanstack/react-query';
import { freshFileUrl, useFileScope } from '@/lib/files/file-urls';
import { type PickedFile, uploadPageFile } from '@/lib/files/upload-page-file';
import { useColorScheme } from '@/lib/useColorScheme';
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
 * Generic file block — surfaces a download pill once a file is attached.
 * An upload goes to Oxy's file manager as the member's own file, attached to
 * this page (`lib/files`); pressing the pill asks for a URL that works now
 * and opens it (web: new tab; native: in-app browser).
 */
export function FileBlock({ block, onChangeContent }: BlockComponentProps) {
  const { colors } = useColorScheme();
  const { oxyServices } = useOxy();
  const queryClient = useQueryClient();
  const scope = useFileScope(block.pageId);
  const fileId = blockFileId(block.content);
  const url = typeof block.content.url === 'string' ? block.content.url : '';
  const name = typeof block.content.name === 'string' ? block.content.name : '';
  const size = typeof block.content.size === 'number' ? block.content.size : 0;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const attach = async (file: PickedFile) => {
    setBusy(true);
    setError(null);
    try {
      const attached = await uploadPageFile(oxyServices, queryClient, block.pageId, file);
      onChangeContent({
        ...block.content,
        url: '',
        fileId: attached.fileId,
        name: attached.name,
        size: attached.size,
        mimeType: attached.mimeType,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const handleNativeUpload = async () => {
    const picker = await import('expo-document-picker');
    const result = await picker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    await attach({
      uri: asset.uri,
      name: asset.name ?? `file-${Date.now()}`,
      type: asset.mimeType ?? 'application/octet-stream',
      ...(asset.size !== undefined && { size: asset.size }),
    });
  };

  /** Open the file: a pasted URL as it is, an attachment through a URL minted now. */
  const open = async () => {
    setError(null);
    try {
      const target = fileId && scope ? await freshFileUrl(queryClient, scope, fileId) : url;
      if (!target) {
        setError('This file is unavailable');
        return;
      }
      if (Platform.OS === 'web') window.open(target, '_blank', 'noopener,noreferrer');
      else await (await import('expo-web-browser')).openBrowserAsync(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This file is unavailable');
    }
  };

  if (!url && !fileId) {
    return (
      <View className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4 gap-3">
        <View className="flex-row items-center gap-2">
          <RiFileLine size="sm" fill={colors.mutedForeground} />
          <Text className="text-sm text-muted-foreground">File</Text>
        </View>
        <Button
          appearance="solid"
          tone="accent"
          size="sm"
          className="self-start"
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
          {busy ? 'Uploading…' : 'Choose file'}
        </Button>
        {Platform.OS === 'web' ? (
          <input
            ref={fileInputRef}
            type="file"
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
      {error ? <Text className="text-xs text-destructive">{error}</Text> : null}
    </View>
  );
}
