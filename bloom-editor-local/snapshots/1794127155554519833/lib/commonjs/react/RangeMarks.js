"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.CaretFlag = CaretFlag;
exports.InlineCaret = InlineCaret;
exports.MeasuredCarets = MeasuredCarets;
exports.MeasuredHighlights = MeasuredHighlights;
exports.useMeasuredMarks = useMeasuredMarks;
var _react = require("react");
var _reactNative = require("react-native");
var _rangeDecorations = require("./range-decorations.js");
var _jsxRuntime = require("react/jsx-runtime");
const CARET_WIDTH = 2;
/** The text of the web caret's span: gives it a line box to draw its border down. */
const ZERO_WIDTH_SPACE = '\u200b';

/** A collaborator's name over their caret. */
function CaretFlag({
  label,
  color,
  textColor,
  left = 0
}) {
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
    style: [styles.flagBox, {
      left
    }],
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
      numberOfLines: 1,
      style: [styles.flag, {
        backgroundColor: color,
        color: textColor
      }],
      children: label
    })
  });
}
/**
 * A caret inside drawn text (`RunsText`), at its place in the line. On web,
 * a span of no width whose left border is the caret, as tall as the text
 * around it; on native, an inline view (React Native lays views out inside
 * text), as tall as the font.
 */
function InlineCaret({
  color,
  label,
  fontSize,
  textColor
}) {
  if (_reactNative.Platform.OS === 'web') {
    return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.Text, {
      style: [styles.inlineCaretWeb, {
        borderLeftColor: color
      }],
      children: [ZERO_WIDTH_SPACE, label ? /*#__PURE__*/(0, _jsxRuntime.jsx)(CaretFlag, {
        label: label,
        color: color,
        textColor: textColor,
        left: -CARET_WIDTH
      }) : null]
    });
  }
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
    style: [styles.inlineCaretNative, {
      height: fontSize,
      backgroundColor: color
    }],
    children: label ? /*#__PURE__*/(0, _jsxRuntime.jsx)(CaretFlag, {
      label: label,
      color: color,
      textColor: textColor
    }) : null
  });
}

/** A measured mark: its boxes on the input. */

/**
 * Web: the decorations of a block being edited, measured on its input — on
 * every change to them or to the text, and whenever the block's box changes
 * size (its lines wrap again). Empty on native, where the input measures
 * nothing, and whenever the input does not show the text the decorations
 * were made for.
 */
function useMeasuredMarks(input, host, ranges, text, active) {
  const marks = (0, _react.useMemo)(() => active ? (0, _rangeDecorations.rangeMarks)(ranges, text.length) : [], [active, ranges, text.length]);
  const [measured, setMeasured] = (0, _react.useState)([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new text moves what is measured.
  (0, _react.useLayoutEffect)(() => {
    if (marks.length === 0 || _reactNative.Platform.OS !== 'web') {
      setMeasured(current => current.length === 0 ? current : []);
      return;
    }
    let frame = 0;
    let live = true;
    const measure = () => {
      cancelAnimationFrame(frame);
      // After the input has taken the value this render gave it.
      frame = requestAnimationFrame(() => {
        const rects = input.current?.measureRanges(marks);
        setMeasured(rects ? marks.map((mark, i) => ({
          mark,
          rects: rects[i] ?? []
        })) : []);
      });
    };
    measure();
    const node = host.current;
    const observer = typeof ResizeObserver !== 'undefined' && node instanceof Element ? new ResizeObserver(measure) : null;
    if (node && observer) observer.observe(node);
    // Text drawn in a font that loads later wraps differently.
    document.fonts?.ready.then(() => {
      if (live) measure();
    });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [marks, text, input, host]);
  return measured;
}

/** Highlights measured on an input, drawn under its text. */
function MeasuredHighlights({
  marks
}) {
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_jsxRuntime.Fragment, {
    children: marks.map(({
      mark,
      rects
    }, i) => mark.kind === 'highlight' ? rects.map((rect, j) => /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View
    // biome-ignore lint/suspicious/noArrayIndexKey: marks and their boxes are positional.
    , {
      style: [styles.measured, {
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        backgroundColor: mark.color
      }]
    }, `${i}:${j}`)) : null)
  });
}

/** Carets measured on an input, drawn over its text. */
function MeasuredCarets({
  marks,
  textColor
}) {
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_jsxRuntime.Fragment, {
    children: marks.map(({
      mark,
      rects
    }, i) => {
      const rect = rects[0];
      if (mark.kind !== 'caret' || !rect) return null;
      return /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View
      // biome-ignore lint/suspicious/noArrayIndexKey: marks are positional.
      , {
        style: [styles.measured, {
          left: rect.x - CARET_WIDTH / 2,
          top: rect.y,
          width: CARET_WIDTH,
          height: rect.height,
          backgroundColor: mark.color
        }],
        children: mark.label ? /*#__PURE__*/(0, _jsxRuntime.jsx)(CaretFlag, {
          label: mark.label,
          color: mark.color,
          textColor: textColor
        }) : null
      }, i);
    })
  });
}
const styles = _reactNative.StyleSheet.create({
  // Its border is the caret; the negative margins give its width back.
  inlineCaretWeb: {
    position: 'relative',
    borderLeftWidth: CARET_WIDTH,
    marginLeft: -CARET_WIDTH / 2,
    marginRight: -CARET_WIDTH / 2
  },
  inlineCaretNative: {
    width: CARET_WIDTH
  },
  // Wide enough for a name on one line; the flag inside is as wide as its text.
  flagBox: {
    position: 'absolute',
    bottom: '100%',
    width: 240,
    flexDirection: 'row',
    pointerEvents: 'none'
  },
  flag: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    paddingHorizontal: 4,
    borderRadius: 3,
    borderBottomLeftRadius: 0,
    overflow: 'hidden'
  },
  measured: {
    position: 'absolute',
    pointerEvents: 'none'
  }
});
//# sourceMappingURL=RangeMarks.js.map