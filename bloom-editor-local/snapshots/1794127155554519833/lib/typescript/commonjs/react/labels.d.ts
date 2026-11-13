/** Every string the editor draws itself. Apps pass their translations. */
export interface EditorLabels {
    placeholder: string;
    emptyHeading: string;
    emptyListItem: string;
    emptyToggle: string;
    slashNoResults: string;
    mentionNoResults: string;
    mentionSearching: string;
    slashGroups: Readonly<Record<string, string>>;
    turnInto: string;
    duplicate: string;
    delete: string;
    moveUp: string;
    moveDown: string;
    indent: string;
    outdent: string;
    color: string;
    background: string;
    /** The format bar's button for text colour and highlight. */
    textColor: string;
    /** The block menu's action that copies a link to the block (`onCopyBlockLink`). */
    copyBlockLink: string;
    /** A code block's language button and menu. */
    codeLanguage: string;
    /** The search field of the code language menu. */
    codeLanguageSearch: string;
    colorNames: Readonly<Record<string, string>>;
    bold: string;
    italic: string;
    underline: string;
    strike: string;
    code: string;
    link: string;
    linkPlaceholder: string;
    removeLink: string;
    apply: string;
    cancel: string;
    open: string;
    mention: string;
    undo: string;
    redo: string;
    formatting: string;
    blockMenu: string;
    dragHandle: string;
    addBelow: string;
    toggleOpen: string;
    toggleClosed: string;
    checkbox: string;
}
export declare const DEFAULT_LABELS: EditorLabels;
//# sourceMappingURL=labels.d.ts.map