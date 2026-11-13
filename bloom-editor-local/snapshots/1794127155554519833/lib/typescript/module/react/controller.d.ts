import type { RichTextInputHandle } from '@oxy.so/bloom-text';
import { type ToggleableMark } from '@oxy.so/bloom-text/model';
import { type MentionInsert } from '../model/commands.js';
import { type BlockId } from '../model/document.js';
import type { EditorStore } from '../model/store.js';
import { UiStore } from './ui-store.js';
/**
 * What an editor and the controls around it share: its transient UI state,
 * its live inputs and the formatting commands on the current selection. An app
 * that draws controls outside `BlockEditor` (a toolbar above the keyboard)
 * creates one with `useEditorController` and passes it to both.
 */
export declare class EditorController {
    readonly store: EditorStore;
    readonly ui: UiStore;
    readonly inputs: Map<string, RichTextInputHandle>;
    readonly controlHosts: Set<unknown>;
    ownsControlFocus(target: unknown): boolean;
    private editable;
    private linkSession;
    /** A link draft is cancelled, never retargeted, when its context changes. */
    validateLinkSession(): boolean;
    setEditable(editable: boolean): void;
    cancelLinkEditor(): void;
    /** Apply only to the session opened by openLinkEditor, never a fresh range. */
    applyLinkDraft(url: string): boolean;
    constructor(store: EditorStore);
    /** The caret or range in a block's text, the one formatting acts on. */
    get textSelection(): {
        kind: "text";
        blockId: BlockId;
        start: number;
        end: number;
    } | null;
    toggleMark(mark: ToggleableMark): void;
    /** Link the selected text to `url`; false when nothing is selected or the URL is unsafe. */
    setLink(url: string): boolean;
    /** Remove the link under the selection, or the whole link the caret is in. */
    removeLink(): void;
    /**
     * Start a mention at the caret, as typing the indicator would: a mention
     * opens at the start or after a space, so one is added after a word. An
     * edit like any other — each platform's input picks the mention up from the
     * text (their own `startMention` differs: only iOS adds the space).
     */
    startMention(indicator: string): void;
    /**
     * Colour the selected text (`'default'` clears it): the text colour, or the
     * highlight behind it with `background`. False when no text is selected.
     */
    setTextColor(name: string, kind?: 'color' | 'background'): boolean;
    /** The text colour and highlight where the selected text starts. */
    textColors(): {
        color?: string;
        background?: string;
    };
    /** The link the selection is in or starts in, for the link field to show. */
    linkAtSelection(): string | null;
    /**
     * Open the link field (⌘K): for the selected text, or — at a caret inside a
     * link — for that whole link. False when there is nothing to link.
     */
    openLinkEditor(): boolean;
    /**
     * Put a mention at the selection (an inline equation an app's slash item
     * inserts, a page picked elsewhere), replacing selected text.
     */
    insertMention(mention: MentionInsert): boolean;
    /** Give the keyboard back to the selected block, with its selection. */
    refocus(): void;
}
export declare function useEditorController(store: EditorStore): EditorController;
/** A URL as typed (`example.com`) made a link, or null when it is not one we allow. */
export declare function normalizeLink(raw: string): string | null;
//# sourceMappingURL=controller.d.ts.map