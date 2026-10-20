import * as React from 'react';
import { Platform } from 'react-native';
import { useOxy } from '@oxy.so/services/ui/client';
// The document picker is in every bundle already (importing pages); the image
// picker, native-only, is loaded when it is used.
import * as DocumentPicker from 'expo-document-picker';
import { useQueryClient } from '@tanstack/react-query';
import { type AttachedFile, type PickedFile, uploadPageFile } from '@/lib/files/upload-page-file';
import { useTranslation } from '@/hooks/useTranslation';

/** What is uploaded: a picture, a video, a sound, or any file. */
export type MediaKind = 'image' | 'video' | 'audio' | 'file';

/** What the browser's file input accepts for `kind`; any file when undefined. */
const ACCEPT: Record<MediaKind, string | undefined> = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
  file: undefined,
};

/** What the device's picker found, as an upload takes it; null when nothing was picked. */
async function pickOnDevice(kind: MediaKind): Promise<PickedFile | null> {
  if (kind === 'image' || kind === 'video') {
    const picker = await import('expo-image-picker');
    const result = await picker.launchImageLibraryAsync(
      kind === 'image'
        ? { mediaTypes: picker.MediaTypeOptions.Images, quality: 0.9 }
        : { mediaTypes: ['videos'] },
    );
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return null;
    return {
      uri: asset.uri,
      name:
        asset.fileName ??
        (kind === 'image' ? `image-${Date.now()}.jpg` : `video-${Date.now()}.mp4`),
      type: asset.mimeType ?? (kind === 'image' ? 'image/jpeg' : 'video/mp4'),
      ...(asset.fileSize !== undefined && { size: asset.fileSize }),
    };
  }
  const result = await DocumentPicker.getDocumentAsync(
    kind === 'audio'
      ? { type: 'audio/*', copyToCacheDirectory: true }
      : { copyToCacheDirectory: true },
  );
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  return {
    uri: asset.uri,
    name: asset.name ?? (kind === 'audio' ? `audio-${Date.now()}.m4a` : `file-${Date.now()}`),
    type: asset.mimeType ?? (kind === 'audio' ? 'audio/mpeg' : 'application/octet-stream'),
    ...(asset.size !== undefined && { size: asset.size }),
  };
}

/**
 * Upload a file to a page: to Oxy's file manager as the member's own file,
 * attached to the page (`lib/files/upload-page-file.ts`), which is what lets
 * the page's readers see it. `choose` opens the browser's file input or the
 * device's picker; `input` is the hidden web input to render. Without a page
 * there is nowhere to upload to, and choosing does nothing. `uploadError`
 * words a failed upload; `setError` lets a caller show its own errors in the
 * same place, the last one replacing the one before.
 */
export function useMediaUpload(
  pageId: string | undefined,
  kind: MediaKind,
  onAttached: (file: AttachedFile) => void,
  uploadError?: (error: unknown) => string,
): {
  busy: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  choose: () => void;
  input: React.ReactNode;
} {
  const { t } = useTranslation();
  const { oxyServices } = useOxy();
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const attach = async (file: PickedFile) => {
    if (!pageId) return;
    setBusy(true);
    setError(null);
    try {
      onAttached(await uploadPageFile(oxyServices, queryClient, pageId, file));
    } catch (err) {
      setError(
        uploadError
          ? uploadError(err)
          : err instanceof Error
            ? err.message
            : t('editor.blocks.uploadFailed'),
      );
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
        accept={ACCEPT[kind]}
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void attach(file);
          event.target.value = '';
        }}
      />
    ) : null;

  return { busy, error, setError, choose, input };
}
