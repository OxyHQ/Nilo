/**
 * A block's rich text as a `Y.Text`: each segment's marks are the attributes
 * of its run. A mention is stored as JSON, because Yjs compares attribute
 * values shallowly and a mention carries nested data.
 */
import { type Segment, type TextMarks } from '@oxy.so/bloom-text/model';
import type * as Y from 'yjs';
type Attributes = Record<string, unknown>;
/** A segment's marks as `Y.Text` attributes (every mark it lacks left out). */
export declare function marksToAttributes(segment: TextMarks): Attributes;
/** The text of a `Y.Text`, as segments. */
export declare function readSegments(text: Y.Text): Segment[];
/** Write segments into an empty `Y.Text`. */
export declare function writeSegments(text: Y.Text, segments: readonly Segment[]): void;
/**
 * Change a `Y.Text` into `next` with the smallest edit: what both share at
 * the start and the end stays, and where only marks differ they are
 * reformatted rather than the text rewritten, so a collaborator typing in the
 * same stretch keeps their words.
 */
export declare function updateSegments(text: Y.Text, next: readonly Segment[]): void;
export {};
//# sourceMappingURL=text.d.ts.map