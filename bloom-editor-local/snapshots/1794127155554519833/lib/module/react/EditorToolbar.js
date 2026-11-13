"use strict";

import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScrollArea } from '@oxy.so/bloom/layout';
import { indent, outdent } from "../model/commands.js";
import { BarButton, FormatBar } from "./FormatBar.js";
import { KeepFocus } from './KeepFocus';
import { DEFAULT_LABELS } from "./labels.js";
import { DEFAULT_THEME } from "./theme.js";
import { useUi } from "./ui-store.js";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The editing toolbar a touch device needs where there are no shortcuts:
 * marks, link, the block's menu, mention, indent, outdent, undo and redo for
 * the block being edited. Shown while a block has the keyboard; the app places it (above the
 * keyboard) and passes the same controller as `BlockEditor`.
 */
export function EditorToolbar({
  controller,
  theme = DEFAULT_THEME,
  labels,
  mentionIndicator,
  style
}) {
  const merged = {
    ...DEFAULT_LABELS,
    ...labels
  };
  const {
    store,
    ui
  } = controller;
  const focused = useUi(ui, s => s.focused);
  const linking = useUi(ui, s => s.linking);
  const selection = useSyncExternalStore(store.subscribe, () => controller.textSelection);
  const canUndo = useSyncExternalStore(store.subscribe, () => store.getSnapshot().canUndo);
  const canRedo = useSyncExternalStore(store.subscribe, () => store.getSnapshot().canRedo);
  if (!focused && !linking || !selection) return null;
  const blockId = selection.blockId;
  const run = command => {
    store.sealHistory();
    store.run(command);
  };
  return /*#__PURE__*/_jsx(View, {
    accessibilityRole: "toolbar",
    accessibilityLabel: merged.formatting,
    style: [styles.bar, {
      backgroundColor: theme.background,
      borderTopColor: theme.border
    }, style],
    children: /*#__PURE__*/_jsxs(ScrollArea, {
      horizontal: true,
      keyboardShouldPersistTaps: "always",
      contentContainerStyle: styles.content,
      children: [/*#__PURE__*/_jsx(FormatBar, {
        controller: controller,
        theme: theme,
        labels: merged
      }), linking ? null : /*#__PURE__*/_jsxs(KeepFocus, {
        owner: controller,
        style: styles.row,
        children: [/*#__PURE__*/_jsx(View, {
          style: [styles.separator, {
            backgroundColor: theme.border
          }]
        }), /*#__PURE__*/_jsx(BarButton, {
          label: merged.blockMenu,
          theme: theme,
          onPress: () => ui.set({
            blockMenu: blockId
          }),
          children: /*#__PURE__*/_jsx(Text, {
            style: [styles.glyph, {
              color: theme.text
            }],
            children: "\u22EE\u22EE"
          })
        }), mentionIndicator ? /*#__PURE__*/_jsx(BarButton, {
          label: merged.mention,
          theme: theme,
          onPress: () => controller.startMention(mentionIndicator),
          children: /*#__PURE__*/_jsx(Text, {
            style: [styles.glyph, {
              color: theme.text
            }],
            children: mentionIndicator
          })
        }) : null, /*#__PURE__*/_jsx(BarButton, {
          label: merged.outdent,
          theme: theme,
          onPress: () => run(c => outdent(c, blockId)),
          children: /*#__PURE__*/_jsx(Text, {
            style: [styles.glyph, {
              color: theme.text
            }],
            children: "\u21E4"
          })
        }), /*#__PURE__*/_jsx(BarButton, {
          label: merged.indent,
          theme: theme,
          onPress: () => run(c => indent(c, blockId)),
          children: /*#__PURE__*/_jsx(Text, {
            style: [styles.glyph, {
              color: theme.text
            }],
            children: "\u21E5"
          })
        }), /*#__PURE__*/_jsx(BarButton, {
          label: merged.undo,
          theme: theme,
          disabled: !canUndo,
          onPress: () => store.undo(),
          children: /*#__PURE__*/_jsx(Text, {
            style: [styles.glyph, {
              color: theme.text
            }],
            children: "\u21B6"
          })
        }), /*#__PURE__*/_jsx(BarButton, {
          label: merged.redo,
          theme: theme,
          disabled: !canRedo,
          onPress: () => store.redo(),
          children: /*#__PURE__*/_jsx(Text, {
            style: [styles.glyph, {
              color: theme.text
            }],
            children: "\u21B7"
          })
        })]
      })]
    })
  });
}
const styles = StyleSheet.create({
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  separator: {
    width: StyleSheet.hairlineWidth,
    height: 20,
    marginHorizontal: 6
  },
  glyph: {
    fontSize: 16
  }
});
//# sourceMappingURL=EditorToolbar.js.map