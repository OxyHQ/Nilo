"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.BarButton = BarButton;
exports.FormatBar = FormatBar;
var _react = require("react");
var _reactNative = require("react-native");
var _button = require("@oxy.so/bloom/button");
var _textField = require("@oxy.so/bloom/text-field");
var _KeepFocus = require("./KeepFocus");
var _theme2 = require("./theme.js");
var _uiStore = require("./ui-store.js");
var _jsxRuntime = require("react/jsx-runtime");
const MARKS = [{
  mark: 'bold',
  glyph: 'B',
  style: {
    fontWeight: '700'
  }
}, {
  mark: 'italic',
  glyph: 'I',
  style: {
    fontStyle: 'italic'
  }
}, {
  mark: 'underline',
  glyph: 'U',
  style: {
    textDecorationLine: 'underline'
  }
}, {
  mark: 'strike',
  glyph: 'S',
  style: {
    textDecorationLine: 'line-through'
  }
}, {
  mark: 'code',
  glyph: '</>',
  style: {}
}];
/**
 * The marks and the link of the selected text: buttons that show what is
 * active and toggle it, and the link field. Used by the bubble over a
 * selection (web) and by `EditorToolbar`.
 */
function FormatBar({
  controller,
  theme,
  labels
}) {
  const {
    ui,
    store
  } = controller;
  const selection = (0, _react.useSyncExternalStore)(store.subscribe, () => controller.textSelection);
  const marks = (0, _uiStore.useUi)(ui, s => s.marks && s.marks.blockId === selection?.blockId ? s.marks.marks : null);
  const linking = (0, _uiStore.useUi)(ui, s => s.linking);
  const formatActions = (0, _uiStore.useUi)(ui, s => s.formatActions);
  const [url, setUrl] = (0, _react.useState)('');
  const [invalid, setInvalid] = (0, _react.useState)(false);
  const [palette, setPalette] = (0, _react.useState)(false);
  // The colours where the selection starts, for the palette to show.
  const colors = (0, _react.useSyncExternalStore)(store.subscribe, () => {
    const {
      color,
      background
    } = controller.textColors();
    return `${color ?? 'default'}|${background ?? 'default'}`;
  });
  const [currentColor, currentBackground] = colors.split('|');
  const hasRange = selection !== null && selection.start !== selection.end;
  const editingLink = linking !== null && selection?.blockId === linking;

  // The link field opens on the link already there (⌘K on a link edits it).
  (0, _react.useEffect)(() => {
    setUrl(editingLink ? controller.linkAtSelection() ?? '' : '');
    setInvalid(false);
  }, [editingLink, controller]);
  // A collapsed selection has nothing to colour.
  (0, _react.useEffect)(() => {
    if (!hasRange) setPalette(false);
  }, [hasRange]);
  const closeLink = refocus => {
    controller.cancelLinkEditor();
    setUrl('');
    setInvalid(false);
    if (refocus) controller.refocus();
  };
  if (editingLink) {
    const apply = () => {
      if (controller.applyLinkDraft(url)) closeLink(true);else setInvalid(true);
    };
    return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_KeepFocus.KeepFocus, {
      owner: controller,
      style: [styles.row, styles.wrap],
      children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_textField.TextFieldInput, {
        autoFocus: true,
        label: labels.link,
        invalid: invalid,
        value: url,
        onChangeText: next => {
          setUrl(next);
          setInvalid(false);
        },
        onSubmitEditing: apply,
        onKeyPress: e => {
          if (e.nativeEvent.key === 'Escape') closeLink(true);
        },
        placeholder: labels.linkPlaceholder,
        placeholderTextColor: theme.textMuted,
        autoCapitalize: "none",
        autoCorrect: false,
        keyboardType: "url",
        inputMode: "url",
        accessibilityLabel: labels.link,
        "aria-invalid": invalid,
        style: [styles.field, {
          color: theme.text,
          borderColor: invalid ? theme.colors.red?.text : theme.border
        }]
      }), /*#__PURE__*/(0, _jsxRuntime.jsxs)(_KeepFocus.KeepFocus, {
        owner: controller,
        style: styles.row,
        children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(BarButton, {
          label: labels.apply,
          theme: theme,
          onPress: apply,
          children: labels.apply
        }), /*#__PURE__*/(0, _jsxRuntime.jsx)(BarButton, {
          label: labels.cancel,
          theme: theme,
          onPress: () => closeLink(true),
          children: labels.cancel
        })]
      })]
    });
  }
  if (palette && hasRange) {
    const choose = (name, kind) => {
      controller.setTextColor(name, kind);
      setPalette(false);
    };
    return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_KeepFocus.KeepFocus, {
      owner: controller,
      style: styles.palette,
      children: [/*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.View, {
        style: [styles.row, styles.wrap],
        children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
          style: [styles.paletteLabel, {
            color: theme.textMuted
          }],
          children: labels.color
        }), _theme2.BLOCK_COLOR_NAMES.map(name => /*#__PURE__*/(0, _jsxRuntime.jsx)(BarButton, {
          label: `${labels.color}: ${labels.colorNames[name] ?? name}`,
          active: currentColor === name,
          theme: theme,
          onPress: () => choose(name, 'color'),
          children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
            style: [styles.swatchGlyph, {
              color: name === 'default' ? theme.text : theme.colors[name]?.text
            }],
            children: "A"
          })
        }, `c-${name}`))]
      }), /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.View, {
        style: [styles.row, styles.wrap],
        children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
          style: [styles.paletteLabel, {
            color: theme.textMuted
          }],
          children: labels.background
        }), _theme2.BLOCK_COLOR_NAMES.map(name => /*#__PURE__*/(0, _jsxRuntime.jsx)(BarButton, {
          label: `${labels.background}: ${labels.colorNames[name] ?? name}`,
          active: currentBackground === name,
          theme: theme,
          onPress: () => choose(name, 'background'),
          children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
            style: [styles.swatch, {
              borderColor: theme.border,
              backgroundColor: theme.colors[name]?.background ?? theme.background
            }]
          })
        }, `b-${name}`))]
      })]
    });
  }
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_KeepFocus.KeepFocus, {
    owner: controller,
    style: styles.row,
    children: [MARKS.map(({
      mark,
      glyph,
      style
    }) => /*#__PURE__*/(0, _jsxRuntime.jsx)(BarButton, {
      label: labels[mark],
      active: marks?.[mark] === true,
      theme: theme,
      textStyle: style,
      onPress: () => controller.toggleMark(mark),
      children: glyph
    }, mark)), /*#__PURE__*/(0, _jsxRuntime.jsx)(BarButton, {
      label: marks?.link ? labels.removeLink : labels.link,
      active: marks?.link === true,
      disabled: !marks?.link && !hasRange,
      theme: theme,
      onPress: () => {
        if (marks?.link) controller.removeLink();else controller.openLinkEditor();
      },
      children: labels.link
    }), /*#__PURE__*/(0, _jsxRuntime.jsx)(BarButton, {
      label: labels.textColor,
      active: currentColor !== 'default' || currentBackground !== 'default',
      disabled: !hasRange,
      theme: theme,
      onPress: () => setPalette(true),
      children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
        style: [styles.glyph, styles.colorGlyph, {
          color: currentColor !== undefined && currentColor !== 'default' ? theme.colors[currentColor]?.text : theme.text,
          borderBottomColor: currentBackground !== undefined && currentBackground !== 'default' ? theme.colors[currentBackground]?.text : theme.textMuted
        }],
        children: "A"
      })
    }), hasRange && formatActions.length > 0 ? /*#__PURE__*/(0, _jsxRuntime.jsxs)(_jsxRuntime.Fragment, {
      children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
        style: [styles.separator, {
          backgroundColor: theme.border
        }]
      }), formatActions.map(action => /*#__PURE__*/(0, _jsxRuntime.jsx)(BarButton, {
        label: action.label,
        theme: theme,
        onPress: () => {
          const current = controller.textSelection;
          if (!current || current.start === current.end) return;
          action.onPress({
            blockId: current.blockId,
            start: Math.min(current.start, current.end),
            end: Math.max(current.start, current.end)
          });
        },
        children: action.icon ? action.icon({
          color: theme.text,
          size: ICON_SIZE
        }) : action.label
      }, action.id))]
    }) : null]
  });
}

