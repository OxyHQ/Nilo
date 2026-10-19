import * as React from 'react';
import { type LayoutChangeEvent, Platform, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Image as ExpoImage } from 'expo-image';
import { blockFileId } from '@oxy.so/nilo-contracts';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import { RiImageLine } from '@oxy.so/bloom/icons/RiImageLine';
import { RiUpload2Line } from '@oxy.so/bloom/icons/RiUpload2Line';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useOxy } from '@oxy.so/services/ui/client';
import { useQueryClient } from '@tanstack/react-query';
import { useFileImageSource, useFileRemoved, useFileScope } from '@/lib/files/file-urls';
import { type PickedFile, uploadPageFile } from '@/lib/files/upload-page-file';
import type { ImageAlignment } from '@/lib/types/pages';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { BlockCaption, UrlPrompt } from './block-parts';
import { type BlockMenuEntry, BlockMenuButton } from './block-menu-button';
import {
  displayWidth,
  draggedWidth,
  IMAGE_SIZE_PRESETS,
  imageAlignment,
  imageWidth,
  storedWidth,
} from './image-layout';
import { type BlockComponentProps, blockUrl } from './types';

const ALIGN_SELF = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
  full: 'stretch',
} as const;

/**
 * Image block — renders a captioned image. Empty state offers two paths:
 *   1) Paste a URL into the URL field (`content.url`).
 *   2) Upload a picture: it goes to Oxy's file manager as the member's own
 *      file, attached to this page (`lib/files`), and the block keeps its id
 *      (`content.fileId`); the URL it is shown with is minted per reader.
 *
 * An editor sizes it (dragging an edge on the web, a size from its menu
 * anywhere: `content.width`), aligns it (`content.alignment`) and describes
 * it for screen readers (`content.alt`).
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
  const alt = typeof block.content.alt === 'string' ? block.content.alt : undefined;
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
        accessibilityLabel={alt}
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
      <SizedImage
        // An attachment's URL changes every few minutes; its id names it in the cache.
        source={fileSource ?? { uri: url }}
        alt={alt}
        width={imageWidth(block.content.width)}
        alignment={imageAlignment(block.content.alignment)}
        readOnly={readOnly === true}
        onChange={(patch) => onChangeContent({ ...block.content, ...patch })}
      />
      <BlockCaption block={block} onChangeContent={onChangeContent} readOnly={readOnly} />
    </View>
  );
}

/**
 * The image at its width and alignment. Its height follows the picture's own
 * proportions once it has loaded. An editor drags either edge (web) or picks
 * a size, an alignment and alt text from its menu.
 */
