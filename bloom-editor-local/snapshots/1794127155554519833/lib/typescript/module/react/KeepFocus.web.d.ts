import { type ReactNode } from 'react';
import type { EditorController } from './controller.js';
import { type StyleProp, type ViewStyle } from 'react-native';
/**
 * Controls that act on the text being edited. In a browser, pressing a button
 * moves focus to it — the editor loses its selection before the button runs —
 * so the press's default (`mousedown` focusing) is prevented, as every web
 * editor's toolbar does. Text fields inside still take focus.
 */
export declare function KeepFocus({ children, style, owner, }: {
    children: ReactNode;
    owner?: EditorController;
    style?: StyleProp<ViewStyle>;
}): import("react").JSX.Element;
//# sourceMappingURL=KeepFocus.web.d.ts.map