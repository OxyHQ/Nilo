"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.KeepFocus = KeepFocus;
var _react = require("react");
var _reactNative = require("react-native");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * Controls that act on the text being edited. Native: pressing a button does
 * not take the keyboard from the input, so this is a plain view.
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
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
    ref: attach,
    style: style,
    children: children
  });
}
//# sourceMappingURL=KeepFocus.js.map