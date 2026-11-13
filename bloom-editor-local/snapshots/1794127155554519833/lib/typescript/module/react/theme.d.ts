/**
 * The editor's look, passed in by the app (from its design system) so the
 * editor depends on no theme provider.
 */
export interface BlockColor {
    /** Text colour for the "color" mark and block colour. */
    text: string;
    /** Background for the "background" mark and block background. */
    background: string;
}
export interface EditorTheme {
    text: string;
    textMuted: string;
    background: string;
    border: string;
    /** Accent for focus, links, checked boxes. */
    accent: string;
    accentText: string;
    /** Background behind selected blocks and the drop indicator. */
    selection: string;
    codeBackground: string;
    /** Named colours (`gray`, `brown`, `orange`, …) for marks and blocks. */
    colors: Readonly<Record<string, BlockColor>>;
    fontFamily?: string;
    /** Multiplies every text size and line height: Notion's "Small text" is 0.875. */
    textScale?: number;
    monoFontFamily?: string;
}
/** Notion's ten colours. */
export declare const BLOCK_COLOR_NAMES: readonly ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
/** The named colours for a light or dark surface. */
export declare function blockColors(scheme: 'light' | 'dark'): Record<string, BlockColor>;
export declare const DEFAULT_THEME: EditorTheme;
//# sourceMappingURL=theme.d.ts.map