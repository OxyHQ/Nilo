/**
 * Text-range decorations (highlights and carets an application puts on a
 * block's text), laid into the runs a block's text is drawn with, and the
 * stretches to measure on an input. Pure, so it is tested without a renderer.
 */
import type { TextRangeDecoration } from './decorations';
import type { RunStyle, TextRun } from './text-runs';
/** What a block's text is drawn as: runs of text, and carets between them. */
export type DecoratedRun = {
    kind: 'text';
    text: string;
    style: RunStyle;
} | {
    kind: 'caret';
    color: string;
    label?: string;
};
/**
 * The runs with the decorations laid in: each run split where a highlight
 * starts or ends, the highlight's colour behind what it covers (the last
 * range given wins where two overlap, over the text's own highlight), and a
 * caret before the text at its offset — carets at one offset in the order
 * given, a caret past the end after the last run.
 */
export declare function decorateRuns(runs: readonly TextRun[], ranges: readonly TextRangeDecoration[] | undefined): DecoratedRun[];
/** A stretch of an input's text to measure, and what is drawn on it. */
export type RangeMark = {
    kind: 'highlight';
    start: number;
    end: number;
    color: string;
} | {
    kind: 'caret';
    start: number;
    end: number;
    color: string;
    label?: string;
};
/**
 * What to draw over an input for the decorations: the highlights (a stretch
 * each), then the carets (an offset each) — so highlights are drawn under the
 * text and carets over it.
 */
export declare function rangeMarks(ranges: readonly TextRangeDecoration[] | undefined, length: number): RangeMark[];
//# sourceMappingURL=range-decorations.d.ts.map