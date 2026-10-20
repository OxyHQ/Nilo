import * as React from 'react';
import { Image, View, Platform, type ImageStyle, type ViewStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import type { FileUrlScope } from '@oxy.so/nilo-contracts';
import { useFileImageSource, useFileScope } from '@/lib/files/file-urls';
import { parseCover, COVER_GRADIENTS, type CoverValue } from './cover-value';
import { useTranslation } from '@/hooks/useTranslation';

interface CoverDisplayProps {
  value: string | null | undefined;
  /** Vertical focal-point (0–100). 0 = top, 100 = bottom, 50 = centered. */
  position?: number;
  /** Optional override height (default: 192px). */
  height?: number;
  /** Render a compact preview (used in pickers). */
  preview?: boolean;
  /** The page whose cover this is: an uploaded one is read through it. */
  pageId?: string;
  /** How the reader reached the page, when not as a member (a share link, a published site). */
  fileScope?: FileUrlScope;
  /** Card previews may show the entire image instead of cropping it. */
  fit?: 'cover' | 'contain';
}

/**
 * On web we sprinkle in DOM-only style keys (`backgroundImage`,
 * `objectFit`, `objectPosition`). RN typings strip those — we widen the
 * style type here. On native those keys are no-ops.
 */
type WebExtras = {
  backgroundImage?: string;
  objectFit?: 'cover' | 'contain';
  objectPosition?: string;
};
type WebView = ViewStyle & WebExtras;
type WebImage = ImageStyle & WebExtras;

/**
 * Single source of truth for rendering a page cover. Same component is used
 * by the page header (full-width 192px) and by the cover picker preview
 * cards (compact 60–80px).
 */
export function CoverDisplay({
  value,
  position = 50,
  height = 192,
  preview = false,
  pageId,
  fileScope,
  fit = 'cover',
}: CoverDisplayProps) {
  const parsed = React.useMemo<CoverValue>(() => parseCover(value), [value]);
  const { t } = useTranslation();

  if (parsed.kind === 'none') return null;

  if (parsed.kind === 'gradient') {
    const gradient = COVER_GRADIENTS[parsed.index];
    if (!gradient) return null;
    return <GradientView from={gradient.from} to={gradient.to} height={height} preview={preview} />;
  }

  if (parsed.kind === 'color') {
    return (
      <View
        style={{
          width: '100%',
          height,
          backgroundColor: parsed.hex,
          borderRadius: preview ? 8 : 0,
        }}
      />
    );
  }

  if (parsed.kind === 'file') {
    return (
      <FileCover
        fileId={parsed.fileId}
        position={position}
        height={height}
        preview={preview}
        pageId={pageId}
        fileScope={fileScope}
        fit={fit}
      />
    );
  }

  const uri = parsed.url;
  const imageStyle: WebImage =
    Platform.OS === 'web'
      ? {
          width: '100%',
          height,
          borderRadius: preview ? 8 : 0,
          objectFit: fit,
          objectPosition: `50% ${position}%`,
        }
      : {
          width: '100%',
          height,
          borderRadius: preview ? 8 : 0,
        };

  return (
    <Image
      source={{ uri }}
      style={imageStyle as ImageStyle}
      resizeMode={fit}
      accessibilityLabel={t('pages.header.pageCover')}
    />
  );
}

/** A cover uploaded to the page: its file, shown with a URL minted for this reader. */
function FileCover({
  fileId,
  position,
  height,
  preview,
  pageId,
  fileScope,
  fit,
}: {
  fileId: string;
  position: number;
  height: number;
  preview: boolean;
  pageId?: string;
  fileScope?: FileUrlScope;
  fit: 'cover' | 'contain';
}) {
  const { t } = useTranslation();
  const contextScope = useFileScope(pageId);
  const source = useFileImageSource(fileScope ?? contextScope, fileId);
  const style = { width: '100%' as const, height, borderRadius: preview ? 8 : 0 };
  if (!source) return <View className="bg-muted" style={style} />;
  return (
    <ExpoImage
      source={source}
      style={style}
      contentFit={fit}
      contentPosition={{ left: '50%', top: `${position}%` }}
      accessibilityLabel={t('pages.header.pageCover')}
    />
  );
}

/**
 * Two-stop gradient. CSS linear-gradient on web; native falls back to a
 * stacked semi-transparent View so we don't ship a new gradient dep just
 * for chrome.
 */
function GradientView({
  from,
  to,
  height,
  preview,
}: {
  from: string;
  to: string;
  height: number;
  preview: boolean;
}) {
  if (Platform.OS === 'web') {
    const webStyle: WebView = {
      width: '100%',
      height,
      borderRadius: preview ? 8 : 0,
      backgroundImage: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
    };
    return <View style={webStyle as ViewStyle} />;
  }
  return (
    <View
      style={{
        width: '100%',
        height,
        borderRadius: preview ? 8 : 0,
        overflow: 'hidden',
        backgroundColor: to,
      }}
    >
      <View style={{ flex: 1, backgroundColor: from, opacity: 0.7 }} />
    </View>
  );
}
