import type { PastedImage } from '@oxy.so/bloom-text';
import { type ReactNode } from 'react';
import type { MentionMark } from '@oxy.so/bloom-text/model';
import { type StyleProp, type ViewStyle } from 'react-native';
import type { BlockId } from '../model/document.js';
import type { SlashMenuItem } from './context.js';
import type { EditorStore } from '../model/store.js';
import { type EditorController } from './controller.js';
import { type BlockAction, type BlockRenderer, type CodeHighlighter, type CodeLanguage, type ConfirmRemove, type FormatAction, type InlineEquations, type PasteTextInput, type MentionSource } from './context.js';
import type { BlockDecorations } from './decorations.js';
import { type EditorLabels } from './labels.js';
import { type EditorTheme } from './theme.js';
export interface BlockEditorProps {
    store: EditorStore;
    /** Items of the `/` menu (and of "Turn into"), localized by the app. */
    slashItems: readonly SlashMenuItem[];
    /** Runs a slash item whose action is `custom` (upload an image, add a database). */
    onSlashAction?: (id: string, blockId: BlockId) => void;
    /** Renderers for block types the editor does not draw (media, embeds, app blocks). */
    renderers?: Readonly<Record<string, BlockRenderer>>;
    /**
     * Markers drawn beside a text block in place of the editor's own, by type
     * (a callout's icon from the app's icon set).
     */
    markers?: Readonly<Record<string, BlockRenderer>>;
    /** The application's own entries in each block's menu, listed first. */
    blockActions?: readonly BlockAction[];
    /** Per-block marks the application changes often (collaborators' carets). */
    decorations?: BlockDecorations;
    /** Mentions: the indicators that open the menu, and where to look matches up. */
    mentions?: MentionSource;
    /** Follow a link from its popover; opens it with `Linking` by default. */
    onOpenLink?: (href: string) => void;
    /** Follow a mention from its popover (open the page, show the person). */
    onOpenMention?: (mention: MentionMark, text: string) => void;
    /**
     * Copy a link to a block (the app knows its URL): the block menu offers
     * "Copy link to block" when given.
     */
    onCopyBlockLink?: (blockId: BlockId) => void;
    /** Web whole-block clipboard failure. Cut keeps both blocks and selection. */
    onClipboardError?: (reason: 'unsupported-cut' | 'write-failed' | 'changed-cut') => void;
    /**
     * Images pasted into a block's text (a screenshot, a copied picture), for
     * the app to upload and insert after `blockId`: `blob:` URLs on web, file
     * URIs on native. Without it, pasted images are ignored.
     */
    onPasteImages?: (images: PastedImage[], blockId: BlockId) => void;
    /** The languages a code block offers in its language menu (stored as `props.language`). */
    codeLanguages?: readonly CodeLanguage[];
    /** Highlights code blocks while they are not being edited. */
    highlightCode?: CodeHighlighter;
    /**
     * Typing `$$…$$` makes an inline equation: a mention whose attributes are
     * `{ kind: 'equation', latex }`, shown and followed like any mention
     * (`onOpenMention`).
     */
    inlineEquations?: InlineEquations;
    /**
     * The application's actions on selected text (comment on it), after the
     * marks in the web selection bubble and in `EditorToolbar`, while text is
     * selected.
     */
    formatActions?: readonly FormatAction[];
    /**
     * A paste into a block's text, before the editor's own handling (HTML to
     * blocks, lines to blocks): return true when the app took it, and the
     * editor pastes nothing. Web only — native inputs paste on their own and
     * the text arrives as an edit.
     */
    onPasteText?: (input: PasteTextInput) => boolean;
    /**
     * Asked before whole blocks are removed — Backspace or Delete on selected
     * blocks, cutting them, the block menu's Delete — with the blocks the
     * removal would take (each block's children go with it). Nothing is removed
     * unless it answers, or resolves to, true; a cut still copies.
     */
    confirmRemove?: ConfirmRemove;
    /**
     * The DOM id prefix of this editor's block rows on web (`blockDomId`):
     * give each surface that can show the same block as another (a synced
     * block's) its own. `'bloom-block-'` by default.
     */
    domIdPrefix?: string;
    theme?: EditorTheme;
    labels?: Partial<EditorLabels>;
    readOnly?: boolean;
    /**
     * Shared with controls drawn outside the editor (`EditorToolbar`); the
     * editor makes its own when none is given.
     */
    controller?: EditorController;
    style?: StyleProp<ViewStyle>;
}
export interface EditorSurfaceProps extends BlockEditorProps {
    /**
     * The blocks, laid out by the app: `BlockList`s of whichever ids it places
     * where it likes (a note on a canvas, a column), all over the one store.
     */
    children: ReactNode;
}
/**
 * A Notion-style block editor over an `EditorStore`, the document laid out
 * top to bottom. Every edit goes through the store's commands; the app
 * persists by listening to its transactions.
 */
export declare function BlockEditor(props: BlockEditorProps): import("react").JSX.Element;
/**
 * The editor without a layout: its context (store, menus, theme), the
 * keyboard and clipboard handling of whole-block selections, and the block
 * menu; the app lays the blocks out with `BlockList`s inside it.
 */
export declare function EditorSurface({ store, slashItems, onSlashAction, renderers, markers, blockActions, decorations, mentions, onOpenLink, onOpenMention, onCopyBlockLink, onClipboardError, onPasteImages, codeLanguages, highlightCode, inlineEquations, formatActions, onPasteText, confirmRemove, domIdPrefix, theme, labels, readOnly, controller: given, style, children, }: EditorSurfaceProps): import("react").JSX.Element;
//# sourceMappingURL=BlockEditor.d.ts.map