"use strict";

import { useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { decorateRuns } from "./range-decorations.js";
import { InlineCaret } from "./RangeMarks.js";
import { jsx as _jsx } from "react/jsx-runtime";
/** The font the input draws inline code in, where the theme names none. */
export const MONO_FONT = Platform.select({
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
const INPUT_DEFAULT_FONT = Platform.OS === 'web' ? 'inherit' : undefined;

/** The font size a caret is drawn at where the text style names none. */
const DEFAULT_FONT_SIZE = 16;

/**
 * Runs drawn over a block's input while it is not being edited (the input
 * stays below, invisible, and still takes the press that starts editing),
 * with the application's highlights and carets laid in.
 */
export function RunsText({
  runs,
  ranges,
  textStyle,
  flagTextColor,
  style
}) {
  const items = useMemo(() => decorateRuns(runs, ranges), [runs, ranges]);
  return /*#__PURE__*/_jsx(View, {
    pointerEvents: "none",
    accessibilityElementsHidden: true,
    importantForAccessibility: "no-hide-descendants",
    "aria-hidden": true,
    style: [StyleSheet.absoluteFill, style],
    children: /*#__PURE__*/_jsx(Text, {
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
      _jsx(Text, {
        style: item.style,
        children: item.text
      }, index) : /*#__PURE__*/_jsx(InlineCaret
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