import type { RichTextStyle } from '@oxy.so/bloom-text';
import { type ViewStyle } from 'react-native';
import type { TextRangeDecoration } from './decorations.js';
import type { TextRun } from './text-runs.js';
/** The font the input draws inline code in, where the theme names none. */
export declare const MONO_FONT: string;
/**
 * Runs drawn over a block's input while it is not being edited (the input
 * stays below, invisible, and still takes the press that starts editing),
 * with the application's highlights and carets laid in.
 */
export declare function RunsText({ runs, ranges, textStyle, flagTextColor, style, }: {
    runs: readonly TextRun[];
    /** Highlights and carets in the text (`BlockDecoration.ranges`). */
    ranges?: readonly TextRangeDecoration[];
    textStyle: RichTextStyle;
    /** The text of a caret's name flag. */
    flagTextColor: string;
    style?: ViewStyle;
}): import("react").JSX.Element;
//# sourceMappingURL=RunsText.d.ts.map