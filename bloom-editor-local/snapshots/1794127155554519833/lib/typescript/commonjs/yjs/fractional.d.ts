/**
 * A key that sorts after `a` and before `b` (either may be null: no bound).
 * Throws when `a >= b`.
 */
export declare function keyBetween(a: string | null, b: string | null): string;
/** Whether `key` is a well-formed fractional key. */
export declare function isFractionalKey(key: unknown): key is string;
//# sourceMappingURL=fractional.d.ts.map