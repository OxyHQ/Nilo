import { Platform } from 'react-native';
import { fontFamilies } from '@oxy.so/bloom/fonts';

/**
 * Bloom's code face: the CSS stack on web, and on native the family name
 * BloomProvider's font loader registers (a native `fontFamily` takes one name,
 * not a stack).
 */
export const MONO_FONT_FAMILY = Platform.OS === 'web' ? fontFamilies.mono : 'JetBrains Mono';
