"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.EditorPopover = EditorPopover;
var _reactNative = require("react-native");
var _popover = require("@oxy.so/bloom/popover");
var _jsxRuntime = require("react/jsx-runtime");
/** Editor focus ownership over the shared placement, material and dismiss owner. */
function EditorPopover({
  open,
  anchor,
  controller,
  label,
  onDismiss,
  children
}) {
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_popover.Popover, {
    open: open,
    modal: false,
    onOpenChange: next => {
      if (next) return;
      const owned = _reactNative.Platform.OS === 'web' && controller.ownsControlFocus(document.activeElement);
      controller.cancelLinkEditor();
      onDismiss();
      if (owned) controller.refocus();
    },
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_popover.PopoverContent, {
      virtualAnchor: anchor,
      side: "top",
      align: "start",
      label: label,
      minWidth: 0,
      maxWidth: 360,
      maxHeight: 320,
      children: children
    })
  });
}
//# sourceMappingURL=EditorPopover.js.map