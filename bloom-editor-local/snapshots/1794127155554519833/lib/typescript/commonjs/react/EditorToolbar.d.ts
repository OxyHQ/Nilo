import { type StyleProp, type ViewStyle } from 'react-native';
import type { EditorController } from './controller';
import { type EditorLabels } from './labels';
import { type EditorTheme } from './theme';
export interface EditorToolbarProps {
    controller: EditorController;
    theme?: EditorTheme;
    labels?: Partial<EditorLabels>;
    /** Offer a mention button that types this indicator (the one `mentions` listens for). */
    mentionIndicator?: string;
    style?: StyleProp<ViewStyle>;
}
/**
 * The editing toolbar a touch device needs where there are no shortcuts:
 * marks, link, the block's menu, mention, indent, outdent, undo and redo for
 * the block being edited. Shown while a block has the keyboard; the app places it (above the
 * keyboard) and passes the same controller as `BlockEditor`.
 */
export declare function EditorToolbar({ controller, theme, labels, mentionIndicator, style, }: EditorToolbarProps): import("react").JSX.Element | null;
//# sourceMappingURL=EditorToolbar.d.ts.map