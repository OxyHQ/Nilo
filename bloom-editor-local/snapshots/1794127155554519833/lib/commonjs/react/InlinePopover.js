"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.InlinePopover = InlinePopover;
var _reactNative = require("react-native");
var _button = require("@oxy.so/bloom/button");
var _context = require("./context.js");
var _FormatBar = require("./FormatBar.js");
var _KeepFocus = require("./KeepFocus");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * Under a block whose caret is at a link or a mention: where it goes and a
 * way to follow it (clicking text in an editor places the caret, it does not
 * navigate), and removing a link.
 */
function InlinePopover({
  target
}) {
  const {
    theme,
    labels,
    controller,
    onOpenLink,
    onOpenMention
  } = (0, _context.useEditorContext)();
  const open = () => {
    if (target.kind === 'link') onOpenLink(target.href);else onOpenMention?.(target.mention, target.text);
  };
  const canOpen = target.kind === 'link' || onOpenMention !== undefined;
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_KeepFocus.KeepFocus, {
    owner: controller,
    style: styles.popover,
    children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
      style: [styles.what, {
        color: theme.textMuted
      }],
      numberOfLines: 1,
      children: target.kind === 'link' ? target.href : target.text
    }), target.kind === 'link' ? /*#__PURE__*/(0, _jsxRuntime.jsx)(_button.LinkButton, {
      href: target.href,
      accessibilityLabel: labels.open,
      onPress: event => {
        if (_reactNative.Platform.OS === 'web') {
          const click = event;
          if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey || click.button !== 0) return;
          click.preventDefault();
        }
        open();
      },
      children: labels.open
    }) : canOpen ? /*#__PURE__*/(0, _jsxRuntime.jsx)(_FormatBar.BarButton, {
      label: labels.open,
      theme: theme,
      onPress: open,
      children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
        style: [styles.word, {
          color: theme.accent
        }],
        children: labels.open
      })
    }) : null, target.kind === 'link' ? /*#__PURE__*/(0, _jsxRuntime.jsx)(_FormatBar.BarButton, {
      label: labels.removeLink,
      theme: theme,
      onPress: () => controller.removeLink(),
      children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
        style: [styles.word, {
          color: theme.textMuted
        }],
        children: labels.removeLink
      })
    }) : null]
  });
}
const styles = _reactNative.StyleSheet.create({
  popover: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4
  },
  what: {
    flexShrink: 1,
    fontSize: 13,
    marginRight: 4
  },
  word: {
    fontSize: 13
  }
});
//# sourceMappingURL=InlinePopover.js.map