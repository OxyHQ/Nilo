"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.KeepFocus = KeepFocus;
var _react = require("react");
var _reactNative = require("react-native");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * Controls that act on the text being edited. In a browser, pressing a button
 * moves focus to it — the editor loses its selection before the button runs —
 * so the press's default (`mousedown` focusing) is prevented, as every web
 * editor's toolbar does. Text fields inside still take focus.
 */
function KeepFocus({
  children,
  style,
  owner
}) {
  const previous = (0, _react.useRef)(null);
  const attach = (0, _react.useCallback)(node => {
    if (previous.current) owner?.controlHosts.delete(previous.current);
    previous.current = node;
    if (node) owner?.controlHosts.add(node);
  }, [owner]);
  return (
    /*#__PURE__*/
    // biome-ignore lint/a11y/noStaticElementInteractions: not a control; it keeps the buttons inside from taking focus.
    (0, _jsxRuntime.jsx)("div", {
      role: "presentation",
      style: {
        display: 'contents'
      },
      onMouseDown: event => {
        const target = event.target;
        if (!target.closest('input, textarea, [contenteditable="true"]')) event.preventDefault();
      },
      children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
        ref: attach,
        style: style,
        children: children
      })
    })
  );
}
//# sourceMappingURL=KeepFocus.web.js.map