import type { RichTextStyle } from '@oxy.so/bloom-text';
import type { EditorTheme } from './theme';
/** Type scale per block type, Notion's proportions, times the theme's `textScale`. */
export declare function textStyleFor(type: string, theme: EditorTheme): RichTextStyle;
/** Space above a block, so headings breathe as in Notion. */
export declare function blockSpacing(type: string): number;
//# sourceMappingURL=typography.d.ts.map