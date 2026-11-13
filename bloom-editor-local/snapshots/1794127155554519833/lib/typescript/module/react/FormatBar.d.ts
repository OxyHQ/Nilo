import { type TextStyle } from 'react-native';
import type { EditorController } from './controller.js';
import type { EditorLabels } from './labels.js';
import { type EditorTheme } from './theme.js';
export interface FormatBarProps {
    controller: EditorController;
    theme: EditorTheme;
    labels: EditorLabels;
}
/**
 * The marks and the link of the selected text: buttons that show what is
 * active and toggle it, and the link field. Used by the bubble over a
 * selection (web) and by `EditorToolbar`.
 */
export declare function FormatBar({ controller, theme, labels }: FormatBarProps): import("react").JSX.Element;
export declare function BarButton({ label, active, disabled, theme: _theme, textStyle, onPress, children, }: {
    label: string;
    active?: boolean;
    disabled?: boolean;
    theme: EditorTheme;
    textStyle?: TextStyle;
    onPress: () => void;
    children: React.ReactNode;
}): import("react").JSX.Element;
//# sourceMappingURL=FormatBar.d.ts.map