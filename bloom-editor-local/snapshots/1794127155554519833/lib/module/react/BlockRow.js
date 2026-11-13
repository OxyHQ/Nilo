"use strict";

import { memo, useCallback, useSyncExternalStore } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { insertBlockAfter, setProps } from "../model/commands.js";
import { acceptsChildren, isToggle, specOf } from "../model/schema.js";
import { useBlock, useEditorContext } from "./context.js";
import { useBlockDecoration } from "./decorations.js";
import { TextBlock } from "./TextBlock.js";
import { blockSpacing } from "./typography.js";
import { useUi } from "./ui-store.js";
import { blockDomId, gutterDomId } from "./block-dom.js";
import { extendBlockSelection, selectBlocks } from "./block-selection.js";
import { startBlockDrag } from './drag';
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
const INDENT = 26;
const BULLETS = ['•', '◦', '▪'];

/** A list of sibling blocks; numbers consecutive numbered items. */
export function BlockList({
  ids,
  depth
}) {
  const {
    store
  } = useEditorContext();
  // Numbering needs the siblings' types; read them from the current document.
  const types = useSyncExternalStore(store.subscribe, () => ids.map(id => store.getSnapshot().doc.blocks[id]?.type ?? '').join('|'));
  const kinds = types.split('|');
  let counter = 0;
  return /*#__PURE__*/_jsx(_Fragment, {
    children: ids.map((id, index) => {
      counter = kinds[index] === 'numbered_list_item' ? counter + 1 : 0;
      return /*#__PURE__*/_jsx(BlockRow, {
        id: id,
        depth: depth,
        number: counter
      }, id);
    })
  });
}
const BlockRow = /*#__PURE__*/memo(function BlockRow({
  id,
  depth,
  number
}) {
  const {
    store,
    ui,
    theme,
    labels,
    renderers,
    markers,
    decorations,
    domIdPrefix,
    readOnly
  } = useEditorContext();
  const decoration = useBlockDecoration(decorations, id);
  const block = useBlock(store, id);
  const selected = useUi(ui, s => s.selectedBlocks.includes(id));
  const hovered = useUi(ui, s => s.hovered === id);
  const dropHere = useUi(ui, s => s.drag?.target === id ? s.drag.position : null);
  // Menus and popovers hang outside their block. Every view stacks on its
  // own (react-native-web gives each `z-index: 0`), so the block that has
  // one, and the blocks it is nested in, are raised over their siblings —
  // and its row over its own children.
  const raised = useUi(ui, s => {
    const owner = s.slash?.blockId ?? s.mention?.blockId ?? s.linking ?? s.focused;
    if (owner === id) return 'self';
    for (let at = owner ? store.doc.blocks[owner]?.parent : null; at; at = store.doc.blocks[at]?.parent) {
      if (at === id) return 'ancestor';
    }
    return null;
  });
  const updateProps = useCallback(patch => {
    store.sealHistory();
    store.run(c => setProps(c, id, patch));
  }, [id, store]);
  if (!block) return null;
  const spec = specOf(store.schema, block.type);
  const expanded = block.props.expanded !== false;
  const background = typeof block.props.backgroundColor === 'string' ? theme.colors[block.props.backgroundColor]?.background : undefined;
  const renderChildren = () => block.children.length > 0 ? /*#__PURE__*/_jsx(BlockList, {
    ids: block.children,
    depth: depth + 1
  }) : null;
  let content;
  const custom = renderers[block.type];
  if (custom) {
    content = custom({
      block,
      readOnly,
      updateProps,
      renderChildren
    });
  } else if (spec.hasText) {
    content = /*#__PURE__*/_jsx(TextBlock, {
      block: block
    });
  } else if (block.type === 'divider') {
    content = /*#__PURE__*/_jsx(View, {
      style: [styles.divider, {
        backgroundColor: theme.border
      }]
    });
  } else {
    content = null;
  }
  const appMarker = markers[block.type];
  const marker = (() => {
    if (appMarker) return appMarker({
      block,
      readOnly,
      updateProps,
      renderChildren
    });
    switch (block.type !== 'toggle' && isToggle(store.schema, block) ? 'toggle_heading' : block.type) {
      case 'bulleted_list_item':
        return /*#__PURE__*/_jsx(Text, {
          style: [styles.marker, {
            color: theme.text
          }],
          children: BULLETS[depth % BULLETS.length]
        });
      case 'numbered_list_item':
        return /*#__PURE__*/_jsx(Text, {
          style: [styles.marker, styles.number, {
            color: theme.text
          }],
          children: `${number}.`
        });
      case 'todo':
        {
          const checked = block.props.checked === true;
          return /*#__PURE__*/_jsx(Pressable, {
            accessibilityRole: "checkbox",
            accessibilityLabel: labels.checkbox,
            accessibilityState: {
              checked
            },
            "aria-checked": checked,
            disabled: readOnly,
            onPress: () => updateProps({
              checked: !checked
            }),
            style: [styles.checkbox, {
              borderColor: checked ? theme.accent : theme.textMuted
            }, checked && {
              backgroundColor: theme.accent
            }],
            children: checked ? /*#__PURE__*/_jsx(Text, {
              style: [styles.check, {
                color: theme.accentText
              }],
              children: "\u2713"
            }) : null
          });
        }
      case 'toggle':
      case 'toggle_heading':
        return /*#__PURE__*/_jsx(Pressable, {
          accessibilityRole: "button",
          accessibilityLabel: expanded ? labels.toggleOpen : labels.toggleClosed,
          accessibilityState: {
            expanded
          },
          "aria-expanded": expanded,
          onPress: () => updateProps({
            expanded: !expanded
          }),
          style: styles.markerButton,
          children: /*#__PURE__*/_jsx(Text, {
            style: [styles.chevron, {
              color: theme.text
            }, expanded && styles.chevronOpen],
            children: "\u25B8"
          })
        });
      case 'callout':
        return /*#__PURE__*/_jsx(Text, {
          style: styles.calloutIcon,
          children: typeof block.props.icon === 'string' ? block.props.icon : '💡'
        });
      default:
        return null;
    }
  })();
  const showsChildren = block.children.length > 0 && !custom && acceptsChildren(store.schema, block) && !spec.isContainer && expanded;
  return /*#__PURE__*/_jsxs(View, {
    nativeID: blockDomId(id, domIdPrefix),
    onPointerEnter: Platform.OS === 'web' && !readOnly ? () => ui.set({
      hovered: id
    }) : undefined,
    onPointerLeave: Platform.OS === 'web' && !readOnly ? () => {
      if (ui.get().hovered === id) ui.set({
        hovered: null
      });
    } : undefined,
    style: [styles.block, spec.grow && styles.grow, {
      marginTop: blockSpacing(block.type)
    }, selected && {
      backgroundColor: theme.selection
    }, decoration?.color !== undefined && [styles.decorated, {
      borderLeftColor: decoration.color
    }], raised !== null && styles.raised],
    accessibilityHint: decoration?.label,
    children: [/*#__PURE__*/_jsxs(View, {
      style: [styles.row, raised === 'self' && styles.raised, block.type === 'callout' && [styles.callout, {
        backgroundColor: background ?? theme.codeBackground
      }], block.type === 'code' && [styles.code, {
        backgroundColor: theme.codeBackground
      }], block.type !== 'callout' && background !== undefined && {
        backgroundColor: background
      }, dropHere === 'inside' && {
        backgroundColor: theme.selection
      }],
      children: [Platform.OS === 'web' && !readOnly && !spec.parentTypes ? /*#__PURE__*/_jsx(Gutter, {
        id: id,
        visible: hovered
      }) : null, block.type === 'quote' ? /*#__PURE__*/_jsx(View, {
        style: [styles.quoteBar, {
          backgroundColor: theme.text
        }]
      }) : null, marker ? /*#__PURE__*/_jsx(View, {
        style: styles.markerBox,
        children: marker
      }) : null, /*#__PURE__*/_jsx(View, {
        style: styles.content,
        children: content
      })]
    }), dropHere === 'before' ? /*#__PURE__*/_jsx(View, {
      style: [styles.dropLine, styles.dropTop, {
        backgroundColor: theme.accent
      }]
    }) : null, showsChildren ? /*#__PURE__*/_jsx(View, {
      style: {
        paddingLeft: INDENT
      },
      children: renderChildren()
    }) : null, dropHere === 'after' ? /*#__PURE__*/_jsx(View, {
      style: [styles.dropLine, styles.dropBottom, {
        backgroundColor: theme.accent
      }]
    }) : null]
  });
});

