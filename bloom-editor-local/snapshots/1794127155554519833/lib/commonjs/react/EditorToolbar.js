"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.EditorToolbar = EditorToolbar;
var _react = require("react");
var _reactNative = require("react-native");
var _layout = require("@oxy.so/bloom/layout");
var _commands = require("../model/commands.js");
var _FormatBar = require("./FormatBar.js");
var _KeepFocus = require("./KeepFocus");
var _labels = require("./labels.js");
var _theme = require("./theme.js");
var _uiStore = require("./ui-store.js");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * The editing toolbar a touch device needs where there are no shortcuts:
 * marks, link, the block's menu, mention, indent, outdent, undo and redo for
 * the block being edited. Shown while a block has the keyboard; the app places it (above the
 * keyboard) and passes the same controller as `BlockEditor`.
 */
function EditorToolbar({
  controller,
  theme = _theme.DEFAULT_THEME,
  labels,
  mentionIndicator,
  style
}) {
  const merged = {
    ..._labels.DEFAULT_LABELS,
    ...labels
  };
  const {
    store,
    ui
  } = controller;
  const focused = (0, _uiStore.useUi)(ui, s => s.focused);
  const linking = (0, _uiStore.useUi)(ui, s => s.linking);
  const selection = (0, _react.useSyncExternalStore)(store.subscribe, () => controller.textSelection);
  const canUndo = (0, _react.useSyncExternalStore)(store.subscribe, () => store.getSnapshot().canUndo);
  const canRedo = (0, _react.useSyncExternalStore)(store.subscribe, () => store.getSnapshot().canRedo);
  if (!focused && !linking || !selection) return null;
  const blockId = selection.blockId;
  const run = command => {
    store.sealHistory();
    store.run(command);
  };
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
    accessibilityRole: "toolbar",
    accessibilityLabel: merged.formatting,
    style: [styles.bar, {
      backgroundColor: theme.background,
      borderTopColor: theme.border
    }, style],
    children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(_layout.ScrollArea, {
      horizontal: true,
      keyboardShouldPersistTaps: "always",
      contentContainerStyle: styles.content,
      children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_FormatBar.FormatBar, {
        controller: controller,
        theme: theme,
        labels: merged
      }), linking ? null : /*#__PURE__*/(0, _jsxRuntime.jsxs)(_KeepFocus.KeepFocus, {
        owner: controller,
        style: styles.row,
        children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
          style: [styles.separator, {
            backgroundColor: theme.border
          }]
        }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_FormatBar.BarButton, {
          label: merged.blockMenu,
          theme: theme,
          onPress: () => ui.set({
            blockMenu: blockId
          }),
          children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
            style: [styles.glyph, {
              color: theme.text
            }],
            children: "\u22EE\u22EE"
          })
        }), mentionIndicator ? /*#__PURE__*/(0, _jsxRuntime.jsx)(_FormatBar.BarButton, {
          label: merged.mention,
          theme: theme,
          onPress: () => controller.startMention(mentionIndicator),
          children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
            style: [styles.glyph, {
              color: theme.text
            }],
            children: mentionIndicator
          })
        }) : null, /*#__PURE__*/(0, _jsxRuntime.jsx)(_FormatBar.BarButton, {
          label: merged.outdent,
          theme: theme,
          onPress: () => run(c => (0, _commands.outdent)(c, blockId)),
          children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
            style: [styles.glyph, {
              color: theme.text
            }],
            children: "\u21E4"
          })
        }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_FormatBar.BarButton, {
          label: merged.indent,
          theme: theme,
          onPress: () => run(c => (0, _commands.indent)(c, blockId)),
          children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
            style: [styles.glyph, {
              color: theme.text
            }],
            children: "\u21E5"
          })
        }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_FormatBar.BarButton, {
          label: merged.undo,
          theme: theme,
          disabled: !canUndo,
          onPress: () => store.undo(),
          children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
            style: [styles.glyph, {
              color: theme.text
            }],
            children: "\u21B6"
          })
        }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_FormatBar.BarButton, {
          label: merged.redo,
          theme: theme,
          disabled: !canRedo,
          onPress: () => store.redo(),
          children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
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
const styles = _reactNative.StyleSheet.create({
  bar: {
    borderTopWidth: _reactNative.StyleSheet.hairlineWidth
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
    width: _reactNative.StyleSheet.hairlineWidth,
    height: 20,
    marginHorizontal: 6
  },
  glyph: {
    fontSize: 16
  }
});
//# sourceMappingURL=EditorToolbar.js.map