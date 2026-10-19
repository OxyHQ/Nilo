import * as React from 'react';
import { Platform } from 'react-native';
import { useOxy } from '@oxy.so/services/ui/client';
import { useQueryClient } from '@tanstack/react-query';
import { type AttachedFile, type PickedFile, uploadPageFile } from '@/lib/files/upload-page-file';
import { useTranslation } from '@/hooks/useTranslation';

export type MediaKind = 'video' | 'audio';

/** What the device's picker found, as an upload takes it; null when nothing was picked. */
async function pickOnDevice(kind: MediaKind): Promise<PickedFile | null> {
  if (kind === 'video') {
    const picker = await import('expo-image-picker');
    const result = await picker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return null;
    return {
      uri: asset.uri,
      name: asset.fileName ?? `video-${Date.now()}.mp4`,
      type: asset.mimeType ?? 'video/mp4',
      ...(asset.fileSize !== undefined && { size: asset.fileSize }),
    };
  }
  const picker = await import('expo-document-picker');
  const result = await picker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  return {
    uri: asset.uri,
    name: asset.name ?? `audio-${Date.now()}.m4a`,
    type: asset.mimeType ?? 'audio/mpeg',
    ...(asset.size !== undefined && { size: asset.size }),
  };
}

/**
 * Upload a video or a sound to the page, as an image or a file is: to Oxy's
 * file manager as the member's own file, attached to this page
 * (`lib/files/upload-page-file.ts`). `choose` opens the browser's file input
 * or the device's picker; `input` is the hidden web input to render.
 */
export function useMediaUpload(
  pageId: string,
  kind: MediaKind,
  onAttached: (file: AttachedFile) => void,
): { busy: boolean; error: string | null; choose: () => void; input: React.ReactNode } {
  const { t } = useTranslation();
  const { oxyServices } = useOxy();
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const attach = async (file: PickedFile) => {
    setBusy(true);
    setError(null);
    try {
      onAttached(await uploadPageFile(oxyServices, queryClient, pageId, file));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('editor.blocks.uploadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const choose = () => {
    if (Platform.OS === 'web') {
      inputRef.current?.click();
      return;
    }
    void pickOnDevice(kind)
      .then((file) => (file ? attach(file) : undefined))
      .catch(() => setError(t('editor.blocks.uploadFailed')));
  };

  const input =
    Platform.OS === 'web' ? (
      <input
        ref={inputRef}
        type="file"
        accept={kind === 'video' ? 'video/*' : 'audio/*'}
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void attach(file);
          event.target.value = '';
        }}
      />
    ) : null;

  return { busy, error, choose, input };
}
