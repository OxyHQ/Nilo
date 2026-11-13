"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.CodeLanguageMenu = CodeLanguageMenu;
var _react = require("react");
var _reactNative = require("react-native");
var _commands = require("../model/commands.js");
var _context = require("./context.js");
var _uiStore = require("./ui-store.js");
var _jsxRuntime = require("react/jsx-runtime");
/** The languages a code block can be in, searchable; choosing one sets its `language`. */
function CodeLanguageMenu() {
  const {
    store,
    ui,
    theme,
    labels,
    codeLanguages
  } = (0, _context.useEditorContext)();
  const id = (0, _uiStore.useUi)(ui, s => s.codeLanguageMenu);
  const [query, setQuery] = (0, _react.useState)('');
  const matches = (0, _react.useMemo)(() => {
    const q = query.trim().toLocaleLowerCase();
    const all = codeLanguages ?? [];
    return q ? all.filter(l => l.label.toLocaleLowerCase().includes(q) || l.id.toLocaleLowerCase().includes(q)) : all;
  }, [codeLanguages, query]);
  const block = id === null ? undefined : store.doc.blocks[id];
  if (id === null || !block || !codeLanguages) return null;
  const close = () => {
    setQuery('');
    ui.set({
      codeLanguageMenu: null
    });
  };
  const current = block.props.language;
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Modal, {
    transparent: true,
    visible: true,
    animationType: "none",
    onRequestClose: close,
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
      style: styles.backdrop,
      onPress: close,
      accessibilityLabel: labels.codeLanguage,
      children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.Pressable, {
        style: [styles.sheet, {
          backgroundColor: theme.background,
          borderColor: theme.border
        }],
        accessibilityRole: "menu",
        children: [/*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.TextInput, {
          autoFocus: true,
          value: query,
          onChangeText: setQuery,
          onSubmitEditing: () => {
            const first = matches[0];
            if (!first) return;
            close();
            store.sealHistory();
            store.run(c => (0, _commands.setProps)(c, id, {
              language: first.id
            }));
          },
          placeholder: labels.codeLanguageSearch,
          placeholderTextColor: theme.textMuted,
          accessibilityLabel: labels.codeLanguageSearch,
          autoCapitalize: "none",
          autoCorrect: false,
          style: [styles.search, {
            color: theme.text,
            borderColor: theme.border
          }]
        }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.ScrollView, {
          keyboardShouldPersistTaps: "always",
          children: matches.map(language => {
            const active = language.id === current;
            return /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
              accessibilityRole: "menuitem",
              accessibilityState: {
                selected: active
              },
              "aria-selected": active,
              onPress: () => {
                close();
                store.sealHistory();
                store.run(c => (0, _commands.setProps)(c, id, {
                  language: language.id
                }));
              },
              style: ({
                pressed
              }) => [styles.item, (pressed || active) && {
                backgroundColor: theme.selection
              }],
              children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
                style: [styles.itemText, {
                  color: theme.text
                }],
                children: language.label
              })
            }, language.id);
          })
        })]
      })
    })
  });
}
const styles = _reactNative.StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
    padding: 16
  },
  sheet: {
    width: '100%',
    maxWidth: 280,
    maxHeight: '70%',
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 6
  },
  search: {
    height: 32,
    marginHorizontal: 8,
    marginBottom: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 6,
    fontSize: 14
  },
  item: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginHorizontal: 6,
    borderRadius: 6
  },
  itemText: {
    fontSize: 14
  }
});
//# sourceMappingURL=CodeLanguageMenu.js.map