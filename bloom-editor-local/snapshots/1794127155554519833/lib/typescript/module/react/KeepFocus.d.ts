import { type ReactNode } from 'react';
import type { EditorController } from './controller.js';
import { type StyleProp, type ViewStyle } from 'react-native';
/**
 * Controls that act on the text being edited. Native: pressing a button does
 * not take the keyboard from the input, so this is a plain view.
 */
export declare function KeepFocus({ children, style, owner, }: {
    children: ReactNode;
    owner?: EditorController;
    style?: StyleProp<ViewStyle>;
}): import("react").JSX.Element;
//# sourceMappingURL=KeepFocus.d.ts.map