/** The size an application's format action draws its icon at. */
const ICON_SIZE = 16;
function BarButton({
  label,
  active,
  disabled = false,
  theme: _theme,
  textStyle,
  onPress,
  children
}) {
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_button.Button, {
    appearance: "plain",
    material: "flat",
    accessibilityRole: "button",
    accessibilityLabel: label,
    pressed: active,
    textStyle: textStyle,
    disabled: disabled,
    onPress: onPress,
    children: children
  });
}
const styles = _reactNative.StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    minWidth: 0
  },
  wrap: {
    flexWrap: 'wrap',
    gap: 4,
    minWidth: 0
  },
  glyph: {
    fontSize: 15
  },
  colorGlyph: {
    fontWeight: '600',
    borderBottomWidth: 2,
    lineHeight: 18
  },
  palette: {
    gap: 2
  },
  paletteLabel: {
    fontWeight: '600',
    width: '100%'
  },
  swatchGlyph: {
    fontSize: 15,
    fontWeight: '600'
  },
  swatch: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1
  },
  word: {
    fontSize: 14
  },
  separator: {
    width: _reactNative.StyleSheet.hairlineWidth,
    height: 20,
    marginHorizontal: 4
  },
  field: {
    flexGrow: 1,
    flexBasis: 160,
    minWidth: 0
  }
});
//# sourceMappingURL=FormatBar.js.map