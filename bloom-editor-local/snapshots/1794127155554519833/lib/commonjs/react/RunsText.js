"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MONO_FONT = void 0;
exports.RunsText = RunsText;
var _react = require("react");
var _reactNative = require("react-native");
var _rangeDecorations = require("./range-decorations.js");
var _RangeMarks = require("./RangeMarks.js");
var _jsxRuntime = require("react/jsx-runtime");
/** The font the input draws inline code in, where the theme names none. */
const MONO_FONT = exports.MONO_FONT = _reactNative.Platform.select({
  ios: 'Menlo',
  default: 'monospace'
});

/**
 * The font text is drawn in where the text style names none: the input's own.
 * On web the input's editing surface inherits the page's font, while a
 * react-native-web `Text` sets a system font of its own — the drawn text
 * would be wider or narrower than the text under it, and every highlight and
 * caret off by the difference. Native inputs and `Text` share the system font.
 */
const INPUT_DEFAULT_FONT = _reactNative.Platform.OS === 'web' ? 'inherit' : undefined;

/** The font size a caret is drawn at where the text style names none. */
const DEFAULT_FONT_SIZE = 16;

/**
 * Runs drawn over a block's input while it is not being edited (the input
 * stays below, invisible, and still takes the press that starts editing),
 * with the application's highlights and carets laid in.
 */
function RunsText({
  runs,
  ranges,
  textStyle,
  flagTextColor,
  style
}) {
  const items = (0, _react.useMemo)(() => (0, _rangeDecorations.decorateRuns)(runs, ranges), [runs, ranges]);
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
    pointerEvents: "none",
    accessibilityElementsHidden: true,
    importantForAccessibility: "no-hide-descendants",
    "aria-hidden": true,
    style: [_reactNative.StyleSheet.absoluteFill, style],
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
      style: {
        color: textStyle.color,
        fontSize: textStyle.fontSize,
        lineHeight: textStyle.lineHeight,
        fontFamily: textStyle.fontFamily ?? INPUT_DEFAULT_FONT,
        fontWeight: textStyle.fontWeight
      },
      children: items.map((item, index) =>
      // Runs have no identity beyond their place in the text.
      item.kind === 'text' ?
      /*#__PURE__*/
      // biome-ignore lint/suspicious/noArrayIndexKey: the runs are the text, in order.
      (0, _jsxRuntime.jsx)(_reactNative.Text, {
        style: item.style,
        children: item.text
      }, index) : /*#__PURE__*/(0, _jsxRuntime.jsx)(_RangeMarks.InlineCaret
      // biome-ignore lint/suspicious/noArrayIndexKey: carets are placed by position.
      , {
        color: item.color,
        label: item.label,
        fontSize: textStyle.fontSize ?? DEFAULT_FONT_SIZE,
        textColor: flagTextColor
      }, index))
    })
  });
}
//# sourceMappingURL=RunsText.js.map