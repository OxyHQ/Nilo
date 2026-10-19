import { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useQueryClient } from '@tanstack/react-query';
import type { CodeHighlighter, CodeLanguage, EditorStore } from '@oxy.so/bloom-editor';
import { insertSnapshot } from '@oxy.so/bloom-editor';
import type { PastedImage } from '@oxy.so/bloom-text';
import { tokenColor, useCodePalette } from '@oxy.so/bloom/code';
import { toast } from '@oxy.so/bloom/toast';
import { useOxy } from '@oxy.so/services/ui/client';
import { useTranslation } from '@/hooks/useTranslation';
import { CODE_LANGUAGE_NAMES, CODE_LANGUAGES, highlightCode } from '@/lib/code-highlight';
import { type PickedFile, uploadPageFile } from '@/lib/files/upload-page-file';

/** Where the app is served: the link to a block is one a member opens. */
function appOrigin(): string {
  return Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.origin
    : 'https://nilo.so';
}

/** The link to one block of a page, which opens the page scrolled to it. */
export function blockLink(pageId: string, blockId: string): string {
  return `${appOrigin()}/p/${pageId}?blockId=${encodeURIComponent(blockId)}`;
}

/** A pasted image as the upload takes it: a File in a browser, its URI on a device. */
async function pickedFile(image: PastedImage, index: number): Promise<PickedFile> {
  const extension = image.type.split('/')[1] ?? 'png';
  const name = `pasted-${Date.now()}-${index}.${extension}`;
  if (Platform.OS !== 'web') return { uri: image.uri, name, type: image.type };
  const blob = await (await fetch(image.uri)).blob();
  return new File([blob], name, { type: image.type || blob.type });
}

/**
 * What Nilo hands Bloom's editor beyond its blocks: copying a link to a
 * block, uploading pasted images as image blocks of the page, and code
 * blocks' languages and highlighting (`lib/code-highlight.ts`).
 */
export function useEditorExtras(pageId: string, store: EditorStore | null, readOnly: boolean) {
  const { t } = useTranslation();
  const { oxyServices } = useOxy();
  const queryClient = useQueryClient();
  const palette = useCodePalette();

  const onCopyBlockLink = useCallback(
    (blockId: string) => {
      void Clipboard.setStringAsync(blockLink(pageId, blockId)).then(() =>
        toast.success(t('editor.blockLinkCopied')),
      );
    },
    [pageId, t],
  );

  const onPasteImages = useCallback(
    (images: PastedImage[], blockId: string) => {
      if (!store || readOnly) return;
      void (async () => {
        let after = blockId;
        for (const [i, image] of images.entries()) {
          try {
            const attached = await uploadPageFile(
              oxyServices,
              queryClient,
              pageId,
              await pickedFile(image, i),
            );
            // Each image goes after the one before it, the first after the block it was pasted in.
            let placed: string | null = null;
            store.run((ctx) => {
              const tx = insertSnapshot(
                ctx.doc,
                [{ type: 'image', props: { url: '', fileId: attached.fileId } }],
                ctx.doc.blocks[after] ? after : null,
                ctx.newId,
                ctx.schema,
              );
              placed =
                tx?.selectionAfter?.kind === 'blocks' ? (tx.selectionAfter.ids[0] ?? null) : null;
              return tx;
            });
            if (placed) after = placed;
          } catch {
            toast.error(t('editor.blocks.uploadFailed'));
          }
        }
      })();
    },
    [store, readOnly, oxyServices, queryClient, pageId, t],
  );

  const codeLanguages = useMemo<readonly CodeLanguage[]>(
    () =>
      CODE_LANGUAGES.map((id) => ({
        id,
        label: id === 'plain' ? t('editor.codePlain') : CODE_LANGUAGE_NAMES[id],
      })),
    [t],
  );

  const highlight = useCallback<CodeHighlighter>(
    (code, language) =>
      highlightCode(code, language).map((line) =>
        line.map((token) => ({ text: token.text, color: tokenColor(token.kind, palette) })),
      ),
    [palette],
  );

  return { onCopyBlockLink, onPasteImages, codeLanguages, highlightCode: highlight };
}
