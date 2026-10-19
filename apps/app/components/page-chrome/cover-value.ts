/**
 * Encoding for the Page.cover string column. Same shape as `icon-value.ts`:
 * a single `prefix:value` string covers every cover variant we ship.
 *
 *   gradient:<index>   — a preset gradient (defined in COVER_GRADIENTS).
 *   color:<#hex>       — a solid color cover.
 *   image:<url>        — an image URL.
 *   file:<fileId>      — an image uploaded to the page (`@oxy.so/nilo-contracts`).
 *   unsplash:<url>     — Unsplash image. Behaves like `image:` at render time
 *                        but kept distinct so the picker tab can preselect.
 */

import { PAGE_FILE_PREFIX, pageValueFileId } from '@oxy.so/nilo-contracts';
import i18n from '@/lib/i18n';

export type CoverValue =
  | { kind: 'gradient'; index: number }
  | { kind: 'color'; hex: string }
  | { kind: 'image'; url: string }
  | { kind: 'unsplash'; url: string }
  | { kind: 'file'; fileId: string }
  | { kind: 'none' };

export function parseCover(raw: string | null | undefined): CoverValue {
  if (!raw) return { kind: 'none' };
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'none' };

  if (trimmed.startsWith('gradient:')) {
    const idx = Number.parseInt(trimmed.slice('gradient:'.length), 10);
    if (Number.isFinite(idx) && idx >= 0 && idx < COVER_GRADIENTS.length) {
      return { kind: 'gradient', index: idx };
    }
    return { kind: 'none' };
  }
  if (trimmed.startsWith('color:')) {
    const hex = trimmed.slice('color:'.length);
    return hex ? { kind: 'color', hex } : { kind: 'none' };
  }
  if (trimmed.startsWith('image:')) {
    const url = trimmed.slice('image:'.length);
    return url ? { kind: 'image', url } : { kind: 'none' };
  }
  if (trimmed.startsWith('unsplash:')) {
    const url = trimmed.slice('unsplash:'.length);
    return url ? { kind: 'unsplash', url } : { kind: 'none' };
  }
  if (trimmed.startsWith(PAGE_FILE_PREFIX)) {
    const fileId = pageValueFileId(trimmed);
    return fileId ? { kind: 'file', fileId } : { kind: 'none' };
  }
  // Legacy: bare URL. Treat as image so pre-prefix pages still render.
  if (/^https?:\/\//u.test(trimmed)) {
    return { kind: 'image', url: trimmed };
  }
  return { kind: 'none' };
}

export function encodeGradient(index: number): string {
  return `gradient:${index}`;
}
export function encodeColor(hex: string): string {
  return `color:${hex}`;
}
export function encodeCoverImage(url: string): string {
  return `image:${url}`;
}
export function encodeUnsplash(url: string): string {
  return `unsplash:${url}`;
}
export function encodeCoverFile(fileId: string): string {
  return `${PAGE_FILE_PREFIX}${fileId}`;
}

/**
 * Preset gradient list. Each entry is two-stop CSS-linear-gradient-friendly.
 * Direction is fixed at 135deg to keep the picker visual identical on web
 * and native. Add to the end of the array to avoid invalidating stored
 * indices.
 */
export const COVER_GRADIENTS: ReadonlyArray<{
  /** Stable identifier (React key); not shown to users. */
  name: string;
  /** Translated display name, resolved at render time. */
  label: () => string;
  from: string;
  to: string;
}> = [
  {
    name: 'Sunset',
    label: () => i18n.t('pages.coverPicker.gradients.sunset'),
    from: '#ff7e5f',
    to: '#feb47b',
  },
  {
    name: 'Aurora',
    label: () => i18n.t('pages.coverPicker.gradients.aurora'),
    from: '#a8edea',
    to: '#fed6e3',
  },
  {
    name: 'Tropics',
    label: () => i18n.t('pages.coverPicker.gradients.tropics'),
    from: '#43cea2',
    to: '#185a9d',
  },
  {
    name: 'Lavender',
    label: () => i18n.t('pages.coverPicker.gradients.lavender'),
    from: '#c471f5',
    to: '#fa71cd',
  },
  {
    name: 'Mint',
    label: () => i18n.t('pages.coverPicker.gradients.mint'),
    from: '#76b852',
    to: '#8dc26f',
  },
  {
    name: 'Ocean',
    label: () => i18n.t('pages.coverPicker.gradients.ocean'),
    from: '#2193b0',
    to: '#6dd5ed',
  },
  {
    name: 'Sherbet',
    label: () => i18n.t('pages.coverPicker.gradients.sherbet'),
    from: '#f7971e',
    to: '#ffd200',
  },
  {
    name: 'Plum',
    label: () => i18n.t('pages.coverPicker.gradients.plum'),
    from: '#5614b0',
    to: '#dbd65c',
  },
  {
    name: 'Crimson',
    label: () => i18n.t('pages.coverPicker.gradients.crimson'),
    from: '#ed213a',
    to: '#93291e',
  },
  {
    name: 'Slate',
    label: () => i18n.t('pages.coverPicker.gradients.slate'),
    from: '#232526',
    to: '#414345',
  },
];

/**
 * Preset solid colors. Picked to read well as a 200px cover behind dark text.
 */
export const COVER_COLORS: ReadonlyArray<{
  name: string;
  label: () => string;
  hex: string;
}> = [
  { name: 'Slate', label: () => i18n.t('pages.coverPicker.colors.slate'), hex: '#1f2937' },
  { name: 'Stone', label: () => i18n.t('pages.coverPicker.colors.stone'), hex: '#57534e' },
  { name: 'Brick', label: () => i18n.t('pages.coverPicker.colors.brick'), hex: '#9a3412' },
  { name: 'Marigold', label: () => i18n.t('pages.coverPicker.colors.marigold'), hex: '#a16207' },
  { name: 'Moss', label: () => i18n.t('pages.coverPicker.colors.moss'), hex: '#15803d' },
  { name: 'Sea', label: () => i18n.t('pages.coverPicker.colors.sea'), hex: '#0e7490' },
  { name: 'Sky', label: () => i18n.t('pages.coverPicker.colors.sky'), hex: '#1d4ed8' },
  { name: 'Violet', label: () => i18n.t('pages.coverPicker.colors.violet'), hex: '#6d28d9' },
  { name: 'Rose', label: () => i18n.t('pages.coverPicker.colors.rose'), hex: '#be185d' },
  { name: 'Charcoal', label: () => i18n.t('pages.coverPicker.colors.charcoal'), hex: '#27272a' },
];
