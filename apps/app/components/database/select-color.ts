import type { ChipHue } from '@oxy.so/bloom/chip';
import type { SelectColor } from '@/lib/types/databases';

/** The Bloom `Chip` hue each select-option colour paints with. */
export const SELECT_CHIP_HUE: Record<SelectColor, ChipHue> = {
  default: 'neutral',
  gray: 'gray',
  brown: 'brown',
  orange: 'orange',
  yellow: 'yellow',
  green: 'lime',
  blue: 'blue',
  purple: 'purple',
  pink: 'pink',
  red: 'rose',
};
