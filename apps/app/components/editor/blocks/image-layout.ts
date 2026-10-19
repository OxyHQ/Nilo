/**
 * How an image block is laid out from its content (`width` in points,
 * `alignment`), and how dragging its edges or picking a size changes it.
 */
import type { ImageAlignment } from '@/lib/types/pages';

/** Narrowest an image can be made. */
export const MIN_IMAGE_WIDTH = 64;
/** The sizes offered where an image is not dragged (a phone), as shares of the page. */
export const IMAGE_SIZE_PRESETS = [0.25, 0.5, 0.75, 1] as const;

export function imageAlignment(value: unknown): ImageAlignment {
  return value === 'left' || value === 'right' || value === 'full' ? value : 'center';
}

export function imageWidth(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * The width the image is drawn at in a frame `frame` wide: all of it when
 * full or unsized, its own width otherwise, never wider than the frame.
 */
export function displayWidth(
  width: number | undefined,
  alignment: ImageAlignment,
  frame: number,
): number {
  if (frame <= 0) return 0;
  if (alignment === 'full' || width === undefined) return frame;
  return Math.max(Math.min(MIN_IMAGE_WIDTH, frame), Math.min(width, frame));
}

/**
 * The width after dragging one edge by `dx` from `start`: outward widens. A
 * centred image grows on both sides, so it follows the pointer at twice the
 * pace.
 */
export function draggedWidth(
  start: number,
  dx: number,
  edge: 'left' | 'right',
  alignment: ImageAlignment,
  frame: number,
): number {
  const outward = edge === 'right' ? dx : -dx;
  const next = start + outward * (alignment === 'center' ? 2 : 1);
  return Math.round(Math.max(Math.min(MIN_IMAGE_WIDTH, frame), Math.min(frame, next)));
}

/**
 * The `width` to store for an image drawn `drawn` wide in a frame `frame`
 * wide: none once it fills the frame, so it keeps filling a wider one.
 */
export function storedWidth(drawn: number, frame: number): number | undefined {
  if (frame > 0 && drawn >= frame - 1) return undefined;
  return Math.round(drawn);
}
