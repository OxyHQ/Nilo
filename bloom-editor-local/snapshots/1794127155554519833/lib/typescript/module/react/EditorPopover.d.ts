import type { ReactNode } from 'react';
import type { EditorController } from './controller.js';
/** Editor focus ownership over the shared placement, material and dismiss owner. */
export declare function EditorPopover({ open, anchor, controller, label, onDismiss, children, }: {
    open: boolean;
    anchor: {
        getBoundingClientRect: () => {
            top: number;
            bottom: number;
            left: number;
            right: number;
        } | null;
    };
    controller: EditorController;
    label: string;
    onDismiss: () => void;
    children: ReactNode;
}): import("react").JSX.Element;
//# sourceMappingURL=EditorPopover.d.ts.map