/** The web gutter: add-below and the drag handle that also opens the block menu. */
function Gutter({
  id,
  visible
}) {
  const {
    store,
    ui,
    theme,
    labels,
    domIdPrefix
  } = useEditorContext();
  return /*#__PURE__*/_jsxs(View, {
    nativeID: gutterDomId(id, domIdPrefix),
    style: [styles.gutter, {
      opacity: visible ? 1 : 0
    }],
    children: [/*#__PURE__*/_jsx(Pressable, {
      accessibilityRole: "button",
      accessibilityLabel: labels.addBelow,
      onPress: () => {
        store.sealHistory();
        store.run(c => insertBlockAfter(c, id, 'paragraph'));
      },
      style: styles.gutterButton,
      children: /*#__PURE__*/_jsx(Text, {
        style: [styles.gutterGlyph, {
          color: theme.textMuted
        }],
        children: "+"
      })
    }), /*#__PURE__*/_jsx(View, {
      onPointerDown: event => startBlockDrag(store, ui, id, {
        x: event.nativeEvent.pageX,
        y: event.nativeEvent.pageY
      }, domIdPrefix),
      children: /*#__PURE__*/_jsx(Pressable, {
        accessibilityRole: "button",
        accessibilityLabel: labels.blockMenu,
        onPress: event => {
          if (ui.get().drag) return;
          // Shift-click extends the selection to this block instead.
          if (event.nativeEvent.shiftKey) {
            if (!extendBlockSelection(store, ui, id)) selectBlocks(ui, [id]);
            return;
          }
          // The menu acts on the selection this block is in, else on it alone.
          if (!ui.get().selectedBlocks.includes(id)) selectBlocks(ui, [id]);
          ui.set({
            blockMenu: id
          });
        },
        style: styles.gutterButton,
        children: /*#__PURE__*/_jsx(Text, {
          style: [styles.gutterGlyph, {
            color: theme.textMuted
          }],
          children: "\u22EE\u22EE"
        })
      })
    })]
  });
}
const styles = StyleSheet.create({
  block: {
    position: 'relative',
    borderRadius: 4
  },
  grow: {
    flex: 1,
    minWidth: 0
  },
  raised: {
    zIndex: 1
  },
  // A collaborator's caret: an edge that does not move the content.
  decorated: {
    borderLeftWidth: 2,
    marginLeft: -2
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 4
  },
  content: {
    flex: 1,
    minWidth: 0
  },
  markerBox: {
    width: 24,
    alignItems: 'center',
    paddingTop: 2
  },
  marker: {
    fontSize: 16,
    lineHeight: 24
  },
  number: {
    fontVariant: ['tabular-nums']
  },
  markerButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center'
  },
  chevron: {
    fontSize: 13,
    transform: [{
      rotate: '0deg'
    }]
  },
  chevronOpen: {
    transform: [{
      rotate: '90deg'
    }]
  },
  checkbox: {
    width: 16,
    height: 16,
    borderWidth: 1.5,
    borderRadius: 3,
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center'
  },
  check: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: '700'
  },
  calloutIcon: {
    fontSize: 18,
    lineHeight: 24
  },
  callout: {
    padding: 12,
    gap: 6
  },
  code: {
    borderRadius: 4
  },
  quoteBar: {
    width: 3,
    alignSelf: 'stretch',
    marginRight: 12,
    borderRadius: 1
  },
  divider: {
    height: 1,
    marginVertical: 12
  },
  gutter: {
    position: 'absolute',
    left: -52,
    top: 0,
    flexDirection: 'row'
  },
  gutterButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4
  },
  gutterGlyph: {
    fontSize: 14,
    fontWeight: '600'
  },
  dropLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 2,
    zIndex: 10
  },
  dropTop: {
    top: -2
  },
  dropBottom: {
    bottom: -2
  }
});
//# sourceMappingURL=BlockRow.js.map