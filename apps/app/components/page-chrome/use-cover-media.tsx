import { useMemo } from 'react';
import { CoverFill } from '@oxy.so/bloom/cover-header';
import type { FileUrlScope } from '@oxy.so/nilo-contracts';
import { useFileImageSource, useFileScope } from '@/lib/files/file-urls';
import { COVER_GRADIENTS, parseCover } from './cover-value';

/** Nilo resolves stored media and reader access; Bloom owns rendering and cropping. */
export function useCoverMedia(
  value: string | null | undefined,
  pageId?: string,
  fileScope?: FileUrlScope,
) {
  const parsed = useMemo(() => parseCover(value), [value]);
  const contextScope = useFileScope(pageId);
  const fileSource = useFileImageSource(
    fileScope ?? contextScope,
    parsed.kind === 'file' ? parsed.fileId : null,
  );
  const coverSource =
    parsed.kind === 'file'
      ? fileSource
      : parsed.kind === 'image' || parsed.kind === 'unsplash'
        ? parsed.url
        : undefined;
  const gradient = parsed.kind === 'gradient' ? COVER_GRADIENTS[parsed.index] : undefined;
  const cover = gradient ? (
    <CoverFill gradient={{ from: gradient.from, to: gradient.to, angle: 135 }} />
  ) : parsed.kind === 'color' ? (
    <CoverFill color={parsed.hex} />
  ) : undefined;
  return { coverSource, cover, hasCover: parsed.kind !== 'none' };
}
