import { Platform } from 'react-native';
import { fontFamilies } from '@oxy.so/bloom/fonts';

/**
 * Bloom's code face: the CSS stack on web, and on native the family name
 * BloomProvider's font loader registers (a native `fontFamily` takes one name,
 * not a stack).
 */
export const MONO_FONT_FAMILY = Platform.OS === 'web' ? fontFamilies.mono : 'JetBrains Mono';

/** Page typography uses only faces registered by BloomProvider. */
export const PAGE_FONT_FAMILIES = {
  default: Platform.OS === 'web' ? fontFamilies.sans : 'Inter',
  serif: Platform.OS === 'web' ? fontFamilies.display : 'BlomusModernus',
  mono: MONO_FONT_FAMILY,
} as const;
