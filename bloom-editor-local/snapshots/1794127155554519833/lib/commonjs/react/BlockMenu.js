"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.BlockMenu = BlockMenu;
var _react = require("react");
var _reactNative = require("react-native");
var _commands = require("../model/commands.js");
var _document = require("../model/document.js");
var _schema = require("../model/schema.js");
var _context = require("./context.js");
var _theme = require("./theme.js");
var _uiStore = require("./ui-store.js");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * Whether `block` is what turning it into `action` would make it. A heading
 * and a toggle heading share a type; the prop that lets one hold children
 * (`childrenWhen`) tells them apart, and nothing else does (a collapsed
 * toggle heading is still one).
 */function isCurrent(schema, block, action) {
  if (block.type !== action.type) return false;
  const key = (0, _schema.specOf)(schema, action.type).childrenWhen;
  return !key || Boolean(action.props?.[key]) === Boolean(block.props[key]);
}

/**
 * Options for a block — turn into, colours, duplicate, move, delete — and,
 * when it is one of the selected blocks, for all of them.
 */
function BlockMenu() {
  const {
    store,
    ui,
    theme,
    labels,
    slashItems,
    blockActions,
    onCopyBlockLink,
    requestRemove
  } = (0, _context.useEditorContext)();
  const id = (0, _uiStore.useUi)(ui, s => s.blockMenu);
  const selected = (0, _uiStore.useUi)(ui, s => s.selectedBlocks);
  const turnIntoItems = (0, _react.useMemo)(() => slashItems.filter(item => item.action.kind === 'block'), [slashItems]);
  const close = () => ui.set({
    blockMenu: null
  });
  if (id === null || !store.doc.blocks[id]) return null;
  const block = store.doc.blocks[id];
  if (!block) return null;
  const act = command => {
    close();
    store.sealHistory();
    store.run(command);
  };
  const targets = selected.includes(id) ? selected.filter(b => store.doc.blocks[b]) : [id];
  const many = targets.length > 1;
  const {
    parent,
    index
  } = (0, _document.positionOf)(store.doc, id);
  const siblings = (0, _document.childrenOf)(store.doc, parent);
  const before = siblings[index - 1];
  const after = siblings[index + 1];
  const Row = ({
    label,
    onPress,
    active
  }) => /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
    accessibilityRole: "menuitem",
    onPress: onPress,
    style: ({
      pressed
    }) => [styles.item, (pressed || active) && {
      backgroundColor: theme.selection
    }],
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
      style: [styles.itemText, {
        color: theme.text
      }],
      children: label
    })
  });
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Modal, {
    transparent: true,
    visible: true,
    animationType: "none",
    onRequestClose: close,
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
      style: styles.backdrop,
      onPress: close,
      accessibilityLabel: labels.blockMenu,
      children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
        style: [styles.sheet, {
          backgroundColor: theme.background,
          borderColor: theme.border
        }],
        children: /*#__PURE__*/(0, _jsxRuntime.jsxs)(_reactNative.ScrollView, {
          children: [blockActions.map(action => /*#__PURE__*/(0, _jsxRuntime.jsx)(Row, {
            label: action.label,
            onPress: () => {
              close();
              action.onPress(id);
            }
          }, action.id)), onCopyBlockLink && !many ? /*#__PURE__*/(0, _jsxRuntime.jsx)(Row, {
            label: labels.copyBlockLink,
            onPress: () => {
              close();
              onCopyBlockLink(id);
            }
          }) : null, /*#__PURE__*/(0, _jsxRuntime.jsx)(Row, {
            label: labels.duplicate,
            onPress: () => act(c => (0, _commands.duplicateBlocks)(c, targets))
          }), /*#__PURE__*/(0, _jsxRuntime.jsx)(Row, {
            label: labels.delete,
            onPress: () => {
              close();
              requestRemove(targets);
            }
          }), before && !many ? /*#__PURE__*/(0, _jsxRuntime.jsx)(Row, {
            label: labels.moveUp,
            onPress: () => act(c => (0, _commands.moveBlocks)(c, [id], before, 'before'))
          }) : null, after && !many ? /*#__PURE__*/(0, _jsxRuntime.jsx)(Row, {
            label: labels.moveDown,
            onPress: () => act(c => (0, _commands.moveBlocks)(c, [id], after, 'after'))
          }) : null, before || many ? /*#__PURE__*/(0, _jsxRuntime.jsx)(Row, {
            label: labels.indent,
            onPress: () => act(c => (0, _commands.indentBlocks)(c, targets))
          }) : null, parent !== null || many ? /*#__PURE__*/(0, _jsxRuntime.jsx)(Row, {
            label: labels.outdent,
            onPress: () => act(c => (0, _commands.outdentBlocks)(c, targets))
          }) : null, /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
            style: [styles.section, {
              color: theme.textMuted
            }],
            children: labels.turnInto
          }), turnIntoItems.map(item => item.action.kind === 'block' && (0, _commands.canTurnInto)(store, id, item.action.type) ? /*#__PURE__*/(0, _jsxRuntime.jsx)(Row, {
            label: item.label,
            active: isCurrent(store.schema, block, item.action),
            onPress: () => {
              const action = item.action;
              if (action.kind !== 'block') return;
              act(c => (0, _commands.composeCommands)(c, targets.map(target => cc => (0, _commands.turnInto)(cc, target, action.type, action.props ?? {}))));
            }
          }, item.id) : null), /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
            style: [styles.section, {
              color: theme.textMuted
            }],
            children: labels.color
          }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
            style: styles.swatches,
            children: _theme.BLOCK_COLOR_NAMES.map(name => /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
              accessibilityRole: "button",
              accessibilityLabel: `${labels.color}: ${labels.colorNames[name] ?? name}`,
              onPress: () => act(c => (0, _commands.setBlocksProps)(c, targets, {
                color: name === 'default' ? undefined : name
              })),
              style: [styles.swatch, {
                borderColor: theme.border
              }],
              children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
                style: {
                  color: name === 'default' ? theme.text : theme.colors[name]?.text,
                  fontWeight: '600'
                },
                children: "A"
              })
            }, `c-${name}`))
          }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Text, {
            style: [styles.section, {
              color: theme.textMuted
            }],
            children: labels.background
          }), /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.View, {
            style: styles.swatches,
            children: _theme.BLOCK_COLOR_NAMES.map(name => /*#__PURE__*/(0, _jsxRuntime.jsx)(_reactNative.Pressable, {
              accessibilityRole: "button",
              accessibilityLabel: `${labels.background}: ${labels.colorNames[name] ?? name}`,
              onPress: () => act(c => (0, _commands.setBlocksProps)(c, targets, {
                backgroundColor: name === 'default' ? undefined : name
              })),
              style: [styles.swatch, {
                borderColor: theme.border,
                backgroundColor: theme.colors[name]?.background ?? theme.background
              }]
            }, `b-${name}`))
          })]
        })
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
    maxWidth: 320,
    maxHeight: '80%',
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 6
  },
  item: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginHorizontal: 6,
    borderRadius: 6
  },
  itemText: {
    fontSize: 14
  },
  section: {
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4
  },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 14,
    paddingBottom: 6
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  }
});
//# sourceMappingURL=BlockMenu.js.map