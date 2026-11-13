/**
 * A block's text as styled runs, for drawing it where the input cannot: the
 * colours and highlights only the value carries, and highlighted code. Pure,
 * so the mapping is tested without a renderer.
 */
import type { RichTextStyle } from '@oxy.so/bloom-text';
import type { Segment } from '@oxy.so/bloom-text/model';
import type { CodeToken } from './context.js';
import type { EditorTheme } from './theme.js';
/** The style of one run, in React Native's terms. */
export interface RunStyle {
    color?: string;
    backgroundColor?: string;
    fontWeight?: '700';
    fontStyle?: 'italic';
    fontFamily?: string;
    textDecorationLine?: 'underline' | 'line-through' | 'underline line-through';
}
export interface TextRun {
    text: string;
    style: RunStyle;
}
/** Whether a text carries marks the input does not show (a colour, a highlight). */
export declare function hasValueOnlyMarks(segments: readonly Segment[]): boolean;
/** The runs of a text, styled as the input styles them, plus colours and highlights. */
export declare function segmentRuns(segments: readonly Segment[], theme: EditorTheme, textStyle: RichTextStyle, monoFontFamily: string): TextRun[];
/**
 * Highlighted code as runs: the tokens of each line, lines joined by line
 * breaks. Null when the tokens do not spell `code` exactly — a highlighter
 * that drops or adds text must never show a page what it does not hold.
 */
export declare function codeRuns(code: string, lines: readonly (readonly CodeToken[])[]): TextRun[] | null;
//# sourceMappingURL=text-runs.d.ts.map