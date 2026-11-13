import type { MentionMark, Segment } from '@oxy.so/bloom-text/model';
/** A link or mention in a block's text, with the range it covers. */
export type InlineTarget = {
    kind: 'link';
    href: string;
    start: number;
    end: number;
} | {
    kind: 'mention';
    mention: MentionMark;
    text: string;
    start: number;
    end: number;
};
/** The link or mention a caret is at: inside it or just after it. */
export declare function inlineTargetAt(segments: readonly Segment[], offset: number): InlineTarget | null;
//# sourceMappingURL=inline-target.d.ts.map