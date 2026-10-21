import { CoverHeader } from '@oxy.so/bloom/cover-header';
import type { FileUrlScope } from '@oxy.so/nilo-contracts';
import { useCoverMedia } from './use-cover-media';

interface CoverDisplayProps {
  value: string | null | undefined;
  /** Vertical focal point, stored by Nilo as a percentage. */
  position?: number;
  height?: number;
  preview?: boolean;
  pageId?: string;
  fileScope?: FileUrlScope;
  fit?: 'cover' | 'contain';
}

/** Compact or read-only cover using the same Bloom renderer as editable pages. */
export function CoverDisplay({
  value,
  position = 50,
  height = 280,
  preview = false,
  pageId,
  fileScope,
  fit = 'cover',
}: CoverDisplayProps) {
  const media = useCoverMedia(value, pageId, fileScope);
  if (!media.hasCover) return null;
  return (
    <CoverHeader
      coverSource={media.coverSource}
      cover={media.cover}
      coverPosition={{ x: 0.5, y: position / 100 }}
      coverHeight={height}
      coverFit={fit}
      coverStyle={{ borderRadius: preview ? 8 : 0 }}
      overlap={0}
    />
  );
}