export function SizedImage({
  source,
  alt,
  width,
  alignment,
  readOnly,
  onChange,
}: {
  source: { uri: string; cacheKey?: string };
  alt: string | undefined;
  width: number | undefined;
  alignment: ImageAlignment;
  readOnly: boolean;
  onChange?: (patch: { width?: number; alignment?: ImageAlignment; alt?: string }) => void;
}) {
  const { t } = useTranslation();
  const [frame, setFrame] = React.useState(0);
  const [aspect, setAspect] = React.useState(16 / 9);
  const [dragged, setDragged] = React.useState<number | null>(null);
  const [hovered, setHovered] = React.useState(false);
  const [editingAlt, setEditingAlt] = React.useState(false);
  const editable = !readOnly && onChange !== undefined;
  const drawn = displayWidth(width, alignment, frame);
  const shown = dragged ?? drawn;
  // The width a drag of an edge started from: the gesture reports how far
  // the pointer went since.
  const dragStart = React.useRef(drawn);

  const onLayout = (event: LayoutChangeEvent) => setFrame(event.nativeEvent.layout.width);
  const commitWidth = (drawn: number) => onChange?.({ width: storedWidth(drawn, frame) });

  const entries: BlockMenuEntry[] = [
    ...(['left', 'center', 'right', 'full'] as const).map((value) => ({
      kind: 'check' as const,
      label: t(`editor.blocks.image.align.${value}`),
      checked: alignment === value,
      onChange: () => onChange?.({ alignment: value }),
    })),
    { kind: 'separator' },
    ...IMAGE_SIZE_PRESETS.map((share) => ({
      label: t('editor.blocks.image.size', { percent: Math.round(share * 100) }),
      disabled: alignment === 'full' || frame <= 0,
      onPress: () => commitWidth(frame * share),
    })),
    { kind: 'separator' },
    { label: t('editor.blocks.image.altText'), onPress: () => setEditingAlt(true) },
  ];

  const resizable = editable && Platform.OS === 'web' && alignment !== 'full' && frame > 0;

  return (
    <View onLayout={onLayout} className="w-full">
      <View
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        style={{
          alignSelf: ALIGN_SELF[alignment],
          width: frame > 0 ? shown : '100%',
        }}
      >
        <ExpoImage
          source={source}
          style={{ width: '100%', aspectRatio: aspect, borderRadius: 8 }}
          contentFit="contain"
          transition={150}
          accessibilityLabel={alt}
          onLoad={(event) => {
            const { width: w, height: h } = event.source;
            if (w > 0 && h > 0) setAspect(w / h);
          }}
        />
        {resizable ? (
          <>
            <ResizeEdge
              edge="left"
              visible={hovered || dragged !== null}
              label={t('editor.blocks.image.resize')}
              onStart={() => {
                dragStart.current = drawn;
              }}
              onMove={(dx) =>
                setDragged(draggedWidth(dragStart.current, dx, 'left', alignment, frame))
              }
              onEnd={(dx) => {
                const next = draggedWidth(dragStart.current, dx, 'left', alignment, frame);
                setDragged(null);
                if (dx !== 0) commitWidth(next);
              }}
            />
            <ResizeEdge
              edge="right"
              visible={hovered || dragged !== null}
              label={t('editor.blocks.image.resize')}
              onStart={() => {
                dragStart.current = drawn;
              }}
              onMove={(dx) =>
                setDragged(draggedWidth(dragStart.current, dx, 'right', alignment, frame))
              }
              onEnd={(dx) => {
                const next = draggedWidth(dragStart.current, dx, 'right', alignment, frame);
                setDragged(null);
                if (dx !== 0) commitWidth(next);
              }}
            />
          </>
        ) : null}
        {editable ? (
          <View
            className={cn(
              'absolute right-2 top-2 rounded-md bg-background/90',
              Platform.OS === 'web' && !hovered && 'opacity-0',
            )}
          >
            <BlockMenuButton label={t('editor.blocks.image.options')} entries={entries} />
          </View>
        ) : null}
      </View>
      {editingAlt ? (
        <AltTextDialog
          initial={alt ?? ''}
          onSave={(next) => onChange?.({ alt: next.trim() || undefined })}
          onClose={() => setEditingAlt(false)}
        />
      ) : null}
    </View>
  );
}

/** An edge of an image an editor drags (web); `onMove` is told how far it went. */
function ResizeEdge({
  edge,
  visible,
  label,
  onStart,
  onMove,
  onEnd,
}: {
  edge: 'left' | 'right';
  visible: boolean;
  label: string;
  onStart: () => void;
  onMove: (dx: number) => void;
  onEnd: (dx: number) => void;
}) {
  const drag = Gesture.Pan()
    .runOnJS(true)
    .onStart(onStart)
    .onUpdate((event) => onMove(event.translationX))
    .onEnd((event) => onEnd(event.translationX));
  return (
    <GestureDetector gesture={drag}>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        className={cn(
          'absolute bottom-0 top-0 w-3 items-center justify-center cursor-ew-resize',
          edge === 'left' ? 'left-0' : 'right-0',
          !visible && 'opacity-0',
        )}
      >
        <View className="h-10 w-1.5 rounded-full border border-background bg-foreground/60" />
      </View>
    </GestureDetector>
  );
}

function AltTextDialog({
  initial,
  onSave,
  onClose,
}: {
  initial: string;
  onSave: (alt: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const control = useDialogControl();
  const [draft, setDraft] = React.useState(initial);
  return (
    <Dialog
      control={control}
      startOpen
      onClose={onClose}
      placement={{ base: 'bottom', md: 'center' }}
      title={t('editor.blocks.image.altText')}
      label={t('editor.blocks.image.altText')}
    >
      <View className="gap-3">
        <TextFieldInput
          value={draft}
          onChangeText={setDraft}
          autoFocus
          label={t('editor.blocks.image.altText')}
          placeholder={t('editor.blocks.image.altPlaceholder')}
        />
        <Text className="text-xs text-muted-foreground">{t('editor.blocks.image.altHint')}</Text>
        <View className="flex-row justify-end gap-2">
          <Button appearance="outline" tone="neutral" onPress={() => control.close()}>
            {t('common.cancel')}
          </Button>
          <Button
            appearance="solid"
            tone="accent"
            onPress={() => control.close(() => onSave(draft))}
          >
            {t('common.save')}
          </Button>
        </View>
      </View>
    </Dialog>
  );
}
