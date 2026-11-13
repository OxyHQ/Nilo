import type { RichTextInputHandle, TextRect } from '@oxy.so/bloom-text';
import { type ComponentRef, type RefObject } from 'react';
import { View } from 'react-native';
import { type RangeMark } from './range-decorations';
import type { TextRangeDecoration } from './decorations';
/** A collaborator's name over their caret. */
export declare function CaretFlag({ label, color, textColor, left }: CaretFlagProps): import("react").JSX.Element;
interface CaretFlagProps {
    label: string;
    color: string;
    /** The flag's text: the page's background colour, which caret colours are chosen against. */
    textColor: string;
    /** Where the flag starts, from the left of the box it hangs from. */
    left?: number;
}
/**
 * A caret inside drawn text (`RunsText`), at its place in the line. On web,
 * a span of no width whose left border is the caret, as tall as the text
 * around it; on native, an inline view (React Native lays views out inside
 * text), as tall as the font.
 */
export declare function InlineCaret({ color, label, fontSize, textColor, }: {
    color: string;
    label?: string;
    fontSize: number;
    textColor: string;
}): import("react").JSX.Element;
/** A measured mark: its boxes on the input. */
interface MeasuredMark {
    mark: RangeMark;
    rects: readonly TextRect[];
}
/**
 * Web: the decorations of a block being edited, measured on its input — on
 * every change to them or to the text, and whenever the block's box changes
 * size (its lines wrap again). Empty on native, where the input measures
 * nothing, and whenever the input does not show the text the decorations
 * were made for.
 */
export declare function useMeasuredMarks(input: RefObject<RichTextInputHandle | null>, host: RefObject<ComponentRef<typeof View> | null>, ranges: readonly TextRangeDecoration[] | undefined, text: string, active: boolean): readonly MeasuredMark[];
/** Highlights measured on an input, drawn under its text. */
export declare function MeasuredHighlights({ marks }: {
    marks: readonly MeasuredMark[];
}): import("react").JSX.Element;
/** Carets measured on an input, drawn over its text. */
export declare function MeasuredCarets({ marks, textColor, }: {
    marks: readonly MeasuredMark[];
    textColor: string;
}): import("react").JSX.Element;
export {};
//# sourceMappingURL=RangeMarks.d.ts.map